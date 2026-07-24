import type { Database } from "bun:sqlite"
import {
  createForwardDatasetReadinessAssessmentV2,
  type ForwardDatasetReadinessAssessmentV2,
} from "../../../../forward-evidence-plane/contracts/src/lib/forward-dataset-readiness-assessment"
import {
  readForwardDatasetCandidate,
} from "./forward-dataset-candidate"
import {
  readForwardObservationProgram,
} from "./forward-observation-program"
import {
  readForwardFundingEvidenceBinding,
} from "./forward-funding-evidence"

export function readForwardDatasetReadinessAssessment(
  db: Database,
  input: {
    candidate_id: string
    assessed_at: string
  },
): ForwardDatasetReadinessAssessmentV2 {
  const candidate = readForwardDatasetCandidate(db, input.candidate_id)
  if (!candidate) {
    throw new Error("Forward dataset readiness candidate is missing")
  }
  const program = readForwardObservationProgram(db, candidate.program_id)
  if (!program
      || candidate.program_hash !== program.program_hash
      || candidate.program_id !== program.program_id) {
    throw new Error("Forward dataset readiness Program drifted")
  }
  const source = db.query(`
    SELECT registration.registration_id, registration.request_hash,
           registration.replay_request_json,
           registration.dataset_manifest_hash,
           admission.dataset_manifest_json
    FROM rd_replay_request_registration AS registration
    JOIN rd_replay_trial_reservation_admission AS admission
      ON admission.admission_id=registration.reservation_admission_id
    WHERE registration.registration_id=$registration_id
  `).get({
    $registration_id:
      program.historical_replay_request_registration_id,
  }) as {
    registration_id: string
    request_hash: string
    replay_request_json: string
    dataset_manifest_hash: string
    dataset_manifest_json: string
  } | null
  if (!source
      || source.request_hash !== program.historical_replay_request_hash) {
    throw new Error(
      "Forward dataset readiness historical Replay lineage drifted",
    )
  }
  const request = record(
    JSON.parse(source.replay_request_json),
    "historical Replay Request",
  )
  const manifest = record(
    JSON.parse(source.dataset_manifest_json),
    "historical Dataset Manifest",
  )
  if (request.symbol !== program.symbol
      || request.timeframe !== program.timeframe
      || manifest.symbol !== program.symbol
      || manifest.timeframe !== program.timeframe) {
    throw new Error(
      "Forward dataset readiness market identity drifted",
    )
  }
  const requirementSet = record(
    request.supplemental_requirement_set,
    "historical supplemental requirement set",
  )
  const supplementalMode = requirementSet.mode
  if (supplementalMode !== "none"
      && supplementalMode !== "signal_time_complete") {
    throw new Error(
      "Forward dataset readiness supplemental mode is unsupported",
    )
  }
  const markCoverage = manifest.mark_coverage
  if (markCoverage !== "none" && markCoverage !== "complete_grid") {
    throw new Error(
      "Forward dataset readiness mark coverage is unsupported",
    )
  }
  const funding = readForwardFundingEvidenceBinding(
    db,
    candidate.candidate_id,
  )
  return createForwardDatasetReadinessAssessmentV2({
    candidate_id: candidate.candidate_id,
    candidate_hash: candidate.candidate_hash,
    program_id: program.program_id,
    program_hash: program.program_hash,
    historical_replay_request_registration_id:
      source.registration_id,
    historical_replay_request_hash: source.request_hash,
    historical_dataset_manifest_hash: source.dataset_manifest_hash,
    historical_mark_coverage: markCoverage,
    historical_supplemental_requirement_mode: supplementalMode,
    funding_evidence: funding == null
      ? null
      : {
          binding_id: funding.binding_id,
          binding_hash: funding.binding_hash,
          market_data_fact_hash: funding.market_data_fact.fact_hash,
          funding_slice_hash: funding.funding_slice.slice_hash,
          funding_slice_content_sha256:
            funding.funding_slice.content_sha256,
        },
    assessed_at: input.assessed_at,
  })
}

function record(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}
