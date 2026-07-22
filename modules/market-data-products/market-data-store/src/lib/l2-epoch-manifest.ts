import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import { basename, dirname, relative, resolve } from "node:path"

export const L2_EPOCH_MANIFEST_SCHEMA_VERSION = "trade.l2-epoch-manifest-proposal.v1" as const

export interface L2SegmentDescriptor {
  path: string
  frame_count: number
  payload_bytes: number
  segment_bytes: number
  payload_hash: string
  segment_hash: string
  writer_elapsed_ns: number
}

export interface L2EpochManifestProposal {
  schema_version: typeof L2_EPOCH_MANIFEST_SCHEMA_VERSION
  symbol: string
  stream_epoch: string
  started_at_ms: number
  finished_at_ms: number
  continuity_status: "complete" | "incomplete"
  termination_reason: string
  snapshot_ref: string
  snapshot_hash: string
  last_update_id: number | null
  received_messages: number
  recorded_frames: number
  applied_events: number
  segments: L2SegmentDescriptor[]
}

export interface AdmittedL2Epoch {
  epoch_id: string
  exchange: "binance-usdm"
  manifest_path: string
  manifest_hash: string
  admitted_at: string
  source_completeness: "epoch_contiguous"
  external_completeness: "not_verified"
  manifest: L2EpochManifestProposal
}

export interface L2EpochAdmissionInput {
  repository_root: string
  manifest_path: string
  admitted_at?: string
}

export interface L2EpochAdmissionResult {
  commit_status: "created" | "existing"
  epoch: AdmittedL2Epoch
}

export function ensureL2EpochManifestSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS l2_epoch_manifest (
      epoch_id               TEXT PRIMARY KEY,
      schema_version         TEXT NOT NULL,
      exchange               TEXT NOT NULL,
      symbol                 TEXT NOT NULL,
      stream_epoch           TEXT NOT NULL,
      started_at_ms          INTEGER NOT NULL,
      finished_at_ms         INTEGER NOT NULL,
      continuity_status      TEXT NOT NULL,
      termination_reason     TEXT NOT NULL,
      snapshot_ref           TEXT NOT NULL,
      snapshot_hash          TEXT NOT NULL,
      last_update_id         INTEGER NOT NULL,
      received_messages      INTEGER NOT NULL,
      recorded_frames        INTEGER NOT NULL,
      applied_events         INTEGER NOT NULL,
      manifest_path          TEXT NOT NULL,
      manifest_hash          TEXT NOT NULL UNIQUE,
      admitted_at            TEXT NOT NULL,
      source_completeness    TEXT NOT NULL,
      external_completeness  TEXT NOT NULL,
      manifest_json          TEXT NOT NULL CHECK(json_valid(manifest_json)),
      UNIQUE(exchange, symbol, stream_epoch)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS l2_segment_manifest (
      epoch_id           TEXT NOT NULL,
      segment_sequence   INTEGER NOT NULL,
      segment_ref        TEXT NOT NULL,
      frame_count        INTEGER NOT NULL,
      payload_bytes      INTEGER NOT NULL,
      segment_bytes      INTEGER NOT NULL,
      payload_hash       TEXT NOT NULL,
      segment_hash       TEXT NOT NULL,
      writer_elapsed_ns  INTEGER NOT NULL,
      PRIMARY KEY(epoch_id, segment_sequence),
      UNIQUE(epoch_id, segment_ref),
      FOREIGN KEY(epoch_id) REFERENCES l2_epoch_manifest(epoch_id)
    )
  `)
}

export function admitL2EpochManifest(db: Database, input: L2EpochAdmissionInput): L2EpochAdmissionResult {
  const root = realpathSync(resolve(input.repository_root))
  const manifestPath = resolveRuntimeEvidencePath(root, input.manifest_path)
  const manifestBytes = readRegularFile(manifestPath, "manifest")
  const manifest = parseManifest(manifestBytes)
  verifyManifestEvidence(manifest, manifestPath, root)

  const manifestHash = sha256(manifestBytes)
  const manifestRef = normalizedRelative(root, manifestPath)
  const epochId = `binance-usdm:${manifest.symbol}:${manifest.stream_epoch}`
  const admittedAt = input.admitted_at ?? new Date().toISOString()
  requireUtc(admittedAt, "admitted_at")
  const existing = db.query(`
    SELECT manifest_hash FROM l2_epoch_manifest WHERE epoch_id = $epoch_id
  `).get({ $epoch_id: epochId }) as { manifest_hash: string } | null
  if (existing != null) {
    if (existing.manifest_hash !== manifestHash) throw new Error("L2 epoch already exists with different content")
    const epoch = readL2EpochManifest(db, epochId)
    if (epoch == null) throw new Error("stored L2 epoch disappeared during admission")
    return { commit_status: "existing", epoch }
  }

  const commit = db.transaction(() => {
    db.query(`
      INSERT INTO l2_epoch_manifest(
        epoch_id, schema_version, exchange, symbol, stream_epoch, started_at_ms,
        finished_at_ms, continuity_status, termination_reason, snapshot_ref,
        snapshot_hash, last_update_id, received_messages, recorded_frames,
        applied_events, manifest_path, manifest_hash, admitted_at,
        source_completeness, external_completeness, manifest_json
      ) VALUES (
        $epoch_id, $schema_version, 'binance-usdm', $symbol, $stream_epoch, $started_at_ms,
        $finished_at_ms, $continuity_status, $termination_reason, $snapshot_ref,
        $snapshot_hash, $last_update_id, $received_messages, $recorded_frames,
        $applied_events, $manifest_path, $manifest_hash, $admitted_at,
        'epoch_contiguous', 'not_verified', $manifest_json
      )
    `).run({
      $epoch_id: epochId,
      $schema_version: manifest.schema_version,
      $symbol: manifest.symbol,
      $stream_epoch: manifest.stream_epoch,
      $started_at_ms: manifest.started_at_ms,
      $finished_at_ms: manifest.finished_at_ms,
      $continuity_status: manifest.continuity_status,
      $termination_reason: manifest.termination_reason,
      $snapshot_ref: manifest.snapshot_ref,
      $snapshot_hash: manifest.snapshot_hash,
      $last_update_id: manifest.last_update_id,
      $received_messages: manifest.received_messages,
      $recorded_frames: manifest.recorded_frames,
      $applied_events: manifest.applied_events,
      $manifest_path: manifestRef,
      $manifest_hash: manifestHash,
      $admitted_at: admittedAt,
      $manifest_json: manifestBytes.toString("utf8"),
    })
    const insertSegment = db.query(`
      INSERT INTO l2_segment_manifest(
        epoch_id, segment_sequence, segment_ref, frame_count, payload_bytes,
        segment_bytes, payload_hash, segment_hash, writer_elapsed_ns
      ) VALUES (
        $epoch_id, $segment_sequence, $segment_ref, $frame_count, $payload_bytes,
        $segment_bytes, $payload_hash, $segment_hash, $writer_elapsed_ns
      )
    `)
    for (const [index, segment] of manifest.segments.entries()) {
      insertSegment.run({
        $epoch_id: epochId,
        $segment_sequence: index + 1,
        $segment_ref: segment.path,
        $frame_count: segment.frame_count,
        $payload_bytes: segment.payload_bytes,
        $segment_bytes: segment.segment_bytes,
        $payload_hash: segment.payload_hash,
        $segment_hash: segment.segment_hash,
        $writer_elapsed_ns: segment.writer_elapsed_ns,
      })
    }
  })
  commit()
  const epoch = readL2EpochManifest(db, epochId)
  if (epoch == null) throw new Error("admitted L2 epoch is unreadable")
  return { commit_status: "created", epoch }
}

export function readL2EpochManifest(db: Database, epochId: string): AdmittedL2Epoch | null {
  const row = db.query(`
    SELECT epoch_id, exchange, manifest_path, manifest_hash, admitted_at,
      source_completeness, external_completeness, manifest_json
    FROM l2_epoch_manifest WHERE epoch_id = $epoch_id
  `).get({ $epoch_id: epochId }) as {
    epoch_id: string
    exchange: string
    manifest_path: string
    manifest_hash: string
    admitted_at: string
    source_completeness: string
    external_completeness: string
    manifest_json: string
  } | null
  if (row == null) return null
  if (row.exchange !== "binance-usdm" || row.source_completeness !== "epoch_contiguous" || row.external_completeness !== "not_verified") {
    throw new Error("stored L2 epoch authority labels are invalid")
  }
  const bytes = Buffer.from(row.manifest_json)
  if (sha256(bytes) !== row.manifest_hash) throw new Error("stored L2 epoch manifest hash mismatch")
  return {
    epoch_id: row.epoch_id,
    exchange: "binance-usdm",
    manifest_path: row.manifest_path,
    manifest_hash: row.manifest_hash,
    admitted_at: row.admitted_at,
    source_completeness: "epoch_contiguous",
    external_completeness: "not_verified",
    manifest: parseManifest(bytes),
  }
}

function verifyManifestEvidence(manifest: L2EpochManifestProposal, manifestPath: string, root: string): void {
  if (manifest.continuity_status !== "complete") throw new Error("only complete L2 epochs are admissible")
  if (manifest.last_update_id == null) throw new Error("complete L2 epoch requires last_update_id")
  const directory = dirname(manifestPath)
  const snapshotPath = resolveSibling(directory, manifest.snapshot_ref)
  ensureInside(root, snapshotPath)
  const snapshotBytes = readRegularFile(snapshotPath, "snapshot")
  if (sha256(snapshotBytes) !== manifest.snapshot_hash) throw new Error("L2 snapshot hash mismatch")
  const snapshot = JSON.parse(snapshotBytes.toString("utf8")) as { lastUpdateId?: unknown }
  const snapshotUpdateId = requireSafeInteger(snapshot.lastUpdateId, "snapshot lastUpdateId", 1)
  if (manifest.last_update_id < snapshotUpdateId) throw new Error("L2 epoch last_update_id precedes snapshot")

  const refs = new Set<string>()
  let frames = 0
  for (const segment of manifest.segments) {
    if (refs.has(segment.path)) throw new Error("L2 segment refs must be unique")
    refs.add(segment.path)
    const segmentPath = resolveSibling(directory, segment.path)
    ensureInside(root, segmentPath)
    const bytes = readRegularFile(segmentPath, "segment")
    if (bytes.byteLength !== segment.segment_bytes || sha256(bytes) !== segment.segment_hash) {
      throw new Error(`L2 segment byte/hash mismatch: ${segment.path}`)
    }
    const verified = verifyTl2s(bytes)
    if (verified.frame_count !== segment.frame_count
      || verified.payload_bytes !== segment.payload_bytes
      || verified.payload_hash !== segment.payload_hash) {
      throw new Error(`L2 segment descriptor mismatch: ${segment.path}`)
    }
    frames += verified.frame_count
  }
  if (frames !== manifest.recorded_frames) throw new Error("L2 recorded frame count does not close segment evidence")
}

function parseManifest(bytes: Buffer): L2EpochManifestProposal {
  const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>
  if (value.schema_version !== L2_EPOCH_MANIFEST_SCHEMA_VERSION) throw new Error("unsupported L2 epoch manifest schema")
  const symbol = requireString(value.symbol, "symbol")
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error("L2 symbol is invalid")
  const continuity = requireString(value.continuity_status, "continuity_status")
  if (continuity !== "complete" && continuity !== "incomplete") throw new Error("L2 continuity_status is invalid")
  const started = requireSafeInteger(value.started_at_ms, "started_at_ms", 1)
  const finished = requireSafeInteger(value.finished_at_ms, "finished_at_ms", 1)
  if (finished < started) throw new Error("L2 epoch finishes before it starts")
  const received = requireSafeInteger(value.received_messages, "received_messages", 0)
  const recorded = requireSafeInteger(value.recorded_frames, "recorded_frames", 0)
  const applied = requireSafeInteger(value.applied_events, "applied_events", 0)
  if (applied > recorded || recorded > received) throw new Error("L2 epoch counts are inconsistent")
  if (!Array.isArray(value.segments) || value.segments.length === 0) throw new Error("L2 epoch requires finalized segments")
  const segments = value.segments.map((entry, index) => parseSegment(entry, index))
  const updateId = value.last_update_id == null ? null : requireSafeInteger(value.last_update_id, "last_update_id", 1)
  return {
    schema_version: L2_EPOCH_MANIFEST_SCHEMA_VERSION,
    symbol,
    stream_epoch: requireString(value.stream_epoch, "stream_epoch"),
    started_at_ms: started,
    finished_at_ms: finished,
    continuity_status: continuity,
    termination_reason: requireString(value.termination_reason, "termination_reason"),
    snapshot_ref: requireSiblingRef(value.snapshot_ref, "snapshot_ref"),
    snapshot_hash: requireHash(value.snapshot_hash, "snapshot_hash"),
    last_update_id: updateId,
    received_messages: received,
    recorded_frames: recorded,
    applied_events: applied,
    segments,
  }
}

function parseSegment(value: unknown, index: number): L2SegmentDescriptor {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`L2 segment ${index + 1} is invalid`)
  const item = value as Record<string, unknown>
  return {
    path: requireSiblingRef(item.path, `segments[${index}].path`),
    frame_count: requireSafeInteger(item.frame_count, `segments[${index}].frame_count`, 1),
    payload_bytes: requireSafeInteger(item.payload_bytes, `segments[${index}].payload_bytes`, 1),
    segment_bytes: requireSafeInteger(item.segment_bytes, `segments[${index}].segment_bytes`, 17),
    payload_hash: requireHash(item.payload_hash, `segments[${index}].payload_hash`),
    segment_hash: requireHash(item.segment_hash, `segments[${index}].segment_hash`),
    writer_elapsed_ns: requireSafeInteger(item.writer_elapsed_ns, `segments[${index}].writer_elapsed_ns`, 0),
  }
}

function verifyTl2s(bytes: Buffer): { frame_count: number; payload_bytes: number; payload_hash: string } {
  if (bytes.byteLength < 8 || bytes.subarray(0, 4).toString("ascii") !== "TL2S" || bytes.readUInt16BE(4) !== 1 || bytes.readUInt16BE(6) !== 0) {
    throw new Error("invalid TL2S header")
  }
  const payloadHash = createHash("sha256")
  let offset = 8
  let frameCount = 0
  let payloadBytes = 0
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 8) throw new Error("truncated TL2S frame header")
    const length = bytes.readUInt32BE(offset)
    const checksum = bytes.readUInt32BE(offset + 4)
    if (length === 0 || length > 16 * 1024 * 1024) throw new Error("invalid TL2S payload length")
    const end = offset + 8 + length
    if (end > bytes.byteLength) throw new Error("truncated TL2S payload")
    const payload = bytes.subarray(offset + 8, end)
    if (crc32(payload) !== checksum) throw new Error("TL2S checksum mismatch")
    payloadHash.update(payload)
    payloadBytes += length
    frameCount += 1
    offset = end
  }
  return { frame_count: frameCount, payload_bytes: payloadBytes, payload_hash: payloadHash.digest("hex") }
}

function resolveRuntimeEvidencePath(root: string, ref: string): string {
  if (typeof ref !== "string" || ref.length === 0) throw new Error("manifest_path is required")
  const normalized = ref.replaceAll("\\", "/")
  if (!(normalized.startsWith("data/l2/") || normalized.startsWith("tmp/l2-order-book-service/"))) {
    throw new Error("L2 manifest must stay under data/l2/ or tmp/l2-order-book-service/")
  }
  const path = resolve(root, ref)
  ensureInside(root, path)
  return path
}

function resolveSibling(directory: string, ref: string): string {
  if (basename(ref) !== ref || ref === "." || ref === "..") throw new Error("L2 evidence refs must be sibling basenames")
  return resolve(directory, ref)
}

function readRegularFile(path: string, label: string): Buffer {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`L2 ${label} must be a regular non-symlink file`)
  return readFileSync(path)
}

function ensureInside(root: string, path: string): void {
  const rel = normalizedRelative(root, path)
  if (rel === ".." || rel.startsWith("../") || rel.length === 0) throw new Error("L2 evidence path escapes repository")
}

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/")
}

function requireSiblingRef(value: unknown, field: string): string {
  const text = requireString(value, field)
  if (basename(text) !== text || text === "." || text === "..") throw new Error(`${field} must be a sibling basename`)
  return text
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
  return value
}

function requireHash(value: unknown, field: string): string {
  const text = requireString(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${field} must be a lowercase sha256 digest`)
  return text
}

function requireSafeInteger(value: unknown, field: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error(`${field} must be a safe integer >= ${minimum}`)
  return value
}

function requireUtc(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
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
