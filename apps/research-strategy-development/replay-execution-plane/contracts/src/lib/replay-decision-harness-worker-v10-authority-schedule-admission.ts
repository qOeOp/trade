import {
  assertReplayDecisionInputSnapshot,
  assertReplayDecisionMarketInputSnapshot,
  assertReplayDecisionStateSnapshot,
  assertReplayExecutionRequest,
  canonicalHash,
  canonicalJson,
  createReplayDecisionHarnessContext,
  replayDecisionOutputFor,
  replayDecisionPhaseFor,
  type ReplayDecisionOutput,
  type ReplayDecisionScheduleEntry,
  type ReplayExecutionRequest,
} from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityResponseValidation,
  type ReplayDecisionHarnessWorkerV10AuthorityResponseValidation,
} from "./replay-decision-harness-worker-v10-authority-response-validation"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-authority-schedule-admission.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-schedule-admission-v1" as const

export type ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmissionStatus =
  | "admitted_exact_frozen_schedule_match_non_economic"
  | "rejected_worker_decision_output_schedule_mismatch"

export interface ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_ref: string
  admission_key: string
  admission_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_POLICY_VERSION
  scope: "one_validated_worker_response_bound_to_exact_control_plane_request_schedule_boundary"
  owner: "replay_runner_worker_v10_authority_schedule_admission_registry"
  purpose: "admit_exact_schedule_match_without_fabricating_reproducibility_pair_or_harness_receipt"
  admission_status: ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmissionStatus
  source_response_validation_hash: string
  source_response_validation: ReplayDecisionHarnessWorkerV10AuthorityResponseValidation
  source_replay_execution_request_hash: string
  source_replay_execution_request: ReplayExecutionRequest
  control_plane_attempt_lease_request_hash: string
  worker_request_hash: string
  worker_response_hash: string
  decision_sequence: number
  decision_time: string
  decision_phase: "pre_entry" | "initial_entry" | "pending_entry" | "position_open"
  selected_schedule_entry_hash: string
  selected_schedule_entry: ReplayDecisionScheduleEntry
  expected_decision_output_hash: string
  expected_decision_output: ReplayDecisionOutput
  claimed_decision_output_hash: string
  claimed_decision_output: ReplayDecisionOutput
  request_binding_policy: "exact_canonical_request_hash_matches_control_plane_current_attempt_lease"
  schedule_selection_policy: "worker_context_sequence_and_time_select_one_exact_frozen_entry"
  context_binding_policy: "canonical_request_and_selected_schedule_entry_exact_match"
  input_binding_policy: "worker_snapshots_revalidated_against_exact_replay_request_and_boundary"
  output_binding_policy: "canonical_worker_decision_output_equals_authoritative_schedule_projection"
  harness_receipt_policy: "not_materialized_requires_two_distinct_fresh_process_responses"
  response_instance_count: 1
  required_reproducibility_response_count: 2
  schedule_validation_count: 1
  harness_receipt_count: 0
  blockers: Array<
    | "worker_decision_output_does_not_match_frozen_schedule"
    | "independent_worker_response_reproducibility_pair_and_harness_receipt_not_materialized"
  >
  response_admission: "granted_non_economic_worker_response_candidate_only"
  schedule_admission: "granted_exact_boundary_match" | "not_granted"
  decision_output_authority: "schedule_matched_worker_claim_not_harness_receipt_admitted" | "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmissionBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission,
  "admission_hash"
>

export function replayDecisionHarnessWorkerV10AuthorityScheduleAdmissionKey(input: {
  response_validation_hash: string
  replay_execution_request_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_POLICY_VERSION
}): string {
  requireHash(input.response_validation_hash, "Authority Schedule Admission Response Validation hash")
  requireHash(input.replay_execution_request_hash, "Authority Schedule Admission Replay Request hash")
  if (input.admission_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_POLICY_VERSION) {
    throw new Error("unsupported Authority Schedule Admission natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission(
  body: ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmissionBody,
): ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission {
  const value = { ...structuredClone(body), admission_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission(value)
  return value
}

export function deriveReplayDecisionHarnessWorkerV10AuthorityScheduleProjection(input: {
  source_response_validation: ReplayDecisionHarnessWorkerV10AuthorityResponseValidation
  source_replay_execution_request: ReplayExecutionRequest
}): {
  request_hash: string
  attempt_lease_request_hash: string
  worker_request_hash: string
  worker_response_hash: string
  schedule_entry: ReplayDecisionScheduleEntry
  expected_output: ReplayDecisionOutput
  claimed_output: ReplayDecisionOutput
  matches: boolean
} {
  assertReplayDecisionHarnessWorkerV10AuthorityResponseValidation(input.source_response_validation)
  assertReplayExecutionRequest(input.source_replay_execution_request)
  const validation = input.source_response_validation
  if (validation.validation_status !== "admitted_non_economic_worker_response_candidate"
      || validation.response_frame === null) {
    throw new Error("Authority Schedule Admission requires an admitted Response Validation")
  }
  const dispatch = validation.source_dispatch_receipt
  const spawn = dispatch.source_dispatch_attempt.source_process_launch_receipt
    .source_launch_attempt.source_spawn_revalidation
  const attemptRequestHash = spawn.control_plane_revalidation_receipt.current_attempt_lease.request_hash
  const requestHash = canonicalHash(input.source_replay_execution_request)
  if (requestHash !== attemptRequestHash) {
    throw new Error("Authority Schedule Admission Replay Request does not match Control Plane Attempt lease")
  }
  const workerRequest = dispatch.source_dispatch_attempt.request_frame.worker_request
  const workerResponse = validation.response_frame.worker_response
  const context = workerRequest.request_context
  const scheduleEntry = input.source_replay_execution_request.decision_schedule.entries
    .find((entry) => entry.decision_sequence === context.decision_sequence
      && entry.decision_time === context.decision_time)
  if (!scheduleEntry) throw new Error("Authority Schedule Admission worker boundary is absent from frozen Schedule")
  if (canonicalJson(context)
      !== canonicalJson(createReplayDecisionHarnessContext(input.source_replay_execution_request, scheduleEntry))) {
    throw new Error("Authority Schedule Admission Worker Context does not match frozen Schedule boundary")
  }
  assertReplayDecisionInputSnapshot(
    workerRequest.decision_input_snapshot, input.source_replay_execution_request, scheduleEntry.decision_time,
  )
  assertReplayDecisionMarketInputSnapshot(
    workerRequest.decision_market_input_snapshot, input.source_replay_execution_request, scheduleEntry.decision_time,
  )
  const phase = replayDecisionPhaseFor(input.source_replay_execution_request, scheduleEntry)
  if (phase === "position_open") {
    if (!workerRequest.decision_state_snapshot) {
      throw new Error("Authority Schedule Admission position-open boundary requires State snapshot")
    }
    assertReplayDecisionStateSnapshot(
      workerRequest.decision_state_snapshot, input.source_replay_execution_request, scheduleEntry,
    )
  } else if (workerRequest.decision_state_snapshot !== null) {
    throw new Error("Authority Schedule Admission non-position boundary cannot carry State snapshot")
  }
  const expected = replayDecisionOutputFor(input.source_replay_execution_request, scheduleEntry)
  return {
    request_hash: requestHash,
    attempt_lease_request_hash: attemptRequestHash,
    worker_request_hash: workerRequest.request_hash,
    worker_response_hash: workerResponse.response_hash,
    schedule_entry: structuredClone(scheduleEntry),
    expected_output: expected,
    claimed_output: structuredClone(workerResponse.decision_output),
    matches: canonicalJson(expected) === canonicalJson(workerResponse.decision_output),
  }
}

export function assertReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission(
  value: ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission,
): void {
  assertFields(value)
  const admitted = value.admission_status === "admitted_exact_frozen_schedule_match_non_economic"
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_SCHEMA_VERSION
      || value.admission_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_POLICY_VERSION
      || value.scope !== "one_validated_worker_response_bound_to_exact_control_plane_request_schedule_boundary"
      || value.owner !== "replay_runner_worker_v10_authority_schedule_admission_registry"
      || value.purpose
        !== "admit_exact_schedule_match_without_fabricating_reproducibility_pair_or_harness_receipt"
      || !["admitted_exact_frozen_schedule_match_non_economic",
        "rejected_worker_decision_output_schedule_mismatch"].includes(value.admission_status)
      || value.request_binding_policy
        !== "exact_canonical_request_hash_matches_control_plane_current_attempt_lease"
      || value.schedule_selection_policy
        !== "worker_context_sequence_and_time_select_one_exact_frozen_entry"
      || value.context_binding_policy !== "canonical_request_and_selected_schedule_entry_exact_match"
      || value.input_binding_policy
        !== "worker_snapshots_revalidated_against_exact_replay_request_and_boundary"
      || value.output_binding_policy
        !== "canonical_worker_decision_output_equals_authoritative_schedule_projection"
      || value.harness_receipt_policy
        !== "not_materialized_requires_two_distinct_fresh_process_responses"
      || value.response_instance_count !== 1 || value.required_reproducibility_response_count !== 2
      || value.schedule_validation_count !== 1 || value.harness_receipt_count !== 0
      || value.response_admission !== "granted_non_economic_worker_response_candidate_only"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Authority Schedule Admission")
  }
  for (const item of [value.admission_id, value.admission_ref]) {
    requireText(item, "Authority Schedule Admission identity")
  }
  for (const item of [value.admission_key, value.admission_hash, value.source_response_validation_hash,
    value.source_replay_execution_request_hash, value.control_plane_attempt_lease_request_hash,
    value.worker_request_hash, value.worker_response_hash, value.selected_schedule_entry_hash,
    value.expected_decision_output_hash, value.claimed_decision_output_hash]) {
    requireHash(item, "Authority Schedule Admission hash")
  }
  const projection = deriveReplayDecisionHarnessWorkerV10AuthorityScheduleProjection({
    source_response_validation: value.source_response_validation,
    source_replay_execution_request: value.source_replay_execution_request,
  })
  const expectedKey = replayDecisionHarnessWorkerV10AuthorityScheduleAdmissionKey({
    response_validation_hash: value.source_response_validation.validation_hash,
    replay_execution_request_hash: projection.request_hash,
    admission_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SCHEDULE_ADMISSION_POLICY_VERSION,
  })
  const context = value.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.request_frame.worker_request.request_context
  if (value.admission_key !== expectedKey
      || value.admission_id !== `decision-harness-worker-v10-authority-schedule-admission-${expectedKey.slice(0, 24)}`
      || value.admission_ref !== `admission://replay-decision-harness-worker-v10-authority-schedule/${expectedKey.slice(0, 24)}`
      || value.source_response_validation_hash !== value.source_response_validation.validation_hash
      || value.source_replay_execution_request_hash !== projection.request_hash
      || value.control_plane_attempt_lease_request_hash !== projection.attempt_lease_request_hash
      || value.worker_request_hash !== projection.worker_request_hash
      || value.worker_response_hash !== projection.worker_response_hash
      || value.decision_sequence !== context.decision_sequence || value.decision_time !== context.decision_time
      || value.decision_phase !== context.decision_phase
      || value.selected_schedule_entry_hash !== canonicalHash(projection.schedule_entry)
      || canonicalJson(value.selected_schedule_entry) !== canonicalJson(projection.schedule_entry)
      || value.expected_decision_output_hash !== canonicalHash(projection.expected_output)
      || canonicalJson(value.expected_decision_output) !== canonicalJson(projection.expected_output)
      || value.claimed_decision_output_hash !== canonicalHash(projection.claimed_output)
      || canonicalJson(value.claimed_decision_output) !== canonicalJson(projection.claimed_output)) {
    throw new Error("Authority Schedule Admission projection or parent binding drift")
  }
  if (admitted) {
    if (!projection.matches
        || canonicalJson(value.blockers) !== canonicalJson([
          "independent_worker_response_reproducibility_pair_and_harness_receipt_not_materialized",
        ])
        || value.schedule_admission !== "granted_exact_boundary_match"
        || value.decision_output_authority
          !== "schedule_matched_worker_claim_not_harness_receipt_admitted") {
      throw new Error("Authority Schedule Admission admitted projection drift")
    }
  } else if (projection.matches
      || canonicalJson(value.blockers)
        !== canonicalJson(["worker_decision_output_does_not_match_frozen_schedule"])
      || value.schedule_admission !== "not_granted" || value.decision_output_authority !== "none") {
    throw new Error("Authority Schedule Admission rejected projection drift")
  }
  const { admission_hash: hash, ...body } = value
  if (hash !== canonicalHash(body)) throw new Error("Authority Schedule Admission hash mismatch")
}

const FIELDS = ["admission_hash", "admission_id", "admission_key", "admission_policy_version",
  "admission_ref", "admission_status", "blockers", "claimed_decision_output",
  "claimed_decision_output_hash", "context_binding_policy", "control_plane_attempt_lease_request_hash",
  "decision_output_authority", "decision_phase", "decision_sequence", "decision_time", "economic_authority",
  "expected_decision_output", "expected_decision_output_hash", "harness_receipt_count", "harness_receipt_policy",
  "input_binding_policy", "order_authority", "output_binding_policy", "owner", "purpose",
  "request_binding_policy", "required_reproducibility_response_count", "response_admission",
  "response_instance_count", "schedule_admission", "schedule_selection_policy", "schedule_validation_count",
  "schema_version", "scope", "selected_schedule_entry", "selected_schedule_entry_hash", "signal_authority",
  "source_replay_execution_request", "source_replay_execution_request_hash", "source_response_validation",
  "source_response_validation_hash", "trial_authority", "worker_request_hash", "worker_response_hash"].sort()

function assertFields(value: object): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(FIELDS)) {
    throw new Error("Authority Schedule Admission fields drift")
  }
}
