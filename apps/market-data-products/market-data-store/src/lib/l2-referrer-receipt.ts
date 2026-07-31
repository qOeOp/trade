import type { Database } from "bun:sqlite"
import { canonicalNfcHash, canonicalNfcJson } from "../../../../contracts/runtime-core/src/canonical-json"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { readL2CompactedEpochSource, type L2CompactedEpochSource } from "./l2-compaction"
import { readL2EpochManifest } from "./l2-epoch-manifest"

export const L2_REFERRER_RECEIPT_SCHEMA_VERSION =
  "trade.market-data-l2-experiment-attachment-referrer-receipt.v1" as const
export const L2_ATTACHMENT_AUTHORITY_SCHEMA_VERSION =
  "trade.rd-replay-l2-experiment-attachment-authority.v1" as const
export const L2_RETENTION_REFERENCE_AUDIT_SCHEMA_VERSION =
  "trade.market-data-l2-retention-reference-audit.v1" as const
export const L2_RETENTION_REFERENCE_AUDIT_PAGE_SCHEMA_VERSION =
  "trade.market-data-l2-retention-reference-audit-page.v1" as const

const L2_ATTACHMENT_LIMITATIONS = Object.freeze([
  "source-external-completeness-not-verified",
  "single-compacted-epoch-and-one-exact-validated-batch-only",
  "no-cross-epoch-or-unbound-frame-read",
  "public-depth-deltas-do-not-prove-hypothetical-queue-position",
  "no-fill-quantity-maker-probability-slippage-impact-or-economic-authority",
  "separate-attachment-does-not-mutate-the-ohlcv-dataset-manifest",
  "replay-runner-not-bound",
] as const)

interface L2AttachmentAuthorityEvidence extends JSONRecord {
  schema_version: typeof L2_ATTACHMENT_AUTHORITY_SCHEMA_VERSION
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
  limitations: string[]
  limitations_hash: string
}

export interface L2ExperimentAttachmentReferrerReceipt {
  schema_version: typeof L2_REFERRER_RECEIPT_SCHEMA_VERSION
  receipt_id: string
  receipt_hash: string
  registered_at: string
  referrer_owner: "research-control-plane.state-store"
  referrer_read_action: "read_replay_l2_experiment_attachment"
  authority_snapshot_id: string
  authority_snapshot_ref: string
  authority_snapshot_hash: string
  authority_policy_version: string
  reservation_hash: string
  request_hash: string
  dataset_manifest_hash: string
  source_id: string
  source_hash: string
  compaction_id: string
  epoch_id: string
  stream_epoch: string
  symbol: string
  source_row_count: number
  source_parquet_hash: string
  batch_id: string
  batch_hash: string
  frame_start_inclusive: number
  frame_end_exclusive: number
  reference_scope: "retention_catalog_reference_only"
  source_retention_class: "compacted_pinned"
  source_deletion_eligible: false
  deletion_authority: "none"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  external_completeness: "not_verified"
}

export interface L2RetentionReferenceAuditReferrer {
  receipt_id: string
  receipt_hash: string
  registered_at: string
  authority_snapshot_hash: string
  reservation_hash: string
  batch_hash: string
  frame_start_inclusive: number
  frame_end_exclusive: number
}

export interface L2RetentionReferenceAudit {
  schema_version: typeof L2_RETENTION_REFERENCE_AUDIT_SCHEMA_VERSION
  audit_scope: "registered_market_data_l2_referrers_only"
  epoch_id: string
  epoch_manifest_hash: string
  retention_class: "raw_hot" | "compacted_pinned"
  retention_updated_at: string
  compaction_id: string | null
  source_hash: string | null
  source_parquet_hash: string | null
  referrer_count: number
  referrers: L2RetentionReferenceAuditReferrer[]
  reference_status:
    | "raw_hot_not_compacted"
    | "compacted_pinned_no_registered_referrer"
    | "compacted_pinned_with_registered_referrers"
  external_referrer_completeness: "not_verified"
  deletion_eligible: false
  deletion_decision: "forbidden_no_gc_authority"
  limitations: string[]
  audit_hash: string
}

export interface L2RetentionReferenceAuditPageEntry {
  epoch_id: string
  epoch_manifest_hash: string
  retention_class: "raw_hot" | "compacted_pinned"
  reference_status: L2RetentionReferenceAudit["reference_status"]
  referrer_count: number
  deletion_eligible: false
  deletion_decision: "forbidden_no_gc_authority"
  audit_hash: string
}

export interface L2RetentionReferenceAuditPage {
  schema_version: typeof L2_RETENTION_REFERENCE_AUDIT_PAGE_SCHEMA_VERSION
  audit_scope: "registered_market_data_l2_referrers_only"
  cursor: { after_epoch_id: string | null; limit: number }
  page_count: number
  page_status_counts: {
    raw_hot_not_compacted: number
    compacted_pinned_no_registered_referrer: number
    compacted_pinned_with_registered_referrers: number
  }
  audits: L2RetentionReferenceAuditPageEntry[]
  has_more: boolean
  next_after_epoch_id: string | null
  external_referrer_completeness: "not_verified"
  deletion_candidates_produced: false
  deletion_decision: "forbidden_no_gc_authority"
  limitations: string[]
  page_hash: string
}

type ReceiptBody = Omit<L2ExperimentAttachmentReferrerReceipt, "receipt_hash">

interface ReceiptRow {
  receipt_hash: string
  authority_snapshot_hash: string
  compaction_id: string
  epoch_id: string
  receipt_json: string
}

export function ensureL2ReferrerReceiptSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS l2_experiment_attachment_referrer_receipt (
      receipt_id                TEXT PRIMARY KEY,
      receipt_hash              TEXT NOT NULL UNIQUE,
      registered_at             TEXT NOT NULL,
      authority_snapshot_id     TEXT NOT NULL UNIQUE,
      authority_snapshot_ref    TEXT NOT NULL UNIQUE,
      authority_snapshot_hash   TEXT NOT NULL UNIQUE,
      reservation_hash          TEXT NOT NULL UNIQUE,
      request_hash              TEXT NOT NULL UNIQUE,
      dataset_manifest_hash     TEXT NOT NULL,
      source_id                 TEXT NOT NULL,
      source_hash               TEXT NOT NULL,
      compaction_id             TEXT NOT NULL,
      epoch_id                  TEXT NOT NULL,
      batch_id                  TEXT NOT NULL,
      batch_hash                TEXT NOT NULL UNIQUE,
      frame_start_inclusive     INTEGER NOT NULL CHECK(frame_start_inclusive > 0),
      frame_end_exclusive       INTEGER NOT NULL CHECK(frame_end_exclusive > frame_start_inclusive),
      receipt_json              TEXT NOT NULL CHECK(json_valid(receipt_json)),
      FOREIGN KEY(compaction_id) REFERENCES l2_epoch_compaction(compaction_id),
      FOREIGN KEY(epoch_id) REFERENCES l2_epoch_manifest(epoch_id)
    )
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS l2_experiment_attachment_referrer_receipt_no_update
    BEFORE UPDATE ON l2_experiment_attachment_referrer_receipt
    BEGIN
      SELECT RAISE(ABORT, 'L2 experiment attachment referrer receipt is immutable');
    END
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS l2_experiment_attachment_referrer_receipt_no_delete
    BEFORE DELETE ON l2_experiment_attachment_referrer_receipt
    BEGIN
      SELECT RAISE(ABORT, 'L2 experiment attachment referrer receipt is immutable');
    END
  `)
}

export function registerL2ExperimentAttachmentReferrerReceipt(
  db: Database,
  input: { authority: JSONRecord; registered_at?: string },
): { commit_status: "created" | "existing"; receipt: L2ExperimentAttachmentReferrerReceipt } {
  const authority = assertL2AttachmentAuthorityEvidence(input.authority)
  const registeredAt = input.registered_at ?? new Date().toISOString()
  requireUtc(registeredAt, "registered_at")
  return db.transaction(() => {
    const source = readL2CompactedEpochSource(db, authority.compaction_id)
    if (source == null) throw new Error("L2 referrer authority compaction is not registered")
    assertAuthorityBindsLocalSource(authority, source)
    const existing = readReceiptRow(db, authority.authority_snapshot_hash)
    if (existing != null) return { commit_status: "existing" as const, receipt: parseReceiptRow(existing) }

    const receiptId = `l2-experiment-attachment-referrer:${authority.authority_snapshot_hash}`
    const body: ReceiptBody = {
      schema_version: L2_REFERRER_RECEIPT_SCHEMA_VERSION,
      receipt_id: receiptId,
      registered_at: registeredAt,
      referrer_owner: "research-control-plane.state-store",
      referrer_read_action: "read_replay_l2_experiment_attachment",
      authority_snapshot_id: authority.authority_snapshot_id,
      authority_snapshot_ref: authority.authority_snapshot_ref,
      authority_snapshot_hash: authority.authority_snapshot_hash,
      authority_policy_version: authority.authority_policy_version,
      reservation_hash: authority.reservation_hash,
      request_hash: authority.request_hash,
      dataset_manifest_hash: authority.dataset_manifest_hash,
      source_id: authority.source_id,
      source_hash: authority.source_hash,
      compaction_id: authority.compaction_id,
      epoch_id: authority.epoch_id,
      stream_epoch: authority.stream_epoch,
      symbol: authority.symbol,
      source_row_count: authority.source_row_count,
      source_parquet_hash: authority.source_parquet_hash,
      batch_id: authority.batch_id,
      batch_hash: authority.batch_hash,
      frame_start_inclusive: authority.frame_start_inclusive,
      frame_end_exclusive: authority.frame_end_exclusive,
      reference_scope: "retention_catalog_reference_only",
      source_retention_class: "compacted_pinned",
      source_deletion_eligible: false,
      deletion_authority: "none",
      economic_authority: "none",
      runner_compatibility: "not_bound",
      external_completeness: "not_verified",
    }
    const receipt: L2ExperimentAttachmentReferrerReceipt = { ...body, receipt_hash: canonicalNfcHash(body) }
    assertL2ExperimentAttachmentReferrerReceipt(receipt)
    db.query(`
      INSERT INTO l2_experiment_attachment_referrer_receipt(
        receipt_id, receipt_hash, registered_at, authority_snapshot_id,
        authority_snapshot_ref, authority_snapshot_hash, reservation_hash,
        request_hash, dataset_manifest_hash, source_id, source_hash, compaction_id,
        epoch_id, batch_id, batch_hash, frame_start_inclusive, frame_end_exclusive,
        receipt_json
      ) VALUES (
        $receipt_id, $receipt_hash, $registered_at, $authority_snapshot_id,
        $authority_snapshot_ref, $authority_snapshot_hash, $reservation_hash,
        $request_hash, $dataset_manifest_hash, $source_id, $source_hash, $compaction_id,
        $epoch_id, $batch_id, $batch_hash, $frame_start_inclusive, $frame_end_exclusive,
        $receipt_json
      )
    `).run({
      $receipt_id: receipt.receipt_id,
      $receipt_hash: receipt.receipt_hash,
      $registered_at: receipt.registered_at,
      $authority_snapshot_id: receipt.authority_snapshot_id,
      $authority_snapshot_ref: receipt.authority_snapshot_ref,
      $authority_snapshot_hash: receipt.authority_snapshot_hash,
      $reservation_hash: receipt.reservation_hash,
      $request_hash: receipt.request_hash,
      $dataset_manifest_hash: receipt.dataset_manifest_hash,
      $source_id: receipt.source_id,
      $source_hash: receipt.source_hash,
      $compaction_id: receipt.compaction_id,
      $epoch_id: receipt.epoch_id,
      $batch_id: receipt.batch_id,
      $batch_hash: receipt.batch_hash,
      $frame_start_inclusive: receipt.frame_start_inclusive,
      $frame_end_exclusive: receipt.frame_end_exclusive,
      $receipt_json: canonicalNfcJson(receipt),
    })
    return { commit_status: "created" as const, receipt: structuredClone(receipt) }
  }).immediate()
}

export function readL2ExperimentAttachmentReferrerReceipt(
  db: Database,
  authoritySnapshotHash: string,
): L2ExperimentAttachmentReferrerReceipt | null {
  requireHash(authoritySnapshotHash, "authority_snapshot_hash")
  const row = readReceiptRow(db, authoritySnapshotHash)
  return row == null ? null : parseReceiptRow(row)
}

export function auditL2RetentionReferenceClosure(
  db: Database,
  epochId: string,
): L2RetentionReferenceAudit {
  requireText(epochId, "epoch_id")
  const epoch = readL2EpochManifest(db, epochId)
  if (epoch == null) throw new Error("L2 retention reference audit epoch is not registered")
  const retention = db.query(`
    SELECT retention_class, compaction_ref, deletion_eligible, updated_at
    FROM l2_epoch_retention WHERE epoch_id = $epoch_id
  `).get({ $epoch_id: epochId }) as {
    retention_class: string
    compaction_ref: string | null
    deletion_eligible: number
    updated_at: string
  } | null
  if (retention == null || retention.deletion_eligible !== 0
      || !((retention.retention_class === "raw_hot" && retention.compaction_ref == null)
        || (retention.retention_class === "compacted_pinned" && retention.compaction_ref != null))) {
    throw new Error("L2 retention reference audit found an unsafe retention state")
  }
  requireUtc(retention.updated_at, "retention updated_at")
  const receiptRows = db.query(`
    SELECT receipt_hash, authority_snapshot_hash, compaction_id, epoch_id, receipt_json
    FROM l2_experiment_attachment_referrer_receipt
    WHERE epoch_id = $epoch_id
    ORDER BY authority_snapshot_hash
  `).all({ $epoch_id: epochId }) as ReceiptRow[]
  const receipts = receiptRows.map(parseReceiptRow)
  let source: L2CompactedEpochSource | null = null
  if (retention.retention_class === "raw_hot") {
    if (receipts.length > 0) throw new Error("raw-hot L2 epoch cannot own compacted-source referrers")
  } else {
    source = readL2CompactedEpochSource(db, retention.compaction_ref!)
    if (source == null || source.epoch_id !== epochId) {
      throw new Error("L2 retention reference audit cannot resolve the pinned compaction source")
    }
    for (const receipt of receipts) {
      if (receipt.compaction_id !== source.compaction_id || receipt.epoch_id !== source.epoch_id
          || receipt.source_id !== source.source_id || receipt.source_hash !== source.source_hash
          || receipt.source_parquet_hash !== source.parquet_hash
          || receipt.source_row_count !== source.row_count) {
        throw new Error("L2 retention reference audit found a referrer/source binding drift")
      }
    }
  }
  const referrers = receipts.map((receipt): L2RetentionReferenceAuditReferrer => ({
    receipt_id: receipt.receipt_id,
    receipt_hash: receipt.receipt_hash,
    registered_at: receipt.registered_at,
    authority_snapshot_hash: receipt.authority_snapshot_hash,
    reservation_hash: receipt.reservation_hash,
    batch_hash: receipt.batch_hash,
    frame_start_inclusive: receipt.frame_start_inclusive,
    frame_end_exclusive: receipt.frame_end_exclusive,
  }))
  const limitations = [
    "registered-catalog-only-not-global-reference-completeness",
    "absence-of-registered-referrers-does-not-prove-unreferenced",
    "compaction-and-referrer-presence-do-not-authorize-deletion",
    "raw-snapshot-manifest-parquet-and-incident-evidence-remain-non-deletable",
    "no-release-tombstone-or-gc-execution-authority",
  ]
  const body = {
    schema_version: L2_RETENTION_REFERENCE_AUDIT_SCHEMA_VERSION,
    audit_scope: "registered_market_data_l2_referrers_only" as const,
    epoch_id: epoch.epoch_id,
    epoch_manifest_hash: epoch.manifest_hash,
    retention_class: retention.retention_class as "raw_hot" | "compacted_pinned",
    retention_updated_at: retention.updated_at,
    compaction_id: source?.compaction_id ?? null,
    source_hash: source?.source_hash ?? null,
    source_parquet_hash: source?.parquet_hash ?? null,
    referrer_count: referrers.length,
    referrers,
    reference_status: retention.retention_class === "raw_hot"
      ? "raw_hot_not_compacted" as const
      : referrers.length === 0
        ? "compacted_pinned_no_registered_referrer" as const
        : "compacted_pinned_with_registered_referrers" as const,
    external_referrer_completeness: "not_verified" as const,
    deletion_eligible: false as const,
    deletion_decision: "forbidden_no_gc_authority" as const,
    limitations,
  }
  return { ...body, audit_hash: canonicalNfcHash(body) }
}

export function listL2RetentionReferenceAudits(
  db: Database,
  input: { after_epoch_id?: string; limit?: number } = {},
): L2RetentionReferenceAuditPage {
  const afterEpochId = input.after_epoch_id ?? null
  if (afterEpochId != null) requireText(afterEpochId, "after_epoch_id")
  const limit = input.limit ?? 20
  requirePositiveInteger(limit, "limit")
  if (limit > 50) throw new Error("limit must not exceed 50")
  return db.transaction(() => buildL2RetentionReferenceAuditPage(db, afterEpochId, limit))()
}

function buildL2RetentionReferenceAuditPage(
  db: Database,
  afterEpochId: string | null,
  limit: number,
): L2RetentionReferenceAuditPage {
  const rows = db.query(`
    SELECT epoch_id
    FROM l2_epoch_manifest
    WHERE $after_epoch_id IS NULL OR epoch_id > $after_epoch_id
    ORDER BY epoch_id
    LIMIT $scan_limit
  `).all({ $after_epoch_id: afterEpochId, $scan_limit: limit + 1 }) as Array<{ epoch_id: string }>
  const hasMore = rows.length > limit
  const selected = rows.slice(0, limit)
  const audits = selected.map(({ epoch_id }): L2RetentionReferenceAuditPageEntry => {
    const audit = auditL2RetentionReferenceClosure(db, epoch_id)
    return {
      epoch_id: audit.epoch_id,
      epoch_manifest_hash: audit.epoch_manifest_hash,
      retention_class: audit.retention_class,
      reference_status: audit.reference_status,
      referrer_count: audit.referrer_count,
      deletion_eligible: false,
      deletion_decision: "forbidden_no_gc_authority",
      audit_hash: audit.audit_hash,
    }
  })
  const pageStatusCounts = {
    raw_hot_not_compacted: audits.filter((audit) => audit.reference_status === "raw_hot_not_compacted").length,
    compacted_pinned_no_registered_referrer: audits.filter(
      (audit) => audit.reference_status === "compacted_pinned_no_registered_referrer",
    ).length,
    compacted_pinned_with_registered_referrers: audits.filter(
      (audit) => audit.reference_status === "compacted_pinned_with_registered_referrers",
    ).length,
  }
  const body = {
    schema_version: L2_RETENTION_REFERENCE_AUDIT_PAGE_SCHEMA_VERSION,
    audit_scope: "registered_market_data_l2_referrers_only" as const,
    cursor: { after_epoch_id: afterEpochId, limit },
    page_count: audits.length,
    page_status_counts: pageStatusCounts,
    audits,
    has_more: hasMore,
    next_after_epoch_id: hasMore ? audits.at(-1)?.epoch_id ?? null : null,
    external_referrer_completeness: "not_verified" as const,
    deletion_candidates_produced: false as const,
    deletion_decision: "forbidden_no_gc_authority" as const,
    limitations: [
      "page-is-not-global-referrer-completeness",
      "pagination-is-not-a-snapshot-across-calls",
      "status-counts-cover-current-page-only",
      "absence-of-registered-referrers-does-not-prove-unreferenced",
      "no-release-tombstone-file-deletion-or-gc-authority",
    ],
  }
  return { ...body, page_hash: canonicalNfcHash(body) }
}

function readReceiptRow(db: Database, authoritySnapshotHash: string): ReceiptRow | null {
  return db.query(`
    SELECT receipt_hash, authority_snapshot_hash, compaction_id, epoch_id, receipt_json
    FROM l2_experiment_attachment_referrer_receipt
    WHERE authority_snapshot_hash = $authority_snapshot_hash
  `).get({ $authority_snapshot_hash: authoritySnapshotHash }) as ReceiptRow | null
}

function parseReceiptRow(row: ReceiptRow): L2ExperimentAttachmentReferrerReceipt {
  const receipt = JSON.parse(row.receipt_json) as L2ExperimentAttachmentReferrerReceipt
  assertL2ExperimentAttachmentReferrerReceipt(receipt)
  if (receipt.receipt_hash !== row.receipt_hash
      || receipt.authority_snapshot_hash !== row.authority_snapshot_hash
      || receipt.compaction_id !== row.compaction_id || receipt.epoch_id !== row.epoch_id) {
    throw new Error("stored L2 referrer receipt row is inconsistent")
  }
  return receipt
}

function assertL2AttachmentAuthorityEvidence(value: JSONRecord): L2AttachmentAuthorityEvidence {
  const authority = value as L2AttachmentAuthorityEvidence
  const expectedFields = [
    "schema_version", "authority_snapshot_id", "authority_snapshot_ref", "authority_snapshot_hash",
    "status", "issued_at", "authority_id", "authority_policy_version", "trial_id", "run_id",
    "reservation_ref", "reservation_hash", "request_schema_version", "request_hash",
    "dataset_manifest_id", "dataset_manifest_ref", "dataset_data_hash", "dataset_manifest_hash",
    "venue_id", "symbol", "source_id", "source_hash", "compaction_id", "epoch_id", "stream_epoch",
    "source_row_count", "source_parquet_hash", "source_retention_class", "source_deletion_eligible",
    "batch_id", "batch_hash", "batch_rows_hash", "batch_offset", "batch_row_count", "batch_next_offset",
    "frame_start_inclusive", "frame_end_exclusive", "batch_exhausted", "attachment_scope", "gap_policy",
    "economic_authority", "runner_compatibility", "external_completeness", "limitations", "limitations_hash",
  ].sort()
  if (JSON.stringify(Object.keys(authority).sort()) !== JSON.stringify(expectedFields)) {
    throw new Error("L2 referrer authority field whitelist drift")
  }
  if (authority.schema_version !== L2_ATTACHMENT_AUTHORITY_SCHEMA_VERSION || authority.status !== "authorized"
      || authority.venue_id !== "binance-usdm" || authority.source_retention_class !== "compacted_pinned"
      || authority.source_deletion_eligible !== false
      || authority.attachment_scope !== "one_exact_validated_batch_within_one_compacted_epoch"
      || authority.gap_policy !== "reject_missing_frame_and_cross_epoch_join"
      || authority.economic_authority !== "none" || authority.runner_compatibility !== "not_bound"
      || authority.external_completeness !== "not_verified") {
    throw new Error("unsupported L2 referrer authority")
  }
  for (const [field, item] of Object.entries({
    authority_snapshot_id: authority.authority_snapshot_id,
    authority_snapshot_ref: authority.authority_snapshot_ref,
    authority_id: authority.authority_id,
    authority_policy_version: authority.authority_policy_version,
    trial_id: authority.trial_id,
    run_id: authority.run_id,
    reservation_ref: authority.reservation_ref,
    request_schema_version: authority.request_schema_version,
    dataset_manifest_id: authority.dataset_manifest_id,
    dataset_manifest_ref: authority.dataset_manifest_ref,
    symbol: authority.symbol,
    source_id: authority.source_id,
    compaction_id: authority.compaction_id,
    epoch_id: authority.epoch_id,
    stream_epoch: authority.stream_epoch,
    batch_id: authority.batch_id,
  })) requireText(item, `authority ${field}`)
  for (const [field, item] of Object.entries({
    authority_snapshot_hash: authority.authority_snapshot_hash,
    reservation_hash: authority.reservation_hash,
    request_hash: authority.request_hash,
    dataset_data_hash: authority.dataset_data_hash,
    dataset_manifest_hash: authority.dataset_manifest_hash,
    source_hash: authority.source_hash,
    source_parquet_hash: authority.source_parquet_hash,
    batch_hash: authority.batch_hash,
    batch_rows_hash: authority.batch_rows_hash,
    limitations_hash: authority.limitations_hash,
  })) requireHash(item, `authority ${field}`)
  requireUtc(authority.issued_at, "authority issued_at")
  requirePositiveInteger(authority.source_row_count, "authority source_row_count")
  requireNonNegativeInteger(authority.batch_offset, "authority batch_offset")
  requirePositiveInteger(authority.batch_row_count, "authority batch_row_count")
  requirePositiveInteger(authority.batch_next_offset, "authority batch_next_offset")
  requirePositiveInteger(authority.frame_start_inclusive, "authority frame_start_inclusive")
  requirePositiveInteger(authority.frame_end_exclusive, "authority frame_end_exclusive")
  if (authority.batch_next_offset !== authority.batch_offset + authority.batch_row_count
      || authority.batch_next_offset > authority.source_row_count
      || authority.frame_start_inclusive !== authority.batch_offset + 1
      || authority.frame_end_exclusive !== authority.batch_next_offset + 1
      || authority.batch_exhausted !== (authority.batch_next_offset === authority.source_row_count)) {
    throw new Error("L2 referrer authority batch bounds are inconsistent")
  }
  if (JSON.stringify(authority.limitations) !== JSON.stringify(L2_ATTACHMENT_LIMITATIONS)
      || authority.limitations_hash !== canonicalNfcHash(L2_ATTACHMENT_LIMITATIONS)) {
    throw new Error("L2 referrer authority limitations drifted")
  }
  const { authority_snapshot_hash: _hash, ...body } = authority
  if (authority.authority_snapshot_hash !== canonicalNfcHash(body)) {
    throw new Error("L2 referrer authority snapshot hash mismatch")
  }
  return authority
}

function assertAuthorityBindsLocalSource(
  authority: L2AttachmentAuthorityEvidence,
  source: L2CompactedEpochSource,
): void {
  if (authority.source_id !== source.source_id || authority.source_hash !== source.source_hash
      || authority.compaction_id !== source.compaction_id || authority.epoch_id !== source.epoch_id
      || authority.stream_epoch !== source.stream_epoch || authority.symbol !== source.symbol
      || authority.source_row_count !== source.row_count || authority.source_parquet_hash !== source.parquet_hash
      || authority.source_retention_class !== source.retention_class
      || authority.source_deletion_eligible !== source.deletion_eligible) {
    throw new Error("L2 referrer authority does not bind the local pinned source")
  }
}

function assertL2ExperimentAttachmentReferrerReceipt(
  receipt: L2ExperimentAttachmentReferrerReceipt,
): void {
  if (receipt.schema_version !== L2_REFERRER_RECEIPT_SCHEMA_VERSION
      || receipt.receipt_id !== `l2-experiment-attachment-referrer:${receipt.authority_snapshot_hash}`
      || receipt.referrer_owner !== "research-control-plane.state-store"
      || receipt.referrer_read_action !== "read_replay_l2_experiment_attachment"
      || receipt.reference_scope !== "retention_catalog_reference_only"
      || receipt.source_retention_class !== "compacted_pinned"
      || receipt.source_deletion_eligible !== false || receipt.deletion_authority !== "none"
      || receipt.economic_authority !== "none" || receipt.runner_compatibility !== "not_bound"
      || receipt.external_completeness !== "not_verified") {
    throw new Error("unsupported L2 experiment attachment referrer receipt")
  }
  requireUtc(receipt.registered_at, "receipt registered_at")
  requireHash(receipt.receipt_hash, "receipt_hash")
  requireHash(receipt.authority_snapshot_hash, "receipt authority_snapshot_hash")
  const { receipt_hash: _hash, ...body } = receipt
  if (receipt.receipt_hash !== canonicalNfcHash(body)) throw new Error("L2 referrer receipt hash mismatch")
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
}

function requireHash(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase sha256 digest`)
  }
}

function requireUtc(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be RFC 3339 UTC`)
}

function requirePositiveInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`)
  }
}

function requireNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
}
