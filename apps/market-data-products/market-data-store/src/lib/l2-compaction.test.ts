import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { canonicalNfcHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  admitL2CompactionProposal,
  admitL2EpochManifest,
  auditL2RetentionReferenceClosure,
  ensureMarketDataSchema,
  prepareL2CompactionJob,
  readL2ExperimentAttachmentReferrerReceipt,
  readL2Compaction,
  readL2CompactedEpochSource,
  registerL2ExperimentAttachmentReferrerReceipt,
  type L2CompactionProposal,
  type L2EpochManifestProposal,
} from "./market-data-store"

test("L2 owner issues one compaction job and admits exact Parquet proposal while pinning raw evidence", () => {
  const fixture = createEpochFixture()
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  try {
    const epoch = admitL2EpochManifest(db, fixture.admission).epoch
    const rawAudit = auditL2RetentionReferenceClosure(db, epoch.epoch_id)
    assert.equal(rawAudit.reference_status, "raw_hot_not_compacted")
    assert.equal(rawAudit.referrer_count, 0)
    assert.equal(rawAudit.compaction_id, null)
    assert.equal(rawAudit.deletion_eligible, false)
    assert.equal(rawAudit.deletion_decision, "forbidden_no_gc_authority")
    const prepared = prepareL2CompactionJob(db, {
      repository_root: fixture.root,
      epoch_id: epoch.epoch_id,
      output_base: "tmp/l2-order-book-compactor",
      prepared_at: "2026-07-22T01:00:00Z",
    })
    assert.equal(prepared.commit_status, "created")
    assert.equal(prepareL2CompactionJob(db, {
      repository_root: fixture.root,
      epoch_id: epoch.epoch_id,
      output_base: "data/l2-parquet",
    }).commit_status, "existing")

    const parquet = Buffer.from("PAR1-owner-bound-test-evidence-PAR1")
    mkdirSync(dirname(join(fixture.root, prepared.job.output_path)), { recursive: true })
    writeFileSync(join(fixture.root, prepared.job.output_path), parquet)
    const proposal: L2CompactionProposal = {
      schema_version: "trade.l2-compaction-proposal.v1",
      job_id: prepared.job.job_id,
      epoch_id: prepared.job.epoch_id,
      symbol: prepared.job.symbol,
      stream_epoch: prepared.job.stream_epoch,
      source_manifest_path: prepared.job.source_manifest_path,
      source_manifest_hash: prepared.job.source_manifest_hash,
      policy_version: "l2-raw-parquet-zstd-v1",
      parquet_path: prepared.job.output_path,
      parquet_hash: sha256(parquet),
      parquet_bytes: parquet.byteLength,
      row_count: 2,
      first_local_receive_time_ms: 1_001,
      last_local_receive_time_ms: 1_002,
      first_final_update_id: 101,
      last_final_update_id: 102,
      created_at_ms: 1_700_000_000_000,
    }
    mkdirSync(dirname(join(fixture.root, prepared.job.proposal_path)), { recursive: true })
    writeFileSync(join(fixture.root, prepared.job.proposal_path), `${JSON.stringify(proposal, null, 2)}\n`)
    const created = admitL2CompactionProposal(db, {
      repository_root: fixture.root,
      proposal_path: prepared.job.proposal_path,
      admitted_at: "2026-07-22T01:01:00Z",
    })
    assert.equal(created.commit_status, "created")
    assert.deepEqual(readL2Compaction(db, created.compaction.compaction_id), created.compaction)
    assert.equal(admitL2CompactionProposal(db, {
      repository_root: fixture.root,
      proposal_path: prepared.job.proposal_path,
    }).commit_status, "existing")
    assert.deepEqual(db.query(`
      SELECT retention_class, compaction_ref, deletion_eligible FROM l2_epoch_retention
    `).get(), {
      retention_class: "compacted_pinned",
      compaction_ref: created.compaction.compaction_id,
      deletion_eligible: 0,
    })
    const source = readL2CompactedEpochSource(db, created.compaction.compaction_id)
    assert.equal(source?.source_id, `l2-compacted-epoch:${source?.source_hash}`)
    assert.equal(source?.row_count, 2)
    assert.equal(source?.deletion_eligible, false)
    assert.deepEqual(readL2CompactedEpochSource(db, created.compaction.compaction_id), source)
    assert.ok(source)
    const compactedAudit = auditL2RetentionReferenceClosure(db, epoch.epoch_id)
    assert.equal(compactedAudit.reference_status, "compacted_pinned_no_registered_referrer")
    assert.equal(compactedAudit.referrer_count, 0)
    assert.equal(compactedAudit.source_hash, source.source_hash)
    assert.equal(compactedAudit.deletion_decision, "forbidden_no_gc_authority")
    const authority = buildL2AttachmentAuthority(source)
    const registered = registerL2ExperimentAttachmentReferrerReceipt(db, {
      authority,
      registered_at: "2026-07-22T01:02:00Z",
    })
    assert.equal(registered.commit_status, "created")
    assert.equal(registered.receipt.source_hash, source.source_hash)
    assert.equal(registered.receipt.deletion_authority, "none")
    assert.equal(JSON.stringify(registered.receipt).includes("trial_id"), false)
    assert.deepEqual(registerL2ExperimentAttachmentReferrerReceipt(db, {
      authority,
      registered_at: "2026-07-22T01:03:00Z",
    }), { commit_status: "existing", receipt: registered.receipt })
    assert.deepEqual(
      readL2ExperimentAttachmentReferrerReceipt(db, authority.authority_snapshot_hash),
      registered.receipt,
    )
    const secondAuthority = rehashAuthority({
      ...authority,
      authority_snapshot_id: "l2-attachment-test-second",
      authority_snapshot_ref: "authority://l2-attachment-test-second",
      reservation_hash: "7".repeat(64),
      request_hash: "8".repeat(64),
      batch_id: "replay-l2-depth-batch:test-second",
      batch_hash: "9".repeat(64),
      batch_rows_hash: "a".repeat(64),
      batch_row_count: 1,
      batch_next_offset: 1,
      frame_end_exclusive: 2,
      batch_exhausted: false,
    })
    const secondRegistered = registerL2ExperimentAttachmentReferrerReceipt(db, {
      authority: secondAuthority,
      registered_at: "2026-07-22T01:04:00Z",
    })
    assert.equal(secondRegistered.commit_status, "created")
    const referencedAudit = auditL2RetentionReferenceClosure(db, epoch.epoch_id)
    assert.equal(referencedAudit.reference_status, "compacted_pinned_with_registered_referrers")
    assert.equal(referencedAudit.referrer_count, 2)
    assert.deepEqual(
      referencedAudit.referrers.map((referrer) => referrer.authority_snapshot_hash),
      [authority.authority_snapshot_hash, secondAuthority.authority_snapshot_hash].sort(),
    )
    assert.equal(referencedAudit.deletion_decision, "forbidden_no_gc_authority")
    const { audit_hash: auditHash, ...auditBody } = referencedAudit
    assert.equal(auditHash, canonicalNfcHash(auditBody))
    assert.deepEqual(auditL2RetentionReferenceClosure(db, epoch.epoch_id), referencedAudit)
    assert.deepEqual(db.query(`
      SELECT retention_class, compaction_ref, deletion_eligible FROM l2_epoch_retention
    `).get(), {
      retention_class: "compacted_pinned",
      compaction_ref: created.compaction.compaction_id,
      deletion_eligible: 0,
    })
    assert.throws(() => db.run(`
      UPDATE l2_experiment_attachment_referrer_receipt SET registered_at = registered_at
    `), /immutable/)
    assert.throws(() => db.run(`DELETE FROM l2_experiment_attachment_referrer_receipt`), /immutable/)

    const sourceDrift = rehashAuthority({ ...authority, source_hash: "f".repeat(64) })
    assert.throws(() => registerL2ExperimentAttachmentReferrerReceipt(db, {
      authority: sourceDrift,
    }), /does not bind the local pinned source/)
    const economicDrift = rehashAuthority({ ...authority, economic_authority: "fill" })
    assert.throws(() => registerL2ExperimentAttachmentReferrerReceipt(db, {
      authority: economicDrift,
    }), /unsupported L2 referrer authority/)
    assert.throws(() => registerL2ExperimentAttachmentReferrerReceipt(db, {
      authority: { ...authority, batch_hash: "e".repeat(64) },
    }), /snapshot hash mismatch/)
    assert.equal(admitL2EpochManifest(db, fixture.admission).commit_status, "existing")
    db.run(`UPDATE l2_epoch_retention SET deletion_eligible = 1 WHERE epoch_id = ?`, [epoch.epoch_id])
    assert.throws(
      () => auditL2RetentionReferenceClosure(db, epoch.epoch_id),
      /stored L2 epoch retention state is invalid|unsafe retention state/,
    )
  } finally {
    db.close()
    fixture.cleanup()
  }
})

test("L2 owner rejects proposal output whose bytes differ", () => {
  const fixture = createEpochFixture()
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  try {
    const epoch = admitL2EpochManifest(db, fixture.admission).epoch
    const job = prepareL2CompactionJob(db, {
      repository_root: fixture.root,
      epoch_id: epoch.epoch_id,
      output_base: "tmp/l2-order-book-compactor",
    }).job
    const parquet = Buffer.from("PAR1-original-PAR1")
    mkdirSync(dirname(join(fixture.root, job.output_path)), { recursive: true })
    writeFileSync(join(fixture.root, job.output_path), parquet)
    const proposal: L2CompactionProposal = {
      schema_version: "trade.l2-compaction-proposal.v1",
      job_id: job.job_id,
      epoch_id: job.epoch_id,
      symbol: job.symbol,
      stream_epoch: job.stream_epoch,
      source_manifest_path: job.source_manifest_path,
      source_manifest_hash: job.source_manifest_hash,
      policy_version: "l2-raw-parquet-zstd-v1",
      parquet_path: job.output_path,
      parquet_hash: sha256(parquet),
      parquet_bytes: parquet.byteLength,
      row_count: 2,
      first_local_receive_time_ms: 1_001,
      last_local_receive_time_ms: 1_002,
      first_final_update_id: 101,
      last_final_update_id: 103,
      created_at_ms: 1_700_000_000_000,
    }
    mkdirSync(dirname(join(fixture.root, job.proposal_path)), { recursive: true })
    writeFileSync(join(fixture.root, job.proposal_path), JSON.stringify(proposal))
    assert.throws(() => admitL2CompactionProposal(db, {
      repository_root: fixture.root,
      proposal_path: job.proposal_path,
    }), /coverage differs/)
    proposal.last_final_update_id = 102
    writeFileSync(join(fixture.root, job.proposal_path), JSON.stringify(proposal))
    writeFileSync(join(fixture.root, job.output_path), Buffer.from("PAR1-tampered-PAR1"))
    assert.throws(() => admitL2CompactionProposal(db, {
      repository_root: fixture.root,
      proposal_path: job.proposal_path,
    }), /byte\/hash evidence mismatch/)
  } finally {
    db.close()
    fixture.cleanup()
  }
})

function createEpochFixture() {
  const root = mkdtempSync(join(tmpdir(), `trade-l2-compaction-owner-${randomUUID()}-`))
  const directory = join(root, "tmp/l2-order-book-service/run")
  mkdirSync(directory, { recursive: true })
  const payloads = [Buffer.from('{"frame":1}'), Buffer.from('{"frame":2}')]
  const segment = buildTl2s(payloads)
  const snapshot = Buffer.from('{"lastUpdateId":100,"bids":[],"asks":[]}')
  writeFileSync(join(directory, "epoch-segment.tl2s"), segment)
  writeFileSync(join(directory, "epoch-snapshot.json"), snapshot)
  const manifest: L2EpochManifestProposal = {
    schema_version: "trade.l2-epoch-manifest-proposal.v1",
    symbol: "BTCUSDT",
    stream_epoch: "1000-0001",
    started_at_ms: 1_000,
    finished_at_ms: 2_000,
    continuity_status: "complete",
    termination_reason: "scheduled_rotation",
    snapshot_ref: "epoch-snapshot.json",
    snapshot_hash: sha256(snapshot),
    last_update_id: 102,
    received_messages: 2,
    recorded_frames: 2,
    applied_events: 2,
    segments: [{
      path: "epoch-segment.tl2s",
      frame_count: 2,
      payload_bytes: payloads.reduce((total, payload) => total + payload.byteLength, 0),
      segment_bytes: segment.byteLength,
      payload_hash: sha256(Buffer.concat(payloads)),
      segment_hash: sha256(segment),
      writer_elapsed_ns: 100,
    }],
  }
  writeFileSync(join(directory, "epoch-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return {
    root,
    admission: { repository_root: root, manifest_path: "tmp/l2-order-book-service/run/epoch-manifest.json" },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function buildL2AttachmentAuthority(source: NonNullable<ReturnType<typeof readL2CompactedEpochSource>>) {
  const limitations = [
    "source-external-completeness-not-verified",
    "single-compacted-epoch-and-one-exact-validated-batch-only",
    "no-cross-epoch-or-unbound-frame-read",
    "public-depth-deltas-do-not-prove-hypothetical-queue-position",
    "no-fill-quantity-maker-probability-slippage-impact-or-economic-authority",
    "separate-attachment-does-not-mutate-the-ohlcv-dataset-manifest",
    "replay-runner-not-bound",
  ]
  const body = {
    schema_version: "trade.rd-replay-l2-experiment-attachment-authority.v1",
    authority_snapshot_id: "l2-attachment-test",
    authority_snapshot_ref: "authority://l2-attachment-test",
    status: "authorized",
    issued_at: "2026-07-22T01:01:30Z",
    authority_id: "research-control-plane",
    authority_policy_version: "rd-replay-l2-experiment-attachment-v1",
    trial_id: "trial-l2-test",
    run_id: "run-l2-test",
    reservation_ref: "reservation://trial-l2-test",
    reservation_hash: "1".repeat(64),
    request_schema_version: "trade.replay-execution-request.v38",
    request_hash: "2".repeat(64),
    dataset_manifest_id: "manifest-l2-test",
    dataset_manifest_ref: "manifest://l2-test",
    dataset_data_hash: "3".repeat(64),
    dataset_manifest_hash: "4".repeat(64),
    venue_id: "binance-usdm",
    symbol: source.symbol,
    source_id: source.source_id,
    source_hash: source.source_hash,
    compaction_id: source.compaction_id,
    epoch_id: source.epoch_id,
    stream_epoch: source.stream_epoch,
    source_row_count: source.row_count,
    source_parquet_hash: source.parquet_hash,
    source_retention_class: "compacted_pinned",
    source_deletion_eligible: false,
    batch_id: "replay-l2-depth-batch:test",
    batch_hash: "5".repeat(64),
    batch_rows_hash: "6".repeat(64),
    batch_offset: 0,
    batch_row_count: source.row_count,
    batch_next_offset: source.row_count,
    frame_start_inclusive: 1,
    frame_end_exclusive: source.row_count + 1,
    batch_exhausted: true,
    attachment_scope: "one_exact_validated_batch_within_one_compacted_epoch",
    gap_policy: "reject_missing_frame_and_cross_epoch_join",
    economic_authority: "none",
    runner_compatibility: "not_bound",
    external_completeness: "not_verified",
    limitations,
    limitations_hash: canonicalNfcHash(limitations),
  }
  return { ...body, authority_snapshot_hash: canonicalNfcHash(body) }
}

function rehashAuthority(authority: Record<string, unknown>) {
  const { authority_snapshot_hash: _hash, ...body } = authority
  return { ...body, authority_snapshot_hash: canonicalNfcHash(body) }
}

function buildTl2s(payloads: Buffer[]): Buffer {
  const header = Buffer.alloc(8)
  header.write("TL2S", 0, "ascii")
  header.writeUInt16BE(1, 4)
  const frames = payloads.map((payload) => {
    const frame = Buffer.alloc(8 + payload.byteLength)
    frame.writeUInt32BE(payload.byteLength, 0)
    frame.writeUInt32BE(crc32(payload), 4)
    payload.copy(frame, 8)
    return frame
  })
  return Buffer.concat([header, ...frames])
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function crc32(value: Uint8Array): number {
  let state = 0xffffffff
  for (const byte of value) {
    state ^= byte
    for (let bit = 0; bit < 8; bit += 1) state = (state >>> 1) ^ (state & 1 ? 0xedb88320 : 0)
  }
  return (state ^ 0xffffffff) >>> 0
}
