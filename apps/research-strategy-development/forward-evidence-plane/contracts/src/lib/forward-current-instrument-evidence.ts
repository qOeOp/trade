import {
  assertCurrentInstrumentSnapshotEvidence,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_ID,
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_VERSION,
  type CurrentInstrumentSnapshotEvidence,
} from "../../../../../contracts/replay-contract/src/current-instrument-snapshot-contract"
import {
  canonicalHash,
  canonicalJson,
} from "../../../../../contracts/runtime-core/src/canonical-json"
import type {
  ForwardObservationProgram,
} from "../../../../research-control-plane/contracts/src/lib/forward-observation-program"
import type {
  ForwardDatasetCandidate,
} from "./forward-dataset-candidate"

export const FORWARD_CURRENT_INSTRUMENT_PROVIDER_CERTIFICATION_SCHEMA =
  "trade.rd-forward-current-instrument-provider-certification.v1" as const
export const FORWARD_CURRENT_INSTRUMENT_EVIDENCE_BINDING_SCHEMA =
  "trade.rd-forward-current-instrument-evidence-binding.v1" as const
export const FORWARD_CURRENT_INSTRUMENT_MAX_OBSERVATION_GAP_MS =
  20 * 60 * 1_000

export interface ForwardCurrentInstrumentProviderCertification {
  schema_version:
    typeof FORWARD_CURRENT_INSTRUMENT_PROVIDER_CERTIFICATION_SCHEMA
  certification_id: string
  certification_ref: string
  certification_hash: string
  status: "certified"
  certified_at: string
  valid_until: string
  certifier_id: string
  certification_policy_version:
    "rd-forward-current-instrument-provider-certification-v1"
  provider_capability_hash: string
  producer_domain: "market-data-products"
  producer_id: typeof CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_ID
  producer_version: typeof CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_VERSION
  producer_build_hash: string
  normalization_policy_version: string
  normalization_policy_hash: string
  allowed_source_kind: "venue_current_snapshot"
  allowed_completeness: "current_snapshot_only"
}

type ForwardCurrentInstrumentProviderCertificationBody = Omit<
  ForwardCurrentInstrumentProviderCertification,
  "certification_hash"
>

export interface ForwardCurrentInstrumentEvidenceBinding {
  schema_version:
    typeof FORWARD_CURRENT_INSTRUMENT_EVIDENCE_BINDING_SCHEMA
  binding_id: string
  candidate_id: string
  candidate_hash: string
  program_id: string
  program_hash: string
  provider_certification:
    ForwardCurrentInstrumentProviderCertification
  observation_policy: {
    mode: "bounded_current_snapshot_series"
    max_observation_gap_ms:
      typeof FORWARD_CURRENT_INSTRUMENT_MAX_OBSERVATION_GAP_MS
    coverage_start: string
    coverage_end: string
    inter_sample_history_claim: "not_proven"
  }
  observations: CurrentInstrumentSnapshotEvidence[]
  evidence_series_hash: string
  instrument_status_series_hash: string
  instrument_status_provenance_series_hash: string
  instrument_spec_series_hash: string
  created_at: string
  authority: {
    evidence_binding_authority:
      "instrument_status_and_spec_components_only"
    forward_replay_admission_authority: "none"
    deployment_authority: "none"
    trading_authority: false
  }
  binding_hash: string
}

export function createForwardCurrentInstrumentProviderCertification(
  input: Omit<
    ForwardCurrentInstrumentProviderCertificationBody,
    | "schema_version"
    | "status"
    | "certification_policy_version"
    | "provider_capability_hash"
    | "producer_domain"
    | "producer_id"
    | "producer_version"
    | "producer_build_hash"
    | "normalization_policy_version"
    | "normalization_policy_hash"
    | "allowed_source_kind"
    | "allowed_completeness"
  >,
): ForwardCurrentInstrumentProviderCertification {
  const capability = CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY
  const body: ForwardCurrentInstrumentProviderCertificationBody = {
    schema_version:
      FORWARD_CURRENT_INSTRUMENT_PROVIDER_CERTIFICATION_SCHEMA,
    certification_id: identifier(
      input.certification_id,
      "certification_id",
    ),
    certification_ref: text(
      input.certification_ref,
      "certification_ref",
    ),
    status: "certified",
    certified_at: utc(input.certified_at, "certified_at"),
    valid_until: utc(input.valid_until, "valid_until"),
    certifier_id: identifier(input.certifier_id, "certifier_id"),
    certification_policy_version:
      "rd-forward-current-instrument-provider-certification-v1",
    provider_capability_hash: capability.capability_hash,
    producer_domain: capability.producer_domain,
    producer_id: capability.producer_id,
    producer_version: capability.producer_version,
    producer_build_hash: capability.producer_build_hash,
    normalization_policy_version:
      capability.normalization_policy_version,
    normalization_policy_hash: capability.normalization_policy_hash,
    allowed_source_kind: capability.accepted_source_kind,
    allowed_completeness: capability.emitted_completeness,
  }
  const certificationDuration =
    Date.parse(body.valid_until) - Date.parse(body.certified_at)
  if (certificationDuration <= 0
      || certificationDuration > 7 * 86_400_000) {
    throw new Error("current instrument certification window is invalid")
  }
  const certification = {
    ...body,
    certification_hash: canonicalHash(body),
  }
  return certification
}

export function assertForwardCurrentInstrumentProviderCertification(
  value: ForwardCurrentInstrumentProviderCertification,
): void {
  const expected = createForwardCurrentInstrumentProviderCertification({
    certification_id: value.certification_id,
    certification_ref: value.certification_ref,
    certified_at: value.certified_at,
    valid_until: value.valid_until,
    certifier_id: value.certifier_id,
  })
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error(
      "Forward current instrument provider certification drifted",
    )
  }
}

export function createForwardCurrentInstrumentEvidenceBinding(input: {
  program: ForwardObservationProgram
  candidate: ForwardDatasetCandidate
  provider_certification:
    ForwardCurrentInstrumentProviderCertification
  observations: CurrentInstrumentSnapshotEvidence[]
  created_at: string
}): ForwardCurrentInstrumentEvidenceBinding {
  assertCandidateLineage(input.program, input.candidate)
  assertForwardCurrentInstrumentProviderCertification(
    input.provider_certification,
  )
  if (input.observations.length < 2
      || input.observations.length > 100_000) {
    throw new Error(
      "Forward current instrument evidence series is empty or unbounded",
    )
  }
  const observations = input.observations.map((value) =>
    structuredClone(value))
  let previousAt: number | null = null
  const acquisitionIds = new Set<string>()
  for (const evidence of observations) {
    assertCurrentInstrumentSnapshotEvidence(evidence)
    const observedAt = Date.parse(evidence.status_snapshot.effective_at)
    const producedAt = Date.parse(evidence.status_provenance.produced_at)
    if (evidence.symbol !== input.program.symbol
        || evidence.provider_capability.capability_hash
          !== input.provider_certification.provider_capability_hash
        || evidence.status_provenance.provider_certification_hash
          !== input.provider_certification.certification_hash
        || evidence.status_provenance.provider_certification_ref
          !== input.provider_certification.certification_ref
        || producedAt < Date.parse(input.provider_certification.certified_at)
        || producedAt >= Date.parse(input.provider_certification.valid_until)
        || acquisitionIds.has(evidence.acquisition_id)) {
      throw new Error(
        "Forward current instrument evidence certification or identity drifted",
      )
    }
    if (previousAt !== null
        && (observedAt <= previousAt
          || observedAt - previousAt
            > FORWARD_CURRENT_INSTRUMENT_MAX_OBSERVATION_GAP_MS)) {
      throw new Error(
        "Forward current instrument evidence observation gap is invalid",
      )
    }
    acquisitionIds.add(evidence.acquisition_id)
    previousAt = observedAt
  }
  const firstAt = observations[0]!.status_snapshot.effective_at
  const lastAt = observations.at(-1)!.status_snapshot.effective_at
  if (Date.parse(firstAt) < Date.parse(input.program.frozen_at)
      || Date.parse(firstAt)
        > Date.parse(input.candidate.window.first_open_time)
      || Date.parse(lastAt)
        < Date.parse(input.candidate.window.data_watermark)) {
    throw new Error(
      "Forward current instrument evidence does not bound the Candidate window",
    )
  }
  const createdAt = utc(input.created_at, "created_at")
  if (Date.parse(createdAt) < Date.parse(input.candidate.created_at)
      || Date.parse(createdAt)
        < Date.parse(input.provider_certification.certified_at)
      || Date.parse(createdAt)
        >= Date.parse(input.provider_certification.valid_until)
      || Date.parse(createdAt)
        < Date.parse(
          observations.at(-1)!.status_provenance.produced_at,
        )) {
    throw new Error(
      "Forward current instrument evidence binding chronology drifted",
    )
  }
  const evidenceSeriesHash = canonicalHash(
    observations.map((value) => value.evidence_hash),
  )
  const statusSeriesHash = canonicalHash(
    observations.map((value) => value.status_snapshot),
  )
  const provenanceSeriesHash = canonicalHash(
    observations.map((value) => value.status_provenance),
  )
  const specSeriesHash = canonicalHash(
    observations.map((value) => ({
      spec_snapshot: value.spec_snapshot,
      accounting: value.accounting,
    })),
  )
  const identityHash = canonicalHash({
    candidate_hash: input.candidate.candidate_hash,
    provider_certification_hash:
      input.provider_certification.certification_hash,
    evidence_series_hash: evidenceSeriesHash,
  })
  const body = {
    schema_version:
      FORWARD_CURRENT_INSTRUMENT_EVIDENCE_BINDING_SCHEMA,
    binding_id: `forward-current-instrument:${identityHash}`,
    candidate_id: input.candidate.candidate_id,
    candidate_hash: input.candidate.candidate_hash,
    program_id: input.program.program_id,
    program_hash: input.program.program_hash,
    provider_certification:
      structuredClone(input.provider_certification),
    observation_policy: {
      mode: "bounded_current_snapshot_series" as const,
      max_observation_gap_ms:
        FORWARD_CURRENT_INSTRUMENT_MAX_OBSERVATION_GAP_MS,
      coverage_start: firstAt,
      coverage_end: lastAt,
      inter_sample_history_claim: "not_proven" as const,
    },
    observations,
    evidence_series_hash: evidenceSeriesHash,
    instrument_status_series_hash: statusSeriesHash,
    instrument_status_provenance_series_hash: provenanceSeriesHash,
    instrument_spec_series_hash: specSeriesHash,
    created_at: createdAt,
    authority: {
      evidence_binding_authority:
        "instrument_status_and_spec_components_only" as const,
      forward_replay_admission_authority: "none" as const,
      deployment_authority: "none" as const,
      trading_authority: false as const,
    },
  }
  return { ...body, binding_hash: canonicalHash(body) }
}

export function assertForwardCurrentInstrumentEvidenceBinding(input: {
  program: ForwardObservationProgram
  candidate: ForwardDatasetCandidate
  binding: ForwardCurrentInstrumentEvidenceBinding
}): void {
  const expected = createForwardCurrentInstrumentEvidenceBinding({
    program: input.program,
    candidate: input.candidate,
    provider_certification: input.binding.provider_certification,
    observations: input.binding.observations,
    created_at: input.binding.created_at,
  })
  if (canonicalJson(input.binding) !== canonicalJson(expected)) {
    throw new Error(
      "Forward current instrument evidence binding is non-canonical or drifted",
    )
  }
}

function assertCandidateLineage(
  program: ForwardObservationProgram,
  candidate: ForwardDatasetCandidate,
): void {
  if (candidate.program_id !== program.program_id
      || candidate.program_hash !== program.program_hash
      || candidate.window.first_open_time
        !== program.first_observation_open_time) {
    throw new Error("Forward current instrument Candidate lineage drifted")
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

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`)
  }
  return value
}
