import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import {
  admitL2CompactionProposal,
  admitL2EpochManifest,
  ensureMarketDataSchema,
  prepareL2CompactionJob,
  readL2Compaction,
  type L2CompactionProposal,
  type L2EpochManifestProposal,
} from "./market-data-store"

test("L2 owner issues one compaction job and admits exact Parquet proposal while pinning raw evidence", () => {
  const fixture = createEpochFixture()
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  try {
    const epoch = admitL2EpochManifest(db, fixture.admission).epoch
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
    assert.equal(admitL2EpochManifest(db, fixture.admission).commit_status, "existing")
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
