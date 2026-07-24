import {
  canonicalHash,
  canonicalJson,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  digest,
  utc,
} from "../../../../research-control-plane/contracts/src/lib/developer-contract-draft"

export const FORWARD_DATASET_READINESS_ASSESSMENT_SCHEMA_VERSION =
  "trade.rd-forward-dataset-readiness-assessment.v1" as const
export const FORWARD_DATASET_READINESS_ASSESSMENT_SCHEMA_VERSION_V2 =
  "trade.rd-forward-dataset-readiness-assessment.v2" as const

export const FORWARD_DATASET_READINESS_BLOCKER_CODES = [
  "forward_decision_not_compiled",
  "funding_window_unverified",
  "instrument_spec_window_unverified",
  "instrument_status_window_unverified",
  "formal_dataset_manifest_not_compiled",
  "venue_risk_policy_window_unverified",
  "mark_window_unverified",
  "supplemental_window_unverified",
] as const

export type ForwardDatasetReadinessBlockerCode =
  typeof FORWARD_DATASET_READINESS_BLOCKER_CODES[number]

export interface ForwardDatasetReadinessAssessmentBody {
  schema_version:
    typeof FORWARD_DATASET_READINESS_ASSESSMENT_SCHEMA_VERSION
  assessment_id: string
  candidate_id: string
  candidate_hash: string
  program_id: string
  program_hash: string
  historical_replay_request_registration_id: string
  historical_replay_request_hash: string
  historical_dataset_manifest_hash: string
  historical_requirement_profile: {
    funding_events: "exact_event_window"
    mark_events: "none" | "complete_grid"
    supplemental_facts: "none" | "signal_time_complete"
  }
  required_forward_inputs: {
    bars: "candidate_complete"
    funding_events: "required_complete_exact_window"
    mark_events: "allowed_none" | "required_complete_grid"
    supplemental_facts:
      | "allowed_none"
      | "required_signal_time_complete"
    instrument_status: "required_complete_pit_window"
    instrument_spec: "required_complete_pit_window"
    venue_risk_policy: "required_complete_pit_window"
    forward_decision: "required_new_post_freeze_decision"
    liquidity_capacity_attestation:
      "decision_dependent_on_entry_order_type"
    formal_dataset_manifest: "required_owner_compilation"
  }
  status: "blocked_pending_components"
  blockers: ForwardDatasetReadinessBlockerCode[]
  assessed_at: string
  authority: {
    readiness_classification_authority: "assessment_only"
    forward_replay_admission_authority: "none"
    deployment_authority: "none"
    trading_authority: false
  }
}

export interface ForwardDatasetReadinessAssessment
  extends ForwardDatasetReadinessAssessmentBody {
  assessment_hash: string
}

export interface ForwardDatasetReadinessAssessmentV2Body
  extends Omit<
    ForwardDatasetReadinessAssessmentBody,
    "schema_version" | "assessment_id" | "blockers"
  > {
  schema_version:
    typeof FORWARD_DATASET_READINESS_ASSESSMENT_SCHEMA_VERSION_V2
  assessment_id: string
  verified_components: {
    funding_events: {
      binding_id: string
      binding_hash: string
      market_data_fact_hash: string
      funding_slice_hash: string
      funding_slice_content_sha256: string
    } | null
  }
  blockers: ForwardDatasetReadinessBlockerCode[]
}

export interface ForwardDatasetReadinessAssessmentV2
  extends ForwardDatasetReadinessAssessmentV2Body {
  assessment_hash: string
}

export type AnyForwardDatasetReadinessAssessment =
  | ForwardDatasetReadinessAssessment
  | ForwardDatasetReadinessAssessmentV2

export function createForwardDatasetReadinessAssessment(input: {
  candidate_id: string
  candidate_hash: string
  program_id: string
  program_hash: string
  historical_replay_request_registration_id: string
  historical_replay_request_hash: string
  historical_dataset_manifest_hash: string
  historical_mark_coverage: "none" | "complete_grid"
  historical_supplemental_requirement_mode:
    | "none"
    | "signal_time_complete"
  assessed_at: string
}): ForwardDatasetReadinessAssessment {
  const identityHash = canonicalHash({
    candidate_hash: digest(input.candidate_hash, "candidate_hash"),
    historical_replay_request_hash: digest(
      input.historical_replay_request_hash,
      "historical_replay_request_hash",
    ),
    historical_dataset_manifest_hash: digest(
      input.historical_dataset_manifest_hash,
      "historical_dataset_manifest_hash",
    ),
  })
  const blockers: ForwardDatasetReadinessBlockerCode[] = [
    "forward_decision_not_compiled",
    "funding_window_unverified",
    "instrument_spec_window_unverified",
    "instrument_status_window_unverified",
    "formal_dataset_manifest_not_compiled",
    "venue_risk_policy_window_unverified",
  ]
  if (input.historical_mark_coverage === "complete_grid") {
    blockers.push("mark_window_unverified")
  }
  if (input.historical_supplemental_requirement_mode
      === "signal_time_complete") {
    blockers.push("supplemental_window_unverified")
  }
  const body: ForwardDatasetReadinessAssessmentBody = {
    schema_version:
      FORWARD_DATASET_READINESS_ASSESSMENT_SCHEMA_VERSION,
    assessment_id: `forward-readiness:${identityHash}`,
    candidate_id: identifier(input.candidate_id, "candidate_id"),
    candidate_hash: digest(input.candidate_hash, "candidate_hash"),
    program_id: identifier(input.program_id, "program_id"),
    program_hash: digest(input.program_hash, "program_hash"),
    historical_replay_request_registration_id: identifier(
      input.historical_replay_request_registration_id,
      "historical_replay_request_registration_id",
    ),
    historical_replay_request_hash: digest(
      input.historical_replay_request_hash,
      "historical_replay_request_hash",
    ),
    historical_dataset_manifest_hash: digest(
      input.historical_dataset_manifest_hash,
      "historical_dataset_manifest_hash",
    ),
    historical_requirement_profile: {
      funding_events: "exact_event_window",
      mark_events: markCoverage(input.historical_mark_coverage),
      supplemental_facts: supplementalMode(
        input.historical_supplemental_requirement_mode,
      ),
    },
    required_forward_inputs: {
      bars: "candidate_complete",
      funding_events: "required_complete_exact_window",
      mark_events: input.historical_mark_coverage === "complete_grid"
        ? "required_complete_grid"
        : "allowed_none",
      supplemental_facts:
        input.historical_supplemental_requirement_mode
          === "signal_time_complete"
          ? "required_signal_time_complete"
          : "allowed_none",
      instrument_status: "required_complete_pit_window",
      instrument_spec: "required_complete_pit_window",
      venue_risk_policy: "required_complete_pit_window",
      forward_decision: "required_new_post_freeze_decision",
      liquidity_capacity_attestation:
        "decision_dependent_on_entry_order_type",
      formal_dataset_manifest: "required_owner_compilation",
    },
    status: "blocked_pending_components",
    blockers,
    assessed_at: utc(input.assessed_at, "assessed_at"),
    authority: {
      readiness_classification_authority: "assessment_only",
      forward_replay_admission_authority: "none",
      deployment_authority: "none",
      trading_authority: false,
    },
  }
  return { ...body, assessment_hash: canonicalHash(body) }
}

export function createForwardDatasetReadinessAssessmentV2(input: {
  candidate_id: string
  candidate_hash: string
  program_id: string
  program_hash: string
  historical_replay_request_registration_id: string
  historical_replay_request_hash: string
  historical_dataset_manifest_hash: string
  historical_mark_coverage: "none" | "complete_grid"
  historical_supplemental_requirement_mode:
    | "none"
    | "signal_time_complete"
  funding_evidence: {
    binding_id: string
    binding_hash: string
    market_data_fact_hash: string
    funding_slice_hash: string
    funding_slice_content_sha256: string
  } | null
  assessed_at: string
}): ForwardDatasetReadinessAssessmentV2 {
  const base = createForwardDatasetReadinessAssessment(input)
  const {
    schema_version: _schema,
    assessment_id: _assessmentId,
    assessment_hash: _assessmentHash,
    blockers: baseBlockers,
    ...common
  } = base
  const fundingEvidence = input.funding_evidence == null
    ? null
    : {
        binding_id: identifier(
          input.funding_evidence.binding_id,
          "funding_evidence.binding_id",
        ),
        binding_hash: digest(
          input.funding_evidence.binding_hash,
          "funding_evidence.binding_hash",
        ),
        market_data_fact_hash: digest(
          input.funding_evidence.market_data_fact_hash,
          "funding_evidence.market_data_fact_hash",
        ),
        funding_slice_hash: digest(
          input.funding_evidence.funding_slice_hash,
          "funding_evidence.funding_slice_hash",
        ),
        funding_slice_content_sha256: digest(
          input.funding_evidence.funding_slice_content_sha256,
          "funding_evidence.funding_slice_content_sha256",
        ),
      }
  const blockers = fundingEvidence == null
    ? baseBlockers
    : baseBlockers.filter(
        (blocker) => blocker !== "funding_window_unverified",
      )
  const identityHash = canonicalHash({
    candidate_hash: base.candidate_hash,
    historical_replay_request_hash:
      base.historical_replay_request_hash,
    historical_dataset_manifest_hash:
      base.historical_dataset_manifest_hash,
    funding_evidence_binding_hash:
      fundingEvidence?.binding_hash ?? null,
  })
  const body: ForwardDatasetReadinessAssessmentV2Body = {
    schema_version:
      FORWARD_DATASET_READINESS_ASSESSMENT_SCHEMA_VERSION_V2,
    assessment_id: `forward-readiness:${identityHash}`,
    ...common,
    verified_components: {
      funding_events: fundingEvidence,
    },
    blockers,
  }
  return { ...body, assessment_hash: canonicalHash(body) }
}

export function assertForwardDatasetReadinessAssessment(
  value: AnyForwardDatasetReadinessAssessment,
): void {
  if (value.schema_version
      === FORWARD_DATASET_READINESS_ASSESSMENT_SCHEMA_VERSION_V2) {
    const expected = createForwardDatasetReadinessAssessmentV2({
      candidate_id: value.candidate_id,
      candidate_hash: value.candidate_hash,
      program_id: value.program_id,
      program_hash: value.program_hash,
      historical_replay_request_registration_id:
        value.historical_replay_request_registration_id,
      historical_replay_request_hash:
        value.historical_replay_request_hash,
      historical_dataset_manifest_hash:
        value.historical_dataset_manifest_hash,
      historical_mark_coverage:
        value.historical_requirement_profile.mark_events,
      historical_supplemental_requirement_mode:
        value.historical_requirement_profile.supplemental_facts,
      funding_evidence: value.verified_components.funding_events,
      assessed_at: value.assessed_at,
    })
    if (canonicalJson(value) !== canonicalJson(expected)) {
      throw new Error(
        "Forward dataset readiness assessment v2 is non-canonical or drifted",
      )
    }
    return
  }
  const expected = createForwardDatasetReadinessAssessment({
    candidate_id: value.candidate_id,
    candidate_hash: value.candidate_hash,
    program_id: value.program_id,
    program_hash: value.program_hash,
    historical_replay_request_registration_id:
      value.historical_replay_request_registration_id,
    historical_replay_request_hash:
      value.historical_replay_request_hash,
    historical_dataset_manifest_hash:
      value.historical_dataset_manifest_hash,
    historical_mark_coverage:
      value.historical_requirement_profile.mark_events,
    historical_supplemental_requirement_mode:
      value.historical_requirement_profile.supplemental_facts,
    assessed_at: value.assessed_at,
  })
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error(
      "Forward dataset readiness assessment is non-canonical or drifted",
    )
  }
}

function markCoverage(
  value: unknown,
): "none" | "complete_grid" {
  if (value !== "none" && value !== "complete_grid") {
    throw new Error("historical_mark_coverage is invalid")
  }
  return value
}

function supplementalMode(
  value: unknown,
): "none" | "signal_time_complete" {
  if (value !== "none" && value !== "signal_time_complete") {
    throw new Error(
      "historical_supplemental_requirement_mode is invalid",
    )
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
