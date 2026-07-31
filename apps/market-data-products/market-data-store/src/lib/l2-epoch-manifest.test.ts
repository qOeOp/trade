import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import { canonicalNfcHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  admitL2EpochManifest,
  ensureMarketDataSchema,
  listL2RetentionReferenceAudits,
  reconcileL2EpochManifests,
  readL2EpochManifest,
  type L2EpochManifestProposal,
} from "./market-data-store"

test("L2 owner admits exact snapshot and TL2S evidence create-or-identical", () => {
  const fixture = createFixture()
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  try {
    const created = admitL2EpochManifest(db, fixture.input)
    assert.equal(created.commit_status, "created")
    assert.equal(created.epoch.source_completeness, "epoch_contiguous")
    assert.equal(created.epoch.external_completeness, "not_verified")
    assert.equal(created.epoch.manifest.recorded_frames, 2)
    assert.equal(admitL2EpochManifest(db, fixture.input).commit_status, "existing")
    assert.deepEqual(readL2EpochManifest(db, created.epoch.epoch_id), created.epoch)
    assert.equal((db.query("SELECT COUNT(*) AS count FROM l2_segment_manifest").get() as { count: number }).count, 1)
    assert.deepEqual(db.query("SELECT retention_class, deletion_eligible FROM l2_epoch_retention").get(), {
      retention_class: "raw_hot",
      deletion_eligible: 0,
    })
    db.query("UPDATE l2_segment_manifest SET frame_count = frame_count + 1").run()
    assert.throws(() => readL2EpochManifest(db, created.epoch.epoch_id), /segment index differs/)
  } finally {
    db.close()
    fixture.cleanup()
  }
})

test("L2 owner rejects incomplete epochs and tampered TL2S bytes", () => {
  const incomplete = createFixture({ continuity_status: "incomplete" })
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  try {
    assert.throws(() => admitL2EpochManifest(db, incomplete.input), /only complete/)
  } finally {
    incomplete.cleanup()
  }

  const tampered = createFixture()
  const segmentPath = join(tampered.root, "data/l2/run/epoch-0001-segment-000001.tl2s")
  const bytes = Buffer.from(tampered.segment)
  bytes[bytes.length - 1] ^= 1
  writeFileSync(segmentPath, bytes)
  try {
    assert.throws(() => admitL2EpochManifest(db, tampered.input), /byte\/hash mismatch/)
  } finally {
    db.close()
    tampered.cleanup()
  }
})

test("L2 owner rejects a different manifest for an admitted stream epoch", () => {
  const fixture = createFixture()
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  try {
    admitL2EpochManifest(db, fixture.input)
    const changed = { ...fixture.manifest, termination_reason: "operator_rotation" }
    writeFileSync(join(fixture.root, fixture.input.manifest_path), `${JSON.stringify(changed, null, 2)}\n`)
    assert.throws(() => admitL2EpochManifest(db, fixture.input), /different content/)
  } finally {
    db.close()
    fixture.cleanup()
  }
})

test("L2 owner reconciler admits once and preserves stable rejection observations", () => {
  const complete = createFixture()
  const incomplete = createFixture({ continuity_status: "incomplete", stream_epoch: "2000-0001" })
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  try {
    const first = reconcileL2EpochManifests(db, {
      repository_root: complete.root,
      scan_roots: ["data/l2"],
      observed_at: "2026-07-22T00:00:00Z",
    })
    assert.equal(first.created, 1)
    assert.equal(first.rejected_invalid, 0)
    const second = reconcileL2EpochManifests(db, {
      repository_root: complete.root,
      scan_roots: ["data/l2"],
      observed_at: "2026-07-22T00:01:00Z",
    })
    assert.equal(second.unchanged, 1)

    const rejected = reconcileL2EpochManifests(db, {
      repository_root: incomplete.root,
      scan_roots: ["data/l2"],
      observed_at: "2026-07-22T00:02:00Z",
    })
    assert.equal(rejected.rejected_incomplete, 1)
    assert.match(rejected.problems[0]?.reason ?? "", /only complete/)
    const unchanged = reconcileL2EpochManifests(db, {
      repository_root: incomplete.root,
      scan_roots: ["data/l2"],
      observed_at: "2026-07-22T00:03:00Z",
    })
    assert.equal(unchanged.unchanged, 1)
    const observation = db.query(`
      SELECT observation_count FROM l2_epoch_admission_observation WHERE outcome = 'rejected_incomplete'
    `).get() as { observation_count: number }
    assert.equal(observation.observation_count, 2)
  } finally {
    db.close()
    complete.cleanup()
    incomplete.cleanup()
  }
})

test("L2 owner classifies a zero-frame incomplete shutdown as non-admissible rather than corrupt", () => {
  const fixture = createFixture({
    continuity_status: "incomplete",
    termination_reason: "no_recorded_frames:shutdown",
    last_update_id: null,
    received_messages: 0,
    recorded_frames: 0,
    applied_events: 0,
    segments: [],
  })
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  try {
    const result = reconcileL2EpochManifests(db, {
      repository_root: fixture.root,
      scan_roots: ["data/l2"],
      observed_at: "2026-07-22T00:04:00Z",
    })
    assert.equal(result.rejected_incomplete, 1)
    assert.equal(result.rejected_invalid, 0)
  } finally {
    db.close()
    fixture.cleanup()
  }
})

test("L2 owner lists bounded deterministic retention/reference audit pages without deletion candidates", () => {
  const fixtures = ["1000-0001", "2000-0001", "3000-0001"].map((stream_epoch) => createFixture({ stream_epoch }))
  const db = new Database(":memory:")
  ensureMarketDataSchema(db)
  try {
    const epochIds = fixtures.map((fixture) => admitL2EpochManifest(db, fixture.input).epoch.epoch_id).sort()
    const first = listL2RetentionReferenceAudits(db, { limit: 2 })
    assert.equal(first.page_count, 2)
    assert.equal(first.has_more, true)
    assert.equal(first.next_after_epoch_id, epochIds[1])
    assert.deepEqual(first.audits.map((audit) => audit.epoch_id), epochIds.slice(0, 2))
    assert.deepEqual(first.page_status_counts, {
      raw_hot_not_compacted: 2,
      compacted_pinned_no_registered_referrer: 0,
      compacted_pinned_with_registered_referrers: 0,
    })
    assert.equal(first.deletion_candidates_produced, false)
    assert.equal(first.deletion_decision, "forbidden_no_gc_authority")
    const { page_hash: firstHash, ...firstBody } = first
    assert.equal(firstHash, canonicalNfcHash(firstBody))
    assert.deepEqual(listL2RetentionReferenceAudits(db, { limit: 2 }), first)

    const second = listL2RetentionReferenceAudits(db, {
      after_epoch_id: first.next_after_epoch_id ?? undefined,
      limit: 2,
    })
    assert.deepEqual(second.audits.map((audit) => audit.epoch_id), epochIds.slice(2))
    assert.equal(second.has_more, false)
    assert.equal(second.next_after_epoch_id, null)
    assert.throws(() => listL2RetentionReferenceAudits(db, { after_epoch_id: "" }), /after_epoch_id is required/)
    assert.throws(() => listL2RetentionReferenceAudits(db, { limit: 51 }), /must not exceed 50/)
  } finally {
    db.close()
    for (const fixture of fixtures) fixture.cleanup()
  }
})

function createFixture(overrides: Partial<L2EpochManifestProposal> = {}) {
  const root = mkdtempSync(join(tmpdir(), `trade-l2-admission-${randomUUID()}-`))
  const directory = join(root, "data/l2/run")
  mkdirSync(directory, { recursive: true })
  const payloads = [Buffer.from('{"frame":1}'), Buffer.from('{"frame":2}')]
  const segment = buildTl2s(payloads)
  const snapshot = Buffer.from('{"lastUpdateId":100,"bids":[],"asks":[]}')
  writeFileSync(join(directory, "epoch-0001-segment-000001.tl2s"), segment)
  writeFileSync(join(directory, "epoch-0001-snapshot.json"), snapshot)
  const manifest: L2EpochManifestProposal = {
    schema_version: "trade.l2-epoch-manifest-proposal.v1",
    symbol: "BTCUSDT",
    stream_epoch: "1000-0001",
    started_at_ms: 1_000,
    finished_at_ms: 2_000,
    continuity_status: "complete",
    termination_reason: "scheduled_rotation",
    snapshot_ref: "epoch-0001-snapshot.json",
    snapshot_hash: sha256(snapshot),
    last_update_id: 102,
    received_messages: 2,
    recorded_frames: 2,
    applied_events: 2,
    segments: [{
      path: "epoch-0001-segment-000001.tl2s",
      frame_count: 2,
      payload_bytes: payloads.reduce((total, payload) => total + payload.byteLength, 0),
      segment_bytes: segment.byteLength,
      payload_hash: sha256(Buffer.concat(payloads)),
      segment_hash: sha256(segment),
      writer_elapsed_ns: 100,
    }],
    ...overrides,
  }
  const manifestPath = "data/l2/run/epoch-0001-manifest.json"
  writeFileSync(join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`)
  return {
    root,
    segment,
    manifest,
    input: { repository_root: root, manifest_path: manifestPath, admitted_at: "2026-07-22T00:00:00Z" },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function buildTl2s(payloads: Buffer[]): Buffer {
  const pieces: Buffer[] = [Buffer.from([0x54, 0x4c, 0x32, 0x53, 0, 1, 0, 0])]
  for (const payload of payloads) {
    const header = Buffer.alloc(8)
    header.writeUInt32BE(payload.byteLength, 0)
    header.writeUInt32BE(crc32(payload), 4)
    pieces.push(header, payload)
  }
  return Buffer.concat(pieces)
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
