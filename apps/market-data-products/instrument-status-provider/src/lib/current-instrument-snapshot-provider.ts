import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  CURRENT_INSTRUMENT_SNAPSHOT_EVIDENCE_SCHEMA_VERSION,
  CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_HASH,
  CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_VERSION,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_BUILD_HASH,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_ID,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_VERSION,
  assertCurrentInstrumentSnapshotEvidence,
  type CurrentInstrumentSnapshotEvidence,
  type CurrentInstrumentSnapshotEvidenceBody,
  type CurrentInstrumentSnapshotProviderCertificationBinding,
} from "../../../../contracts/replay-contract/src/current-instrument-snapshot-contract"
import {
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  assertReplayInstrumentAccountingSpec,
  assertReplayInstrumentSpecSnapshot,
  type ReplayInstrumentAccountingSpec,
  type ReplayInstrumentSpecSnapshot,
} from "../../../../contracts/replay-contract/src/replay-instrument-contract"
import {
  assertReplayInstrumentStatusSnapshot,
  createReplayInstrumentStatusProvenance,
  type ReplayInstrumentStatusSnapshot,
} from "../../../../contracts/replay-contract/src/replay-market-data-contract"
import {
  assertInstrumentStatusAcquisitionReceipt,
  instrumentStatusPayloadHash,
  type InstrumentStatusAcquisitionPayload,
  type InstrumentStatusAcquisitionReceipt,
} from "../../../market-data-store/src/lib/market-data-store"

export {
  CURRENT_INSTRUMENT_SNAPSHOT_EVIDENCE_SCHEMA_VERSION,
  CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_HASH,
  CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_VERSION,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_BUILD_HASH,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY_SCHEMA_VERSION,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_ID,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_VERSION,
  assertCurrentInstrumentSnapshotEvidence,
  type CurrentInstrumentSnapshotEvidence,
  type CurrentInstrumentSnapshotProviderCapability,
} from "../../../../contracts/replay-contract/src/current-instrument-snapshot-contract"

interface BinanceSymbolRow {
  symbol: string
  status: string
  onboardDate: number
  baseAsset: string
  quoteAsset: string
  marginAsset: string
  quotePrecision: number
  filters: Array<Record<string, unknown>>
}

export function buildCurrentInstrumentSnapshotEvidence(input: {
  receipt: InstrumentStatusAcquisitionReceipt
  payload: InstrumentStatusAcquisitionPayload
  produced_at: string
  provider_certification: CurrentInstrumentSnapshotProviderCertificationBinding
}): CurrentInstrumentSnapshotEvidence {
  assertInstrumentStatusAcquisitionReceipt(input.receipt)
  if (input.receipt.source_capability !== "current_snapshot_only"
      || input.receipt.transport !== "binance_usdm_rest"
      || input.receipt.terminal_status !== "succeeded") {
    throw new Error("current instrument provider requires a successful Binance current snapshot")
  }
  const attempt = input.receipt.attempts.at(-1)!
  if (attempt.outcome !== "succeeded"
      || attempt.response_payload_ref !== input.payload.payload_ref
      || attempt.response_hash !== input.payload.content_hash
      || attempt.response_bytes !== input.payload.byte_count
      || input.payload.acquisition_id !== input.receipt.acquisition_id
      || instrumentStatusPayloadHash(input.payload.payload)
        !== input.payload.content_hash) {
    throw new Error("current instrument snapshot payload does not bind its acquisition")
  }
  const producedAt = utc(input.produced_at, "produced_at")
  if (Date.parse(producedAt) < Date.parse(input.receipt.completed_at)) {
    throw new Error("current instrument evidence predates its acquisition")
  }
  requireHash(
    input.provider_certification.certification_hash,
    "provider certification_hash",
  )
  requireHash(
    input.provider_certification.provider_capability_hash,
    "provider capability_hash",
  )
  if (!input.provider_certification.certification_ref) {
    throw new Error("provider certification_ref is required")
  }
  if (input.provider_certification.provider_capability_hash
      !== CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY.capability_hash) {
    throw new Error("provider certification does not bind current instrument capability")
  }

  const raw = JSON.parse(new TextDecoder().decode(input.payload.payload)) as unknown
  const row = parseSymbolRow(raw, input.receipt.symbol)
  const observedAt = input.receipt.completed_at
  const listedAt = new Date(row.onboardDate).toISOString()
  if (Date.parse(listedAt) > Date.parse(observedAt)) {
    throw new Error("instrument onboardDate is later than the snapshot observation")
  }
  const rawSymbolHash = canonicalHash(row)
  const sourceRef =
    `market-data-store:instrument-status-source-payload:${input.payload.payload_ref}`
  const statusSnapshot: ReplayInstrumentStatusSnapshot = {
    schema_version: "trade.rd-replay-instrument-status-snapshot.v1",
    snapshot_id: `instrument-status:${canonicalHash({
      receipt_hash: input.receipt.receipt_hash,
      symbol_hash: rawSymbolHash,
    })}`,
    venue_id: "binance-usdm",
    symbol: row.symbol,
    status: row.status === "TRADING" ? "trading" : "halted",
    effective_at: observedAt,
    valid_until: null,
    observed_at: observedAt,
    source_ref: sourceRef,
    source_hash: input.payload.content_hash,
  }
  assertReplayInstrumentStatusSnapshot(statusSnapshot)
  const coverageEnd = new Date(Date.parse(observedAt) + 1).toISOString()
  const statusProvenance = createReplayInstrumentStatusProvenance({
    producer_domain: "market-data-products",
    producer_id: CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_ID,
    producer_version: CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_VERSION,
    producer_build_hash: CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_BUILD_HASH,
    provider_capability_hash:
      input.provider_certification.provider_capability_hash,
    provider_certification_ref:
      input.provider_certification.certification_ref,
    provider_certification_hash:
      input.provider_certification.certification_hash,
    source_owner: "binance-usdm",
    source_kind: "venue_current_snapshot",
    normalization_policy_version:
      CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_VERSION,
    normalization_policy_hash:
      CURRENT_INSTRUMENT_SNAPSHOT_NORMALIZATION_POLICY_HASH,
    completeness: "current_snapshot_only",
    coverage_start: observedAt,
    coverage_end: coverageEnd,
    source_observed_through: observedAt,
    produced_at: producedAt,
    source_ref: sourceRef,
    source_hash: input.payload.content_hash,
    source_record_count: 1,
    status_epochs: [statusSnapshot],
  })
  const specSnapshot: ReplayInstrumentSpecSnapshot = {
    schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: `instrument-spec:${canonicalHash({
      receipt_hash: input.receipt.receipt_hash,
      symbol_hash: rawSymbolHash,
    })}`,
    venue_id: "binance-usdm",
    symbol: row.symbol,
    effective_at: observedAt,
    valid_until: null,
    observed_at: observedAt,
    source_ref: sourceRef,
    source_hash: input.payload.content_hash,
  }
  assertReplayInstrumentSpecSnapshot(specSnapshot)
  const accounting: ReplayInstrumentAccountingSpec = {
    spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
    product_type: "linear_derivative",
    base_asset: row.baseAsset,
    quote_asset: row.quoteAsset,
    settlement_asset: row.marginAsset,
    contract_multiplier: "1",
    price_increment: filterDecimal(row.filters, "PRICE_FILTER", "tickSize"),
    quantity_increment: filterDecimal(row.filters, "LOT_SIZE", "stepSize"),
    settlement_increment: precisionIncrement(row.quotePrecision),
  }
  assertReplayInstrumentAccountingSpec(accounting)
  const body: CurrentInstrumentSnapshotEvidenceBody = {
    schema_version: CURRENT_INSTRUMENT_SNAPSHOT_EVIDENCE_SCHEMA_VERSION,
    acquisition_id: input.receipt.acquisition_id,
    acquisition_receipt_hash: input.receipt.receipt_hash,
    payload_ref: input.payload.payload_ref,
    payload_content_hash: input.payload.content_hash,
    raw_symbol_hash: rawSymbolHash,
    venue_id: "binance-usdm",
    symbol: row.symbol,
    listed_at: listedAt,
    trading_enabled_at: observedAt,
    provider_capability:
      structuredClone(CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY),
    status_snapshot: statusSnapshot,
    status_provenance: statusProvenance,
    spec_snapshot: specSnapshot,
    accounting,
    evidence_limitation:
      "current_snapshot_does_not_prove_inter_sample_status_history",
  }
  const evidence = { ...body, evidence_hash: canonicalHash(body) }
  assertCurrentInstrumentSnapshotEvidence(evidence)
  return evidence
}

function parseSymbolRow(value: unknown, symbol: string): BinanceSymbolRow {
  if (!value || typeof value !== "object"
      || !Array.isArray((value as { symbols?: unknown }).symbols)) {
    throw new Error("invalid Binance exchangeInfo payload")
  }
  const raw = (value as { symbols: unknown[] }).symbols.find((item) => (
    item && typeof item === "object"
      && (item as { symbol?: unknown }).symbol === symbol
  ))
  if (!raw || typeof raw !== "object") {
    throw new Error("Binance exchangeInfo symbol is missing")
  }
  const row = raw as Record<string, unknown>
  const filters = Array.isArray(row.filters)
    ? row.filters.filter(
        (item): item is Record<string, unknown> => (
          item !== null && typeof item === "object" && !Array.isArray(item)
        ),
      )
    : []
  const parsed: BinanceSymbolRow = {
    symbol: text(row.symbol, "symbol"),
    status: text(row.status, "status"),
    onboardDate: safeTimestamp(row.onboardDate, "onboardDate"),
    baseAsset: text(row.baseAsset, "baseAsset"),
    quoteAsset: text(row.quoteAsset, "quoteAsset"),
    marginAsset: text(row.marginAsset, "marginAsset"),
    quotePrecision: boundedPrecision(row.quotePrecision),
    filters,
  }
  if (parsed.symbol !== symbol) throw new Error("instrument symbol drifted")
  return parsed
}

function filterDecimal(
  filters: Array<Record<string, unknown>>,
  filterType: string,
  field: string,
): string {
  const filter = filters.find((item) => item.filterType === filterType)
  const value = filter?.[field]
  if (typeof value !== "string"
      || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
      || Number(value) <= 0) {
    throw new Error(`${filterType}.${field} is invalid`)
  }
  return canonicalDecimal(value)
}

function precisionIncrement(precision: number): string {
  return precision === 0 ? "1" : `0.${"0".repeat(precision - 1)}1`
}

function canonicalDecimal(value: string): string {
  if (!value.includes(".")) return value.replace(/^0+(?=\d)/, "")
  const [integer, fraction] = value.split(".")
  const normalizedInteger = integer!.replace(/^0+(?=\d)/, "")
  const normalizedFraction = fraction!.replace(/0+$/, "")
  return normalizedFraction === ""
    ? normalizedInteger
    : `${normalizedInteger}.${normalizedFraction}`
}

function boundedPrecision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0
      || (value as number) > 18) {
    throw new Error("quotePrecision is invalid")
  }
  return value as number
}

function safeTimestamp(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0
      || !Number.isFinite(new Date(value as number).getTime())) {
    throw new Error(`${field} is invalid`)
  }
  return value as number
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function requireHash(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase sha256 digest`)
  }
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}
