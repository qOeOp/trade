import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  assertReplayInstrumentStatusSnapshot,
  createReplayInstrumentStatusProvenance,
  type ReplayInstrumentStatusProvenance,
  type ReplayInstrumentStatusSnapshot,
} from "../../../../research-strategy-development/replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  assertInstrumentStatusArchive,
  type InstrumentStatusArchive,
  type InstrumentStatusArchiveEvent,
} from "../../../market-data-store/src/lib/market-data-store"

export const INSTRUMENT_STATUS_PROVIDER_CAPABILITY_SCHEMA_VERSION = "trade.market-data-instrument-status-provider-capability.v1" as const
export const REPLAY_INSTRUMENT_STATUS_EVIDENCE_SCHEMA_VERSION = "trade.market-data-replay-instrument-status-evidence.v3" as const
export const INSTRUMENT_STATUS_PROVIDER_ID = "market-data.instrument-status-provider" as const
export const INSTRUMENT_STATUS_PROVIDER_VERSION = "v3" as const
export const INSTRUMENT_STATUS_NORMALIZATION_POLICY_VERSION = "market-data-instrument-status-normalization-v1" as const

const NORMALIZATION_POLICY = {
  input: "immutable-finalized-venue-status-event-archive",
  anchor: "last-event-effective-at-or-before-coverage-start",
  ordering: "strict-effective-time-then-source-sequence",
  statuses: ["trading", "halted"],
  interval: "half-open-contiguous",
  final_boundary: "archive-coverage-end",
  missing_or_redundant_transition: "reject",
} as const

export const INSTRUMENT_STATUS_NORMALIZATION_POLICY_HASH = canonicalHash(NORMALIZATION_POLICY)

const PROVIDER_BUILD_MANIFEST = {
  producer_id: INSTRUMENT_STATUS_PROVIDER_ID,
  producer_version: INSTRUMENT_STATUS_PROVIDER_VERSION,
  input_schema: "trade.market-data-instrument-status-archive.v2",
  output_schema: REPLAY_INSTRUMENT_STATUS_EVIDENCE_SCHEMA_VERSION,
  normalization_policy_version: INSTRUMENT_STATUS_NORMALIZATION_POLICY_VERSION,
  normalization_policy_hash: INSTRUMENT_STATUS_NORMALIZATION_POLICY_HASH,
} as const

export const INSTRUMENT_STATUS_PROVIDER_BUILD_HASH = canonicalHash(PROVIDER_BUILD_MANIFEST)

export interface InstrumentStatusProviderCapability {
  schema_version: typeof INSTRUMENT_STATUS_PROVIDER_CAPABILITY_SCHEMA_VERSION
  producer_domain: "market-data-products"
  producer_id: typeof INSTRUMENT_STATUS_PROVIDER_ID
  producer_version: typeof INSTRUMENT_STATUS_PROVIDER_VERSION
  producer_build_hash: string
  normalization_policy_version: typeof INSTRUMENT_STATUS_NORMALIZATION_POLICY_VERSION
  normalization_policy_hash: string
  accepted_source_kind: "venue_status_event_archive"
  emitted_completeness: "complete_history"
  finality_policy: "source_observed_through_gte_coverage_end"
  capability_hash: string
}

export type InstrumentStatusProviderCapabilityBody = Omit<InstrumentStatusProviderCapability, "capability_hash">

const CAPABILITY_BODY: InstrumentStatusProviderCapabilityBody = {
  schema_version: INSTRUMENT_STATUS_PROVIDER_CAPABILITY_SCHEMA_VERSION,
  producer_domain: "market-data-products",
  producer_id: INSTRUMENT_STATUS_PROVIDER_ID,
  producer_version: INSTRUMENT_STATUS_PROVIDER_VERSION,
  producer_build_hash: INSTRUMENT_STATUS_PROVIDER_BUILD_HASH,
  normalization_policy_version: INSTRUMENT_STATUS_NORMALIZATION_POLICY_VERSION,
  normalization_policy_hash: INSTRUMENT_STATUS_NORMALIZATION_POLICY_HASH,
  accepted_source_kind: "venue_status_event_archive",
  emitted_completeness: "complete_history",
  finality_policy: "source_observed_through_gte_coverage_end",
}

export const INSTRUMENT_STATUS_PROVIDER_CAPABILITY: InstrumentStatusProviderCapability = {
  ...CAPABILITY_BODY,
  capability_hash: canonicalHash(CAPABILITY_BODY),
}

export interface ReplayInstrumentStatusEvidence {
  schema_version: typeof REPLAY_INSTRUMENT_STATUS_EVIDENCE_SCHEMA_VERSION
  archive_id: string
  archive_hash: string
  archive_completeness_audit_hash: string
  archive_batch_chain_hash: string
  archive_external_completeness: "not_verified"
  archive_supersedes_archive_hash: string | null
  replay_start: string
  replay_end: string
  provider_capability: InstrumentStatusProviderCapability
  status_epochs: ReplayInstrumentStatusSnapshot[]
  status_provenance: ReplayInstrumentStatusProvenance
  evidence_hash: string
}

export interface InstrumentStatusProviderCertificationBinding {
  certification_ref: string
  certification_hash: string
  provider_capability_hash: string
}

export type ReplayInstrumentStatusEvidenceBody = Omit<ReplayInstrumentStatusEvidence, "evidence_hash">

export function buildReplayInstrumentStatusEvidence(input: {
  archive: InstrumentStatusArchive
  replay_start: string
  replay_end: string
  produced_at: string
  provider_certification: InstrumentStatusProviderCertificationBinding
}): ReplayInstrumentStatusEvidence {
  assertInstrumentStatusArchive(input.archive)
  requireUtc(input.replay_start, "replay_start")
  requireUtc(input.replay_end, "replay_end")
  requireUtc(input.produced_at, "produced_at")
  if (!input.provider_certification.certification_ref) throw new Error("provider certification_ref is required")
  requireHash(input.provider_certification.certification_hash, "provider certification_hash")
  requireHash(input.provider_certification.provider_capability_hash, "provider capability_hash")
  if (input.provider_certification.provider_capability_hash !== INSTRUMENT_STATUS_PROVIDER_CAPABILITY.capability_hash) {
    throw new Error("provider certification does not bind this capability")
  }
  if (Date.parse(input.replay_start) >= Date.parse(input.replay_end)) throw new Error("Replay status evidence window must have positive duration")
  if (Date.parse(input.replay_start) < Date.parse(input.archive.coverage_start)
      || Date.parse(input.replay_end) > Date.parse(input.archive.coverage_end)) {
    throw new Error("Replay status evidence window exceeds the finalized archive coverage")
  }
  if (Date.parse(input.produced_at) < Date.parse(input.archive.source_observed_through)) {
    throw new Error("Replay status evidence cannot be produced before the archive finality watermark")
  }
  const statusEpochs = normalizeStatusEpochs(input.archive)
  const statusProvenance = createReplayInstrumentStatusProvenance({
    producer_domain: "market-data-products",
    producer_id: INSTRUMENT_STATUS_PROVIDER_ID,
    producer_version: INSTRUMENT_STATUS_PROVIDER_VERSION,
    producer_build_hash: INSTRUMENT_STATUS_PROVIDER_BUILD_HASH,
    provider_capability_hash: input.provider_certification.provider_capability_hash,
    provider_certification_ref: input.provider_certification.certification_ref,
    provider_certification_hash: input.provider_certification.certification_hash,
    source_owner: input.archive.source_owner,
    source_kind: input.archive.source_kind,
    normalization_policy_version: INSTRUMENT_STATUS_NORMALIZATION_POLICY_VERSION,
    normalization_policy_hash: INSTRUMENT_STATUS_NORMALIZATION_POLICY_HASH,
    completeness: input.archive.completeness,
    coverage_start: input.archive.coverage_start,
    coverage_end: input.archive.coverage_end,
    source_observed_through: input.archive.source_observed_through,
    produced_at: input.produced_at,
    source_ref: `market-data-store:instrument-status-archive:${input.archive.archive_id}`,
    source_hash: input.archive.archive_hash,
    source_record_count: input.archive.source_record_count,
    status_epochs: statusEpochs,
  })
  const body: ReplayInstrumentStatusEvidenceBody = {
    schema_version: REPLAY_INSTRUMENT_STATUS_EVIDENCE_SCHEMA_VERSION,
    archive_id: input.archive.archive_id,
    archive_hash: input.archive.archive_hash,
    archive_completeness_audit_hash: input.archive.completeness_audit.audit_hash,
    archive_batch_chain_hash: input.archive.completeness_audit.batch_chain_hash,
    archive_external_completeness: input.archive.completeness_audit.external_completeness,
    archive_supersedes_archive_hash: input.archive.supersedes_archive_hash,
    replay_start: input.replay_start,
    replay_end: input.replay_end,
    provider_capability: INSTRUMENT_STATUS_PROVIDER_CAPABILITY,
    status_epochs: statusEpochs,
    status_provenance: statusProvenance,
  }
  return { ...body, evidence_hash: canonicalHash(body) }
}

export function assertReplayInstrumentStatusEvidence(evidence: ReplayInstrumentStatusEvidence): void {
  if (evidence.schema_version !== REPLAY_INSTRUMENT_STATUS_EVIDENCE_SCHEMA_VERSION) throw new Error("unsupported Replay instrument status evidence schema")
  if (!evidence.archive_id) throw new Error("instrument status evidence archive_id is required")
  if (canonicalHash(CAPABILITY_BODY) !== evidence.provider_capability.capability_hash
      || canonicalHash(evidence.provider_capability) !== canonicalHash(INSTRUMENT_STATUS_PROVIDER_CAPABILITY)) {
    throw new Error("instrument status provider capability is not certified")
  }
  requireHash(evidence.archive_hash, "archive_hash")
  requireHash(evidence.archive_completeness_audit_hash, "archive_completeness_audit_hash")
  requireHash(evidence.archive_batch_chain_hash, "archive_batch_chain_hash")
  if (evidence.archive_external_completeness !== "not_verified") {
    throw new Error("instrument status evidence cannot claim external archive completeness")
  }
  if (evidence.archive_supersedes_archive_hash !== null) {
    requireHash(evidence.archive_supersedes_archive_hash, "archive_supersedes_archive_hash")
  }
  requireHash(evidence.evidence_hash, "evidence_hash")
  requireUtc(evidence.replay_start, "replay_start")
  requireUtc(evidence.replay_end, "replay_end")
  requireUtc(evidence.status_provenance.coverage_start, "status_provenance.coverage_start")
  requireUtc(evidence.status_provenance.coverage_end, "status_provenance.coverage_end")
  requireUtc(evidence.status_provenance.source_observed_through, "status_provenance.source_observed_through")
  requireUtc(evidence.status_provenance.produced_at, "status_provenance.produced_at")
  if (Date.parse(evidence.replay_start) >= Date.parse(evidence.replay_end)
      || Date.parse(evidence.replay_start) < Date.parse(evidence.status_provenance.coverage_start)
      || Date.parse(evidence.replay_end) > Date.parse(evidence.status_provenance.coverage_end)) {
    throw new Error("instrument status evidence replay window exceeds provenance coverage")
  }
  if (Date.parse(evidence.status_provenance.source_observed_through) < Date.parse(evidence.status_provenance.coverage_end)
      || Date.parse(evidence.status_provenance.produced_at) < Date.parse(evidence.status_provenance.source_observed_through)) {
    throw new Error("instrument status evidence finality/production ordering is invalid")
  }
  for (const [index, epoch] of evidence.status_epochs.entries()) {
    assertReplayInstrumentStatusSnapshot(epoch)
    if (epoch.venue_id !== evidence.status_provenance.source_owner
        || epoch.symbol !== evidence.status_epochs[0]?.symbol) {
      throw new Error("instrument status evidence epoch identity drift")
    }
    if (index > 0 && evidence.status_epochs[index - 1].valid_until !== epoch.effective_at) {
      throw new Error("instrument status evidence epochs must be contiguous")
    }
  }
  if (evidence.status_epochs.length === 0
      || evidence.status_provenance.status_schedule_hash !== canonicalHash(evidence.status_epochs)) {
    throw new Error("instrument status evidence schedule/provenance mismatch")
  }
  if (evidence.status_epochs[0].effective_at !== evidence.status_provenance.coverage_start
      || evidence.status_epochs.at(-1)?.valid_until !== evidence.status_provenance.coverage_end) {
    throw new Error("instrument status evidence epochs must exactly close provenance coverage")
  }
  if (evidence.status_provenance.producer_build_hash !== evidence.provider_capability.producer_build_hash
      || evidence.status_provenance.provider_capability_hash !== evidence.provider_capability.capability_hash
      || evidence.status_provenance.normalization_policy_hash !== evidence.provider_capability.normalization_policy_hash
      || evidence.status_provenance.producer_id !== evidence.provider_capability.producer_id
      || evidence.status_provenance.producer_version !== evidence.provider_capability.producer_version) {
    throw new Error("instrument status evidence producer capability drift")
  }
  if (evidence.status_provenance.source_kind !== "venue_status_event_archive"
      || evidence.status_provenance.completeness !== "complete_history"
      || evidence.status_provenance.source_hash !== evidence.archive_hash
      || evidence.status_provenance.source_ref !== `market-data-store:instrument-status-archive:${evidence.archive_id}`) {
    throw new Error("instrument status evidence archive/provenance identity mismatch")
  }
  const body = Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== "evidence_hash"))
  if (evidence.evidence_hash !== canonicalHash(body)) throw new Error("instrument status evidence hash mismatch")
}

function normalizeStatusEpochs(archive: InstrumentStatusArchive): ReplayInstrumentStatusSnapshot[] {
  const coverageStart = Date.parse(archive.coverage_start)
  const selected: InstrumentStatusArchiveEvent[] = []
  let anchor: InstrumentStatusArchiveEvent | undefined
  for (const event of archive.events) {
    if (Date.parse(event.effective_at) <= coverageStart) anchor = event
    else selected.push(event)
  }
  if (!anchor) throw new Error("instrument status archive has no coverage anchor")
  const events = [anchor, ...selected]
  return events.map((event, index) => {
    const effectiveAt = index === 0 ? archive.coverage_start : event.effective_at
    const validUntil = events[index + 1]?.effective_at ?? archive.coverage_end
    const snapshot: ReplayInstrumentStatusSnapshot = {
      schema_version: "trade.rd-replay-instrument-status-snapshot.v1",
      snapshot_id: `status-${canonicalHash({ archive_hash: archive.archive_hash, event_id: event.event_id, effective_at: effectiveAt, valid_until: validUntil }).slice(0, 24)}`,
      venue_id: archive.venue_id,
      symbol: archive.symbol,
      status: event.status,
      effective_at: effectiveAt,
      valid_until: validUntil,
      observed_at: event.observed_at,
      source_ref: event.source_ref,
      source_hash: event.source_hash,
    }
    assertReplayInstrumentStatusSnapshot(snapshot)
    return snapshot
  })
}

function requireHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a lowercase sha256 digest`)
  return value
}

function requireUtc(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
  return value
}
