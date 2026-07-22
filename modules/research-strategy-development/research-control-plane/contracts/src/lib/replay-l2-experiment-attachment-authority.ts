import { canonicalHash } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"

export const REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_SCHEMA_VERSION =
  "trade.rd-replay-l2-experiment-attachment-authority.v1" as const

export const REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_LIMITATIONS = Object.freeze([
  "source-external-completeness-not-verified",
  "single-compacted-epoch-and-one-exact-validated-batch-only",
  "no-cross-epoch-or-unbound-frame-read",
  "public-depth-deltas-do-not-prove-hypothetical-queue-position",
  "no-fill-quantity-maker-probability-slippage-impact-or-economic-authority",
  "separate-attachment-does-not-mutate-the-ohlcv-dataset-manifest",
  "replay-runner-not-bound",
] as const)

export interface ReplayL2ExperimentAttachmentAuthoritySnapshot {
  schema_version: typeof REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_SCHEMA_VERSION
  authority_snapshot_id: string
  authority_snapshot_ref: string
  authority_snapshot_hash: string
  status: "authorized"
  issued_at: string
  authority_id: string
  authority_policy_version: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  request_schema_version: string
  request_hash: string
  dataset_manifest_id: string
  dataset_manifest_ref: string
  dataset_data_hash: string
  dataset_manifest_hash: string
  venue_id: "binance-usdm"
  symbol: string
  source_id: string
  source_hash: string
  compaction_id: string
  epoch_id: string
  stream_epoch: string
  source_row_count: number
  source_parquet_hash: string
  source_retention_class: "compacted_pinned"
  source_deletion_eligible: false
  batch_id: string
  batch_hash: string
  batch_rows_hash: string
  batch_offset: number
  batch_row_count: number
  batch_next_offset: number
  frame_start_inclusive: number
  frame_end_exclusive: number
  batch_exhausted: boolean
  attachment_scope: "one_exact_validated_batch_within_one_compacted_epoch"
  gap_policy: "reject_missing_frame_and_cross_epoch_join"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  external_completeness: "not_verified"
  limitations: Array<typeof REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_LIMITATIONS[number]>
  limitations_hash: string
}

export type ReplayL2ExperimentAttachmentAuthorityBody = Omit<
  ReplayL2ExperimentAttachmentAuthoritySnapshot,
  "authority_snapshot_hash"
>

export function createReplayL2ExperimentAttachmentAuthoritySnapshot(
  body: ReplayL2ExperimentAttachmentAuthorityBody,
): ReplayL2ExperimentAttachmentAuthoritySnapshot {
  const value = { ...body, authority_snapshot_hash: canonicalHash(body) }
  assertReplayL2ExperimentAttachmentAuthoritySnapshot(value)
  return value
}

export function assertReplayL2ExperimentAttachmentAuthoritySnapshot(
  value: ReplayL2ExperimentAttachmentAuthoritySnapshot,
): void {
  if (value.schema_version !== REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_SCHEMA_VERSION
      || value.status !== "authorized" || value.venue_id !== "binance-usdm"
      || value.source_retention_class !== "compacted_pinned"
      || value.source_deletion_eligible !== false
      || value.attachment_scope !== "one_exact_validated_batch_within_one_compacted_epoch"
      || value.gap_policy !== "reject_missing_frame_and_cross_epoch_join"
      || value.economic_authority !== "none" || value.runner_compatibility !== "not_bound"
      || value.external_completeness !== "not_verified") {
    throw new Error("unsupported Replay L2 experiment attachment authority")
  }
  requireExactFields(value)
  for (const [field, item] of Object.entries({
    authority_snapshot_id: value.authority_snapshot_id,
    authority_snapshot_ref: value.authority_snapshot_ref,
    authority_id: value.authority_id,
    authority_policy_version: value.authority_policy_version,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    request_schema_version: value.request_schema_version,
    dataset_manifest_id: value.dataset_manifest_id,
    dataset_manifest_ref: value.dataset_manifest_ref,
    symbol: value.symbol,
    source_id: value.source_id,
    compaction_id: value.compaction_id,
    epoch_id: value.epoch_id,
    stream_epoch: value.stream_epoch,
    batch_id: value.batch_id,
  })) requireText(item, `Replay L2 attachment ${field}`)
  if (!/^[A-Z0-9]{5,20}$/.test(value.symbol)) throw new Error("Replay L2 attachment symbol is invalid")
  for (const [field, item] of Object.entries({
    authority_snapshot_hash: value.authority_snapshot_hash,
    reservation_hash: value.reservation_hash,
    request_hash: value.request_hash,
    dataset_data_hash: value.dataset_data_hash,
    dataset_manifest_hash: value.dataset_manifest_hash,
    source_hash: value.source_hash,
    source_parquet_hash: value.source_parquet_hash,
    batch_hash: value.batch_hash,
    batch_rows_hash: value.batch_rows_hash,
    limitations_hash: value.limitations_hash,
  })) requireHash(item, `Replay L2 attachment ${field}`)
  requireUtc(value.issued_at, "Replay L2 attachment issued_at")
  requirePositiveSafeInteger(value.source_row_count, "Replay L2 attachment source_row_count")
  requireNonNegativeSafeInteger(value.batch_offset, "Replay L2 attachment batch_offset")
  requirePositiveSafeInteger(value.batch_row_count, "Replay L2 attachment batch_row_count")
  requirePositiveSafeInteger(value.batch_next_offset, "Replay L2 attachment batch_next_offset")
  requirePositiveSafeInteger(value.frame_start_inclusive, "Replay L2 attachment frame_start_inclusive")
  requirePositiveSafeInteger(value.frame_end_exclusive, "Replay L2 attachment frame_end_exclusive")
  if (value.batch_next_offset !== value.batch_offset + value.batch_row_count
      || value.batch_next_offset > value.source_row_count
      || value.frame_start_inclusive !== value.batch_offset + 1
      || value.frame_end_exclusive !== value.batch_next_offset + 1
      || value.frame_end_exclusive - value.frame_start_inclusive !== value.batch_row_count
      || value.batch_exhausted !== (value.batch_next_offset === value.source_row_count)) {
    throw new Error("Replay L2 attachment frame and batch bounds are inconsistent")
  }
  if (JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_LIMITATIONS)
      || value.limitations_hash !== canonicalHash(REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_LIMITATIONS)) {
    throw new Error("Replay L2 attachment limitations drifted")
  }
  const { authority_snapshot_hash: _hash, ...body } = value
  if (value.authority_snapshot_hash !== canonicalHash(body)) {
    throw new Error("Replay L2 attachment authority hash mismatch")
  }
}

function requireExactFields(value: ReplayL2ExperimentAttachmentAuthoritySnapshot): void {
  const expected: Array<keyof ReplayL2ExperimentAttachmentAuthoritySnapshot> = [
    "schema_version", "authority_snapshot_id", "authority_snapshot_ref", "authority_snapshot_hash",
    "status", "issued_at", "authority_id", "authority_policy_version", "trial_id", "run_id",
    "reservation_ref", "reservation_hash", "request_schema_version", "request_hash",
    "dataset_manifest_id", "dataset_manifest_ref", "dataset_data_hash", "dataset_manifest_hash",
    "venue_id", "symbol", "source_id", "source_hash", "compaction_id", "epoch_id", "stream_epoch",
    "source_row_count", "source_parquet_hash", "source_retention_class", "source_deletion_eligible",
    "batch_id", "batch_hash", "batch_rows_hash", "batch_offset", "batch_row_count",
    "batch_next_offset", "frame_start_inclusive", "frame_end_exclusive", "batch_exhausted",
    "attachment_scope", "gap_policy", "economic_authority", "runner_compatibility",
    "external_completeness", "limitations", "limitations_hash",
  ]
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected.sort())) {
    throw new Error("Replay L2 attachment authority field whitelist drift")
  }
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
}

function requireHash(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase sha256 digest`)
  }
}

function requirePositiveSafeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`)
  }
}

function requireNonNegativeSafeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
}

function requireUtc(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be RFC 3339 UTC`)
  }
}
