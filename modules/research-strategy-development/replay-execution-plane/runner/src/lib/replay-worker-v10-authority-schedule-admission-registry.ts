import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission,
  createReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission,
  deriveReplayDecisionHarnessWorkerV10AuthorityScheduleProjection,
  replayDecisionHarnessWorkerV10AuthorityScheduleAdmissionKey,
  type ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-schedule-admission"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityResponseValidation,
  type ReplayDecisionHarnessWorkerV10AuthorityResponseValidation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-response-validation"
import {
  canonicalHash,
  canonicalJson,
  type ReplayExecutionRequest,
} from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10AuthorityResponseValidation } from "./replay-worker-v10-authority-response-validation-registry"

export interface RegisterReplayWorkerV10AuthorityScheduleAdmissionInput {
  registry_root: string
  source_response_validation: ReplayDecisionHarnessWorkerV10AuthorityResponseValidation
  source_replay_execution_request: ReplayExecutionRequest
}

export function registerReplayWorkerV10AuthorityScheduleAdmission(
  input: RegisterReplayWorkerV10AuthorityScheduleAdmissionInput,
): ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission {
  requireDurableResponseValidation(input)
  const projection = deriveReplayDecisionHarnessWorkerV10AuthorityScheduleProjection(input)
  const key = admissionKey(input)
  const existing = readReplayWorkerV10AuthorityScheduleAdmission(input)
  if (existing) return existing
  const admitted = projection.matches
  const context = input.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.request_frame.worker_request.request_context
  const admission = createReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_SCHEMA_VERSION,
    admission_id: `decision-harness-worker-v10-authority-schedule-admission-${key.slice(0, 24)}`,
    admission_ref: `admission://replay-decision-harness-worker-v10-authority-schedule/${key.slice(0, 24)}`,
    admission_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_POLICY_VERSION,
    scope: "one_validated_worker_response_bound_to_exact_control_plane_request_schedule_boundary",
    owner: "replay_runner_worker_v10_authority_schedule_admission_registry",
    purpose: "admit_exact_schedule_match_without_fabricating_reproducibility_pair_or_harness_receipt",
    admission_status: admitted
      ? "admitted_exact_frozen_schedule_match_non_economic"
      : "rejected_worker_decision_output_schedule_mismatch",
    source_response_validation_hash: input.source_response_validation.validation_hash,
    source_response_validation: structuredClone(input.source_response_validation),
    source_replay_execution_request_hash: projection.request_hash,
    source_replay_execution_request: structuredClone(input.source_replay_execution_request),
    control_plane_attempt_lease_request_hash: projection.attempt_lease_request_hash,
    worker_request_hash: projection.worker_request_hash,
    worker_response_hash: projection.worker_response_hash,
    decision_sequence: context.decision_sequence,
    decision_time: context.decision_time,
    decision_phase: context.decision_phase,
    selected_schedule_entry_hash: canonicalHash(projection.schedule_entry),
    selected_schedule_entry: structuredClone(projection.schedule_entry),
    expected_decision_output_hash: canonicalHash(projection.expected_output),
    expected_decision_output: structuredClone(projection.expected_output),
    claimed_decision_output_hash: canonicalHash(projection.claimed_output),
    claimed_decision_output: structuredClone(projection.claimed_output),
    request_binding_policy: "exact_canonical_request_hash_matches_control_plane_current_attempt_lease",
    schedule_selection_policy: "worker_context_sequence_and_time_select_one_exact_frozen_entry",
    context_binding_policy: "canonical_request_and_selected_schedule_entry_exact_match",
    input_binding_policy: "worker_snapshots_revalidated_against_exact_replay_request_and_boundary",
    output_binding_policy: "canonical_worker_decision_output_equals_authoritative_schedule_projection",
    harness_receipt_policy: "not_materialized_requires_two_distinct_fresh_process_responses",
    response_instance_count: 1,
    required_reproducibility_response_count: 2,
    schedule_validation_count: 1,
    harness_receipt_count: 0,
    blockers: admitted
      ? ["independent_worker_response_reproducibility_pair_and_harness_receipt_not_materialized"]
      : ["worker_decision_output_does_not_match_frozen_schedule"],
    response_admission: "granted_non_economic_worker_response_candidate_only",
    schedule_admission: admitted ? "granted_exact_boundary_match" : "not_granted",
    decision_output_authority: admitted
      ? "schedule_matched_worker_claim_not_harness_receipt_admitted" : "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const content = `${canonicalJson(admission)}\n`
  writeReplayImmutableCas(admissionPath(input.registry_root, key), content)
  return parseAdmission(content)
}

export function readReplayWorkerV10AuthorityScheduleAdmission(
  input: RegisterReplayWorkerV10AuthorityScheduleAdmissionInput,
): ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission | null {
  requireDurableResponseValidation(input)
  const path = admissionPath(input.registry_root, admissionKey(input))
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Authority Schedule Admission must be a regular file")
  const admission = parseAdmission(readFileSync(path, "utf8"))
  if (admission.source_response_validation_hash !== input.source_response_validation.validation_hash
      || admission.source_replay_execution_request_hash !== canonicalHash(input.source_replay_execution_request)) {
    throw new Error("Authority Schedule Admission parent mismatch")
  }
  return admission
}

function requireDurableResponseValidation(input: RegisterReplayWorkerV10AuthorityScheduleAdmissionInput): void {
  if (input.registry_root.trim() === "") throw new Error("Authority Schedule Admission registry root is required")
  assertReplayDecisionHarnessWorkerV10AuthorityResponseValidation(input.source_response_validation)
  if (input.source_response_validation.validation_status
      !== "admitted_non_economic_worker_response_candidate") {
    throw new Error("Authority Schedule Admission requires an admitted Response Validation")
  }
  const durable = readReplayWorkerV10AuthorityResponseValidation({
    registry_root: input.registry_root,
    source_dispatch_receipt: input.source_response_validation.source_dispatch_receipt,
  })
  if (!durable || durable.validation_hash !== input.source_response_validation.validation_hash) {
    throw new Error("Authority Schedule Admission requires the exact durable Response Validation")
  }
}

function admissionKey(input: RegisterReplayWorkerV10AuthorityScheduleAdmissionInput): string {
  return replayDecisionHarnessWorkerV10AuthorityScheduleAdmissionKey({
    response_validation_hash: input.source_response_validation.validation_hash,
    replay_execution_request_hash: canonicalHash(input.source_replay_execution_request),
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_POLICY_VERSION,
  })
}

function admissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-schedule-admission-${key}.json`)
}

function parseAdmission(content: string): ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission
  assertReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Authority Schedule Admission is not canonical")
  return value
}
