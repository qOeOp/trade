import { canonicalHash } from "./replay-contracts"

export const REPLAY_L2_COMPACTED_EPOCH_SOURCE_SCHEMA_VERSION =
  "trade.market-data-l2-compacted-epoch-source.v1" as const
export const REPLAY_L2_DEPTH_ROW_SCHEMA_VERSION = "trade.l2-parquet-row.v1" as const
export const REPLAY_L2_DEPTH_READ_BATCH_SCHEMA_VERSION = "trade.rd-replay-l2-depth-read-batch.v1" as const
export const REPLAY_L2_DEPTH_ADAPTER_POLICY_VERSION = "rd-replay-l2-single-epoch-bounded-read-v1" as const

export const REPLAY_L2_DEPTH_LIMITATIONS = Object.freeze([
  "external-completeness-not-verified",
  "single-epoch-only-no-cross-epoch-continuity",
  "public-depth-deltas-do-not-prove-hypothetical-queue-position",
  "no-fill-quantity-maker-probability-slippage-impact-or-economic-authority",
  "runner-dataset-and-control-plane-authority-not-bound",
] as const)

export interface ReplayL2CompactedEpochSource {
  schema_version: typeof REPLAY_L2_COMPACTED_EPOCH_SOURCE_SCHEMA_VERSION
  source_id: string
  compaction_id: string
  epoch_id: string
  venue_id: "binance-usdm"
  symbol: string
  stream_epoch: string
  source_manifest_path: string
  source_manifest_hash: string
  parquet_path: string
  parquet_hash: string
  parquet_bytes: number
  row_count: number
  first_local_receive_time_ms: number
  last_local_receive_time_ms: number
  first_final_update_id: number
  last_final_update_id: number
  continuity_scope: "single_epoch_contiguous"
  external_completeness: "not_verified"
  retention_class: "compacted_pinned"
  deletion_eligible: false
  admitted_at: string
  source_hash: string
}

export interface ReplayL2DepthRow {
  schema_version: typeof REPLAY_L2_DEPTH_ROW_SCHEMA_VERSION
  symbol: string
  stream_epoch: string
  frame_index: number
  local_receive_time_ms: number
  exchange_event_time_ms: number
  transaction_time_ms: number
  first_update_id: number
  final_update_id: number
  previous_final_update_id: number
  raw_payload_hash: string
  raw_payload: string
}

export interface ReplayL2DepthReadBatch {
  schema_version: typeof REPLAY_L2_DEPTH_READ_BATCH_SCHEMA_VERSION
  policy_version: typeof REPLAY_L2_DEPTH_ADAPTER_POLICY_VERSION
  batch_id: string
  source_id: string
  source_hash: string
  compaction_id: string
  offset: number
  requested_limit: number
  row_count: number
  next_offset: number
  exhausted: boolean
  predecessor_final_update_id: number | null
  rows: ReplayL2DepthRow[]
  rows_hash: string
  continuity_result: "passed"
  gap_policy: "reject_missing_frame_and_cross_epoch_join"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  external_completeness: "not_verified"
  limitations: Array<typeof REPLAY_L2_DEPTH_LIMITATIONS[number]>
  batch_hash: string
}

export type ReplayL2CompactedEpochSourceBody = Omit<
  ReplayL2CompactedEpochSource,
  "source_id" | "source_hash"
>
export type ReplayL2DepthReadBatchBody = Omit<ReplayL2DepthReadBatch, "batch_hash">

export function replayL2CompactedEpochSourceHash(value: ReplayL2CompactedEpochSourceBody): string {
  return canonicalHash(value)
}

export function replayL2DepthReadBatchHash(value: ReplayL2DepthReadBatchBody): string {
  return canonicalHash(value)
}

export function assertReplayL2CompactedEpochSource(value: ReplayL2CompactedEpochSource): void {
  if (value.schema_version !== REPLAY_L2_COMPACTED_EPOCH_SOURCE_SCHEMA_VERSION
      || value.venue_id !== "binance-usdm"
      || value.continuity_scope !== "single_epoch_contiguous"
      || value.external_completeness !== "not_verified"
      || value.retention_class !== "compacted_pinned"
      || value.deletion_eligible !== false) {
    throw new Error("unsupported Replay L2 compacted epoch source")
  }
  for (const [field, item] of Object.entries({
    source_id: value.source_id,
    compaction_id: value.compaction_id,
    epoch_id: value.epoch_id,
    symbol: value.symbol,
    stream_epoch: value.stream_epoch,
  })) requireText(item, `Replay L2 source ${field}`)
  if (!/^[A-Z0-9]{5,20}$/.test(value.symbol)) throw new Error("Replay L2 source symbol is invalid")
  for (const [field, item] of Object.entries({
    source_manifest_hash: value.source_manifest_hash,
    parquet_hash: value.parquet_hash,
    source_hash: value.source_hash,
  })) requireHash(item, `Replay L2 source ${field}`)
  requireScopedRef(value.source_manifest_path, "source_manifest_path", ["data/l2", "tmp/l2-order-book-service"])
  requireScopedRef(value.parquet_path, "parquet_path", ["data/l2-parquet", "tmp/l2-order-book-compactor"])
  for (const [field, item] of Object.entries({
    parquet_bytes: value.parquet_bytes,
    row_count: value.row_count,
    first_local_receive_time_ms: value.first_local_receive_time_ms,
    last_local_receive_time_ms: value.last_local_receive_time_ms,
    first_final_update_id: value.first_final_update_id,
    last_final_update_id: value.last_final_update_id,
  })) requirePositiveSafeInteger(item, `Replay L2 source ${field}`)
  if (value.first_local_receive_time_ms > value.last_local_receive_time_ms
      || value.first_final_update_id > value.last_final_update_id) {
    throw new Error("Replay L2 source coverage is reversed")
  }
  requireUtc(value.admitted_at, "Replay L2 source admitted_at")
  const { source_id: _sourceId, source_hash: _sourceHash, ...body } = value
  const expected = replayL2CompactedEpochSourceHash(body)
  if (value.source_hash !== expected || value.source_id !== `l2-compacted-epoch:${expected}`) {
    throw new Error("Replay L2 source identity mismatch")
  }
}

export function assertReplayL2DepthRow(value: ReplayL2DepthRow): void {
  if (value.schema_version !== REPLAY_L2_DEPTH_ROW_SCHEMA_VERSION) {
    throw new Error("unsupported Replay L2 depth row")
  }
  for (const [field, item] of Object.entries({
    symbol: value.symbol,
    stream_epoch: value.stream_epoch,
    raw_payload: value.raw_payload,
  })) requireText(item, `Replay L2 row ${field}`)
  requireHash(value.raw_payload_hash, "Replay L2 row raw_payload_hash")
  for (const [field, item] of Object.entries({
    frame_index: value.frame_index,
    local_receive_time_ms: value.local_receive_time_ms,
    exchange_event_time_ms: value.exchange_event_time_ms,
    transaction_time_ms: value.transaction_time_ms,
    first_update_id: value.first_update_id,
    final_update_id: value.final_update_id,
    previous_final_update_id: value.previous_final_update_id,
  })) requirePositiveSafeInteger(item, `Replay L2 row ${field}`)
  if (value.first_update_id > value.final_update_id) throw new Error("Replay L2 row update range is reversed")
}

export function assertReplayL2DepthReadBatch(value: ReplayL2DepthReadBatch): void {
  if (value.schema_version !== REPLAY_L2_DEPTH_READ_BATCH_SCHEMA_VERSION
      || value.policy_version !== REPLAY_L2_DEPTH_ADAPTER_POLICY_VERSION
      || value.continuity_result !== "passed"
      || value.gap_policy !== "reject_missing_frame_and_cross_epoch_join"
      || value.economic_authority !== "none" || value.runner_compatibility !== "not_bound"
      || value.external_completeness !== "not_verified") {
    throw new Error("unsupported Replay L2 depth read batch")
  }
  for (const [field, item] of Object.entries({
    batch_id: value.batch_id,
    source_id: value.source_id,
    compaction_id: value.compaction_id,
  })) requireText(item, `Replay L2 batch ${field}`)
  for (const [field, item] of Object.entries({
    source_hash: value.source_hash,
    rows_hash: value.rows_hash,
    batch_hash: value.batch_hash,
  })) requireHash(item, `Replay L2 batch ${field}`)
  for (const [field, item] of Object.entries({
    offset: value.offset,
    row_count: value.row_count,
    next_offset: value.next_offset,
  })) requireNonNegativeSafeInteger(item, `Replay L2 batch ${field}`)
  requirePositiveSafeInteger(value.requested_limit, "Replay L2 batch requested_limit")
  if (value.requested_limit > 1_000 || value.row_count !== value.rows.length
      || value.row_count > value.requested_limit || value.next_offset !== value.offset + value.row_count
      || value.predecessor_final_update_id != null
        && (!Number.isSafeInteger(value.predecessor_final_update_id) || value.predecessor_final_update_id <= 0)) {
    throw new Error("Replay L2 batch bounds are invalid")
  }
  if (JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_L2_DEPTH_LIMITATIONS)) {
    throw new Error("Replay L2 batch limitations drifted")
  }
  value.rows.forEach(assertReplayL2DepthRow)
  if (value.rows_hash !== canonicalHash(value.rows)) throw new Error("Replay L2 batch rows hash mismatch")
  const { batch_hash: _batchHash, ...body } = value
  if (value.batch_hash !== replayL2DepthReadBatchHash(body)) {
    throw new Error("Replay L2 batch hash mismatch")
  }
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
}

function requireHash(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a lowercase sha256 digest`)
}

function requirePositiveSafeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive safe integer`)
}

function requireNonNegativeSafeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`)
}

function requireUtc(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be RFC 3339 UTC`)
}

function requireScopedRef(value: unknown, field: string, roots: string[]): asserts value is string {
  requireText(value, field)
  const normalized = value.replaceAll("\\", "/")
  if (normalized.startsWith("/") || normalized.split("/").includes("..")
      || !roots.some((root) => normalized.startsWith(`${root}/`))) {
    throw new Error(`Replay L2 source ${field} is outside its allowed roots`)
  }
}
