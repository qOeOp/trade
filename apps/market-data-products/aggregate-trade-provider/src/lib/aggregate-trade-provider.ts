import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  assertReplayAggregateTradeCoverageBinding,
  createReplayAggregateTradeCoverageAttestation,
  type ReplayAggregateTradeCoverageAttestation,
  type ReplayAggregateTradeEvent,
} from "../../../../contracts/replay-contract/src/replay-market-data-contract"
import {
  AGGREGATE_TRADE_ARCHIVE_SCHEMA_VERSION,
  AGGREGATE_TRADE_NORMALIZATION_POLICY_VERSION,
  assertAggregateTradeArchive,
  type AggregateTradeArchive,
} from "../../../market-data-store/src/lib/aggregate-trade-archive"

export const AGGREGATE_TRADE_PROVIDER_CAPABILITY_SCHEMA_VERSION = "trade.market-data-aggregate-trade-provider-capability.v1" as const
export const REPLAY_AGGREGATE_TRADE_EVIDENCE_SCHEMA_VERSION = "trade.market-data-replay-aggregate-trade-evidence.v1" as const
export const AGGREGATE_TRADE_PROVIDER_ID = "market-data.aggregate-trade-provider" as const
export const AGGREGATE_TRADE_PROVIDER_VERSION = "v1" as const

const PROVIDER_POLICY = {
  input: AGGREGATE_TRADE_ARCHIVE_SCHEMA_VERSION,
  normalization: AGGREGATE_TRADE_NORMALIZATION_POLICY_VERSION,
  selection: "trade-time-in-requested-half-open-window",
  ordering: "strict-contiguous-aggregate-trade-id-then-nondecreasing-trade-time",
  availability: "trade-time-as-earliest-observable-time-resolution-limited",
  external_completeness: "not-verified",
} as const

export const AGGREGATE_TRADE_PROVIDER_POLICY_HASH = canonicalHash(PROVIDER_POLICY)
export const AGGREGATE_TRADE_PROVIDER_BUILD_HASH = canonicalHash({
  producer_id: AGGREGATE_TRADE_PROVIDER_ID,
  producer_version: AGGREGATE_TRADE_PROVIDER_VERSION,
  output_schema: REPLAY_AGGREGATE_TRADE_EVIDENCE_SCHEMA_VERSION,
  policy_hash: AGGREGATE_TRADE_PROVIDER_POLICY_HASH,
})

export interface AggregateTradeProviderCapability {
  schema_version: typeof AGGREGATE_TRADE_PROVIDER_CAPABILITY_SCHEMA_VERSION
  producer_domain: "market-data-products"
  producer_id: typeof AGGREGATE_TRADE_PROVIDER_ID
  producer_version: typeof AGGREGATE_TRADE_PROVIDER_VERSION
  producer_build_hash: string
  accepted_archive_schema: typeof AGGREGATE_TRADE_ARCHIVE_SCHEMA_VERSION
  emitted_event_schema: "trade.rd-replay-aggregate-trade-event.v1"
  emitted_attestation_schema: "trade.rd-replay-aggregate-trade-coverage-attestation.v1"
  provider_policy_hash: string
  external_completeness: "not_verified"
  capability_hash: string
}

type AggregateTradeProviderCapabilityBody = Omit<AggregateTradeProviderCapability, "capability_hash">

const CAPABILITY_BODY: AggregateTradeProviderCapabilityBody = {
  schema_version: AGGREGATE_TRADE_PROVIDER_CAPABILITY_SCHEMA_VERSION,
  producer_domain: "market-data-products",
  producer_id: AGGREGATE_TRADE_PROVIDER_ID,
  producer_version: AGGREGATE_TRADE_PROVIDER_VERSION,
  producer_build_hash: AGGREGATE_TRADE_PROVIDER_BUILD_HASH,
  accepted_archive_schema: AGGREGATE_TRADE_ARCHIVE_SCHEMA_VERSION,
  emitted_event_schema: "trade.rd-replay-aggregate-trade-event.v1",
  emitted_attestation_schema: "trade.rd-replay-aggregate-trade-coverage-attestation.v1",
  provider_policy_hash: AGGREGATE_TRADE_PROVIDER_POLICY_HASH,
  external_completeness: "not_verified",
}

export const AGGREGATE_TRADE_PROVIDER_CAPABILITY: AggregateTradeProviderCapability = {
  ...CAPABILITY_BODY,
  capability_hash: canonicalHash(CAPABILITY_BODY),
}

export interface AggregateTradeProviderCertificationBinding {
  certification_ref: string
  certification_hash: string
  provider_capability_hash: string
}

export interface ReplayAggregateTradeEvidence {
  schema_version: typeof REPLAY_AGGREGATE_TRADE_EVIDENCE_SCHEMA_VERSION
  archive_id: string
  archive_hash: string
  source_receipt_hash: string
  completeness_audit_hash: string
  external_completeness: "not_verified"
  replay_start: string
  replay_end: string
  provider_certification_ref: string
  provider_certification_hash: string
  provider_certified_capability_hash: string
  provider_capability: AggregateTradeProviderCapability
  events: ReplayAggregateTradeEvent[]
  coverage_attestation: ReplayAggregateTradeCoverageAttestation
  evidence_hash: string
}

export function buildReplayAggregateTradeEvidence(input: {
  archive: AggregateTradeArchive
  replay_start: string
  replay_end: string
  produced_at: string
  provider_certification: AggregateTradeProviderCertificationBinding
}): ReplayAggregateTradeEvidence {
  assertAggregateTradeArchive(input.archive)
  requireUtc(input.replay_start, "replay_start")
  requireUtc(input.replay_end, "replay_end")
  requireUtc(input.produced_at, "produced_at")
  requireText(input.provider_certification.certification_ref, "provider certification_ref")
  requireHash(input.provider_certification.certification_hash, "provider certification_hash")
  requireHash(input.provider_certification.provider_capability_hash, "provider capability_hash")
  if (input.provider_certification.provider_capability_hash !== AGGREGATE_TRADE_PROVIDER_CAPABILITY.capability_hash) {
    throw new Error("aggregate trade provider certification does not bind this capability")
  }
  if (Date.parse(input.replay_start) >= Date.parse(input.replay_end)
      || Date.parse(input.replay_start) < Date.parse(input.archive.coverage_start)
      || Date.parse(input.replay_end) > Date.parse(input.archive.coverage_end)) {
    throw new Error("Replay aggregate trade window exceeds immutable archive coverage")
  }
  if (Date.parse(input.produced_at) < Date.parse(input.archive.source_observed_through)
      || Date.parse(input.produced_at) < Date.parse(input.replay_end)) {
    throw new Error("Replay aggregate trade evidence predates source finality")
  }
  const events: ReplayAggregateTradeEvent[] = input.archive.events
    .filter((event) => Date.parse(event.trade_time) >= Date.parse(input.replay_start)
      && Date.parse(event.trade_time) < Date.parse(input.replay_end))
    .map((event) => ({ schema_version: "trade.rd-replay-aggregate-trade-event.v1", ...event }))
  if (events.length === 0) throw new Error("Replay aggregate trade window contains no archived event")
  const attestationId = `aggtrades-${canonicalHash({
    archive_hash: input.archive.archive_hash,
    replay_start: input.replay_start,
    replay_end: input.replay_end,
  }).slice(0, 24)}`
  const coverageAttestation = createReplayAggregateTradeCoverageAttestation({
    attestation_id: attestationId,
    attestation_ref: `market-data-provider:aggregate-trade-evidence:${attestationId}`,
    symbol: input.archive.symbol,
    coverage_start: input.replay_start,
    coverage_end: input.replay_end,
    source_ref: `market-data-store:aggregate-trade-archive:${input.archive.archive_id}`,
    source_hash: input.archive.archive_hash,
    produced_at: input.produced_at,
    events,
  })
  const body: Omit<ReplayAggregateTradeEvidence, "evidence_hash"> = {
    schema_version: REPLAY_AGGREGATE_TRADE_EVIDENCE_SCHEMA_VERSION,
    archive_id: input.archive.archive_id,
    archive_hash: input.archive.archive_hash,
    source_receipt_hash: input.archive.source_receipt.receipt_hash,
    completeness_audit_hash: input.archive.completeness_audit.audit_hash,
    external_completeness: "not_verified",
    replay_start: input.replay_start,
    replay_end: input.replay_end,
    provider_certification_ref: input.provider_certification.certification_ref,
    provider_certification_hash: input.provider_certification.certification_hash,
    provider_certified_capability_hash: input.provider_certification.provider_capability_hash,
    provider_capability: AGGREGATE_TRADE_PROVIDER_CAPABILITY,
    events,
    coverage_attestation: coverageAttestation,
  }
  const evidence = { ...body, evidence_hash: canonicalHash(body) }
  assertReplayAggregateTradeEvidence(evidence)
  return evidence
}

export function assertReplayAggregateTradeEvidence(evidence: ReplayAggregateTradeEvidence): void {
  if (evidence.schema_version !== REPLAY_AGGREGATE_TRADE_EVIDENCE_SCHEMA_VERSION
      || evidence.external_completeness !== "not_verified") {
    throw new Error("unsupported Replay aggregate trade evidence policy")
  }
  requireText(evidence.archive_id, "aggregate trade evidence archive_id")
  requireText(evidence.provider_certification_ref, "aggregate trade evidence provider_certification_ref")
  for (const [field, value] of Object.entries({
    archive_hash: evidence.archive_hash,
    source_receipt_hash: evidence.source_receipt_hash,
    completeness_audit_hash: evidence.completeness_audit_hash,
    provider_certification_hash: evidence.provider_certification_hash,
    provider_certified_capability_hash: evidence.provider_certified_capability_hash,
    evidence_hash: evidence.evidence_hash,
  })) requireHash(value, `aggregate trade evidence ${field}`)
  requireUtc(evidence.replay_start, "aggregate trade evidence replay_start")
  requireUtc(evidence.replay_end, "aggregate trade evidence replay_end")
  if (Date.parse(evidence.replay_start) >= Date.parse(evidence.replay_end)) {
    throw new Error("aggregate trade evidence replay window is invalid")
  }
  if (canonicalHash(CAPABILITY_BODY) !== evidence.provider_capability.capability_hash
      || canonicalHash(evidence.provider_capability) !== canonicalHash(AGGREGATE_TRADE_PROVIDER_CAPABILITY)) {
    throw new Error("aggregate trade provider capability is not certified")
  }
  if (evidence.provider_certified_capability_hash !== evidence.provider_capability.capability_hash) {
    throw new Error("aggregate trade provider certification/capability binding mismatch")
  }
  if (evidence.coverage_attestation.coverage_start !== evidence.replay_start
      || evidence.coverage_attestation.coverage_end !== evidence.replay_end
      || evidence.coverage_attestation.source_hash !== evidence.archive_hash
      || evidence.coverage_attestation.source_ref !== `market-data-store:aggregate-trade-archive:${evidence.archive_id}`) {
    throw new Error("aggregate trade evidence archive/coverage identity mismatch")
  }
  assertReplayAggregateTradeCoverageBinding(evidence.coverage_attestation, evidence.events)
  const { evidence_hash: evidenceHash, ...body } = evidence
  if (evidenceHash !== canonicalHash(body)) throw new Error("aggregate trade evidence hash mismatch")
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
  return value
}

function requireHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a lowercase sha256 digest`)
  return value
}

function requireUtc(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  return value
}
