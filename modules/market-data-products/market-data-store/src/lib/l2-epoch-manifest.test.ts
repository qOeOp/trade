import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import {
  admitL2EpochManifest,
  ensureMarketDataSchema,
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
