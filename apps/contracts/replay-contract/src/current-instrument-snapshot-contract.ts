import { canonicalHash } from "../../runtime-core/src/canonical-json"
import {
  assertReplayInstrumentAccountingSpec,
  assertReplayInstrumentSpecSnapshot,
  type ReplayInstrumentAccountingSpec,
  type ReplayInstrumentSpecSnapshot,
} from "./replay-instrument-contract"
import {
  assertReplayInstrumentStatusSnapshot,
  type ReplayInstrumentStatusProvenance,
  type ReplayInstrumentStatusSnapshot,
} from "./replay-market-data-contract"

export const CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY_SCHEMA_VERSION =
  "trade.market-data-current-instrument-snapshot-provider-capability.v1" as const
export const CURRENT_INSTRUMENT_SNAPSHOT_EVIDENCE_SCHEMA_VERSION =
  "trade.market-data-current-instrument-snapshot-evidence.v1" as const
export const CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_ID =
  "market-data.current-instrument-snapshot-provider" as const
export const CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_VERSION = "v1" as const
export const CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_VERSION =
  "binance-usdm-current-instrument-snapshot-v1" as const

const NORMALIZATION_POLICY = {
  input: "successful-binance-usdm-exchange-info-current-snapshot",
  symbol_selection: "exact-symbol",
  status: "TRADING-is-trading-all-other-states-are-halted",
  effective_time: "receipt-completed-at",
  history_claim: "current-snapshot-only",
  listed_at: "onboardDate",
  trading_enabled_at: "receipt-completed-at",
  contract_multiplier: "one-linear-contract-unit",
  price_increment: "PRICE_FILTER.tickSize",
  quantity_increment: "LOT_SIZE.stepSize",
  settlement_increment: "quotePrecision-decimal-increment",
  unknown_or_invalid: "reject",
} as const

export const CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_HASH =
  canonicalHash(NORMALIZATION_POLICY)

const PROVIDER_BUILD_MANIFEST = {
  producer_id: CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_ID,
  producer_version: CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_VERSION,
  input_schema: "trade.market-data-instrument-status-acquisition-receipt.v2",
  output_schema: CURRENT_INSTRUMENT_SNAPSHOT_EVIDENCE_SCHEMA_VERSION,
  normalization_policy_version:
    CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_VERSION,
  normalization_policy_hash:
    CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_HASH,
} as const

export const CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_BUILD_HASH =
  canonicalHash(PROVIDER_BUILD_MANIFEST)

export interface CurrentInstrumentSnapshotProviderCapability {
  schema_version:
    typeof CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY_SCHEMA_VERSION
  producer_domain: "market-data-products"
  producer_id: typeof CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_ID
  producer_version: typeof CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_VERSION
  producer_build_hash: string
  normalization_policy_version:
    typeof CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_VERSION
  normalization_policy_hash: string
  accepted_source_kind: "venue_current_snapshot"
  emitted_completeness: "current_snapshot_only"
  emitted_components: ["instrument_status", "instrument_spec"]
  capability_hash: string
}

const CAPABILITY_BODY = {
  schema_version:
    CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY_SCHEMA_VERSION,
  producer_domain: "market-data-products",
  producer_id: CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_ID,
  producer_version: CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_VERSION,
  producer_build_hash: CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_BUILD_HASH,
  normalization_policy_version:
    CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_VERSION,
  normalization_policy_hash:
    CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_HASH,
  accepted_source_kind: "venue_current_snapshot",
  emitted_completeness: "current_snapshot_only",
  emitted_components: ["instrument_status", "instrument_spec"],
} as const

export const CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY:
  CurrentInstrumentSnapshotProviderCapability = {
    ...CAPABILITY_BODY,
    emitted_components: [...CAPABILITY_BODY.emitted_components],
    capability_hash: canonicalHash(CAPABILITY_BODY),
  }

export interface CurrentInstrumentSnapshotEvidence {
  schema_version:
    typeof CURRENT_INSTRUMENT_SNAPSHOT_EVIDENCE_SCHEMA_VERSION
  acquisition_id: string
  acquisition_receipt_hash: string
  payload_ref: string
  payload_content_hash: string
  raw_symbol_hash: string
  venue_id: "binance-usdm"
  symbol: string
  listed_at: string
  trading_enabled_at: string
  provider_capability: CurrentInstrumentSnapshotProviderCapability
  status_snapshot: ReplayInstrumentStatusSnapshot
  status_provenance: ReplayInstrumentStatusProvenance
  spec_snapshot: ReplayInstrumentSpecSnapshot
  accounting: ReplayInstrumentAccountingSpec
  evidence_limitation:
    "current_snapshot_does_not_prove_inter_sample_status_history"
  evidence_hash: string
}

export type CurrentInstrumentSnapshotEvidenceBody =
  Omit<CurrentInstrumentSnapshotEvidence, "evidence_hash">

export interface CurrentInstrumentSnapshotProviderCertificationBinding {
  certification_ref: string
  certification_hash: string
  provider_capability_hash: string
}

export function assertCurrentInstrumentSnapshotEvidence(
  evidence: CurrentInstrumentSnapshotEvidence,
): void {
  if (evidence.schema_version
      !== CURRENT_INSTRUMENT_SNAPSHOT_EVIDENCE_SCHEMA_VERSION
      || evidence.venue_id !== "binance-usdm"
      || evidence.evidence_limitation
        !== "current_snapshot_does_not_prove_inter_sample_status_history") {
    throw new Error("unsupported current instrument snapshot evidence")
  }
  for (const value of [
    evidence.acquisition_id,
    evidence.payload_ref,
    evidence.symbol,
  ]) {
    if (!value) {
      throw new Error("current instrument evidence identity is incomplete")
    }
  }
  for (const [field, value] of Object.entries({
    acquisition_receipt_hash: evidence.acquisition_receipt_hash,
    payload_content_hash: evidence.payload_content_hash,
    raw_symbol_hash: evidence.raw_symbol_hash,
    evidence_hash: evidence.evidence_hash,
  })) requireHash(value, field)
  utc(evidence.listed_at, "listed_at")
  utc(evidence.trading_enabled_at, "trading_enabled_at")
  if (Date.parse(evidence.listed_at) > Date.parse(evidence.trading_enabled_at)) {
    throw new Error("instrument lifecycle chronology is invalid")
  }
  if (canonicalHash(CAPABILITY_BODY)
      !== evidence.provider_capability.capability_hash
      || canonicalHash(evidence.provider_capability)
        !== canonicalHash(CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY)) {
    throw new Error("current instrument provider capability drifted")
  }
  assertReplayInstrumentStatusSnapshot(evidence.status_snapshot)
  assertReplayInstrumentSpecSnapshot(evidence.spec_snapshot)
  assertReplayInstrumentAccountingSpec(evidence.accounting)
  if (evidence.status_snapshot.symbol !== evidence.symbol
      || evidence.spec_snapshot.symbol !== evidence.symbol
      || evidence.status_snapshot.venue_id !== evidence.venue_id
      || evidence.spec_snapshot.venue_id !== evidence.venue_id
      || evidence.status_snapshot.observed_at
        !== evidence.status_snapshot.effective_at
      || evidence.spec_snapshot.observed_at
        !== evidence.status_snapshot.observed_at
      || evidence.status_snapshot.source_hash !== evidence.payload_content_hash
      || evidence.spec_snapshot.source_hash !== evidence.payload_content_hash
      || evidence.status_provenance.status_schedule_hash
        !== canonicalHash([evidence.status_snapshot])
      || evidence.status_provenance.producer_domain
        !== evidence.provider_capability.producer_domain
      || evidence.status_provenance.producer_id
        !== evidence.provider_capability.producer_id
      || evidence.status_provenance.producer_version
        !== evidence.provider_capability.producer_version
      || evidence.status_provenance.producer_build_hash
        !== evidence.provider_capability.producer_build_hash
      || evidence.status_provenance.normalization_policy_version
        !== evidence.provider_capability.normalization_policy_version
      || evidence.status_provenance.normalization_policy_hash
        !== evidence.provider_capability.normalization_policy_hash
      || evidence.status_provenance.completeness !== "current_snapshot_only"
      || evidence.status_provenance.source_kind !== "venue_current_snapshot"
      || evidence.status_provenance.source_owner !== "binance-usdm"
      || evidence.status_provenance.provider_capability_hash
        !== evidence.provider_capability.capability_hash
      || !evidence.status_provenance.provider_certification_ref
      || !/^[a-f0-9]{64}$/.test(
        evidence.status_provenance.provider_certification_hash,
      )
      || evidence.status_provenance.coverage_start
        !== evidence.status_snapshot.effective_at
      || Date.parse(evidence.status_provenance.coverage_end)
        !== Date.parse(evidence.status_snapshot.effective_at) + 1
      || evidence.status_provenance.source_observed_through
        !== evidence.status_snapshot.observed_at
      || Date.parse(evidence.status_provenance.produced_at)
        < Date.parse(evidence.status_snapshot.observed_at)
      || evidence.status_provenance.source_ref
        !== evidence.status_snapshot.source_ref
      || evidence.status_provenance.source_hash
        !== evidence.payload_content_hash
      || evidence.status_provenance.source_record_count !== 1
      || evidence.trading_enabled_at !== evidence.status_snapshot.effective_at
      || evidence.spec_snapshot.effective_at
        !== evidence.status_snapshot.effective_at) {
    throw new Error("current instrument evidence component binding drifted")
  }
  const { evidence_hash: _evidenceHash, ...body } = evidence
  if (canonicalHash(body) !== evidence.evidence_hash) {
    throw new Error("current instrument evidence hash mismatch")
  }
}

function requireHash(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be sha256`)
  }
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be a UTC timestamp`)
  }
  return value
}
