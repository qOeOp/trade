import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission,
  type ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission,
} from "./replay-decision-harness-worker-v10-authority-schedule-admission"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_CONTRACT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-reproducibility-pair-contract.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_POLICY_VERSION =
  "rd-replay-harness-worker-v10-reproducibility-pair-v1" as const

export const REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_SAME_BINDINGS = Object.freeze([
  "logical_request_id", "worker_request_hash", "replay_execution_request_hash", "decision_sequence",
  "decision_time", "selected_schedule_entry_hash", "expected_decision_output_hash", "worker_response_hash",
  "claimed_decision_output_hash", "code_admission_hash", "source_bundle_hash", "artifact_hash",
  "request_context_hash", "decision_input_snapshot_hash", "decision_market_input_snapshot_hash",
  "decision_state_snapshot_hash", "worker_protocol_version", "worker_request_schema_version",
  "worker_response_schema_version",
].sort())

export const REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_DISTINCT_BINDINGS = Object.freeze([
  "execution_admission_command_hash", "process_launch_intent_hash", "authority_capsule_record_hash",
  "authority_capsule_hash", "spawn_revalidation_hash", "process_launch_attempt_hash",
  "process_launch_receipt_hash", "process_instance_id", "observed_child_pid", "dispatch_attempt_hash",
  "dispatch_receipt_hash", "response_validation_hash", "schedule_admission_hash",
].sort())

export interface ReplayDecisionHarnessWorkerV10ReproducibilityPairContract {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_CONTRACT_SCHEMA_VERSION
  contract_id: string
  contract_ref: string
  contract_key: string
  contract_hash: string
  reproducibility_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_POLICY_VERSION
  scope: "one_schedule_admitted_response_bound_zero_pair_reproducibility_contract"
  owner: "replay_runner_worker_v10_reproducibility_pair_registry"
  purpose: "freeze_second_fresh_process_independence_and_parity_requirements_before_materialization"
  status: "requirements_frozen_second_response_and_pair_not_materialized"
  source_schedule_admission_hash: string
  source_schedule_admission: ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission
  source_response_validation_hash: string
  source_dispatch_receipt_hash: string
  source_process_launch_receipt_hash: string
  source_process_instance_id: string
  source_observed_child_pid: number
  logical_request_id: string
  worker_request_hash: string
  worker_response_hash: string
  replay_execution_request_hash: string
  selected_schedule_entry_hash: string
  expected_decision_output_hash: string
  claimed_decision_output_hash: string
  pair_model: "same_logical_request_exact_inner_response_two_distinct_fresh_authority_processes"
  same_binding_policy: "all_listed_bindings_exactly_equal_across_pair_members"
  required_same_bindings: string[]
  process_independence_policy: "all_listed_authority_process_and_receipt_bindings_must_differ"
  required_distinct_bindings: string[]
  inner_response_parity_policy: "canonical_worker_response_v10_must_be_identical_including_trace"
  outer_response_parity_policy: "not_equal_authority_echoes_bind_distinct_command_intent_and_process_lineage"
  capsule_reuse_policy: "forbidden_second_process_requires_distinct_command_intent_capsule_lineage"
  successor_authority_policy:
    "not_selected_same_attempt_new_generation_or_control_plane_authorized_new_attempt_only"
  caller_supplied_second_response_policy: "forbidden_requires_future_durable_authority_lineage"
  first_schedule_admission_count: 1
  second_schedule_admission_count: 0
  response_instance_count: 1
  required_response_instance_count: 2
  reproducibility_pair_count: 0
  harness_receipt_count: 0
  second_schedule_admission: null
  reproducibility_pair: null
  harness_receipt: null
  blockers: [
    "successor_verification_authority_lineage_not_materialized",
    "second_distinct_fresh_process_schedule_admission_not_materialized",
    "response_reproducibility_pair_not_materialized",
    "worker_v10_harness_receipt_not_materialized",
  ]
  schedule_admission: "first_member_granted_second_member_not_granted"
  decision_output_authority: "first_schedule_matched_claim_only_pair_not_admitted"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10ReproducibilityPairContractBody = Omit<
  ReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
  "contract_hash"
>

export function replayDecisionHarnessWorkerV10ReproducibilityPairContractKey(input: {
  schedule_admission_hash: string
  reproducibility_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_POLICY_VERSION
}): string {
  requireHash(input.schedule_admission_hash, "Worker v10 Reproducibility Pair Schedule Admission hash")
  if (input.reproducibility_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_POLICY_VERSION) {
    throw new Error("unsupported Worker v10 Reproducibility Pair natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10ReproducibilityPairContract(
  body: ReplayDecisionHarnessWorkerV10ReproducibilityPairContractBody,
): ReplayDecisionHarnessWorkerV10ReproducibilityPairContract {
  const value = { ...structuredClone(body), contract_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract(
  value: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_CONTRACT_SCHEMA_VERSION
      || value.reproducibility_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_POLICY_VERSION
      || value.scope !== "one_schedule_admitted_response_bound_zero_pair_reproducibility_contract"
      || value.owner !== "replay_runner_worker_v10_reproducibility_pair_registry"
      || value.purpose
        !== "freeze_second_fresh_process_independence_and_parity_requirements_before_materialization"
      || value.status !== "requirements_frozen_second_response_and_pair_not_materialized"
      || value.pair_model
        !== "same_logical_request_exact_inner_response_two_distinct_fresh_authority_processes"
      || value.same_binding_policy !== "all_listed_bindings_exactly_equal_across_pair_members"
      || canonicalJson(value.required_same_bindings)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_SAME_BINDINGS)
      || value.process_independence_policy
        !== "all_listed_authority_process_and_receipt_bindings_must_differ"
      || canonicalJson(value.required_distinct_bindings)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_DISTINCT_BINDINGS)
      || value.inner_response_parity_policy
        !== "canonical_worker_response_v10_must_be_identical_including_trace"
      || value.outer_response_parity_policy
        !== "not_equal_authority_echoes_bind_distinct_command_intent_and_process_lineage"
      || value.capsule_reuse_policy
        !== "forbidden_second_process_requires_distinct_command_intent_capsule_lineage"
      || value.successor_authority_policy
        !== "not_selected_same_attempt_new_generation_or_control_plane_authorized_new_attempt_only"
      || value.caller_supplied_second_response_policy
        !== "forbidden_requires_future_durable_authority_lineage"
      || value.first_schedule_admission_count !== 1 || value.second_schedule_admission_count !== 0
      || value.response_instance_count !== 1 || value.required_response_instance_count !== 2
      || value.reproducibility_pair_count !== 0 || value.harness_receipt_count !== 0
      || value.second_schedule_admission !== null || value.reproducibility_pair !== null
      || value.harness_receipt !== null
      || canonicalJson(value.blockers) !== canonicalJson([
        "successor_verification_authority_lineage_not_materialized",
        "second_distinct_fresh_process_schedule_admission_not_materialized",
        "response_reproducibility_pair_not_materialized",
        "worker_v10_harness_receipt_not_materialized",
      ])
      || value.schedule_admission !== "first_member_granted_second_member_not_granted"
      || value.decision_output_authority !== "first_schedule_matched_claim_only_pair_not_admitted"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Worker v10 Reproducibility Pair Contract")
  }
  for (const item of [value.contract_id, value.contract_ref, value.source_process_instance_id,
    value.logical_request_id]) requireText(item, "Worker v10 Reproducibility Pair identity")
  for (const item of [value.contract_key, value.contract_hash, value.source_schedule_admission_hash,
    value.source_response_validation_hash, value.source_dispatch_receipt_hash,
    value.source_process_launch_receipt_hash, value.worker_request_hash, value.worker_response_hash,
    value.replay_execution_request_hash, value.selected_schedule_entry_hash,
    value.expected_decision_output_hash, value.claimed_decision_output_hash]) {
    requireHash(item, "Worker v10 Reproducibility Pair hash")
  }
  if (!Number.isSafeInteger(value.source_observed_child_pid) || value.source_observed_child_pid < 1) {
    throw new Error("Worker v10 Reproducibility Pair source PID is invalid")
  }
  assertReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission(value.source_schedule_admission)
  const schedule = value.source_schedule_admission
  if (schedule.admission_status !== "admitted_exact_frozen_schedule_match_non_economic") {
    throw new Error("Worker v10 Reproducibility Pair requires an admitted first Schedule member")
  }
  const validation = schedule.source_response_validation
  const dispatch = validation.source_dispatch_receipt
  const attempt = dispatch.source_dispatch_attempt
  const launch = attempt.source_process_launch_receipt
  const request = attempt.request_frame.worker_request
  const response = validation.response_frame?.worker_response
  if (!response || !launch.process_instance_id || launch.observed_child_pid === null) {
    throw new Error("Worker v10 Reproducibility Pair first process evidence is incomplete")
  }
  const key = replayDecisionHarnessWorkerV10ReproducibilityPairContractKey({
    schedule_admission_hash: schedule.admission_hash,
    reproducibility_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_POLICY_VERSION,
  })
  if (value.contract_key !== key
      || value.contract_id !== `decision-harness-worker-v10-reproducibility-pair-${key.slice(0, 24)}`
      || value.contract_ref !== `contract://replay-decision-harness-worker-v10-reproducibility-pair/${key.slice(0, 24)}`
      || value.source_schedule_admission_hash !== schedule.admission_hash
      || value.source_response_validation_hash !== validation.validation_hash
      || value.source_dispatch_receipt_hash !== dispatch.receipt_hash
      || value.source_process_launch_receipt_hash !== launch.receipt_hash
      || value.source_process_instance_id !== launch.process_instance_id
      || value.source_observed_child_pid !== launch.observed_child_pid
      || value.logical_request_id !== request.logical_request_id
      || value.worker_request_hash !== request.request_hash
      || value.worker_response_hash !== response.response_hash
      || value.replay_execution_request_hash !== schedule.source_replay_execution_request_hash
      || value.selected_schedule_entry_hash !== schedule.selected_schedule_entry_hash
      || value.expected_decision_output_hash !== schedule.expected_decision_output_hash
      || value.claimed_decision_output_hash !== schedule.claimed_decision_output_hash) {
    throw new Error("Worker v10 Reproducibility Pair first member binding drift")
  }
  const { contract_hash: hash, ...body } = value
  if (hash !== canonicalHash(body)) throw new Error("Worker v10 Reproducibility Pair Contract hash mismatch")
}

const FIELDS = ["blockers", "caller_supplied_second_response_policy", "capsule_reuse_policy",
  "claimed_decision_output_hash", "contract_hash", "contract_id", "contract_key", "contract_ref",
  "decision_output_authority", "economic_authority", "expected_decision_output_hash",
  "first_schedule_admission_count", "harness_receipt", "harness_receipt_count",
  "inner_response_parity_policy", "logical_request_id", "order_authority", "outer_response_parity_policy",
  "owner", "pair_model", "process_independence_policy", "purpose", "replay_execution_request_hash",
  "reproducibility_pair", "reproducibility_pair_count", "reproducibility_policy_version",
  "required_distinct_bindings", "required_response_instance_count", "required_same_bindings",
  "response_instance_count", "same_binding_policy", "schedule_admission", "schema_version", "scope",
  "second_schedule_admission", "second_schedule_admission_count", "selected_schedule_entry_hash",
  "signal_authority", "source_dispatch_receipt_hash", "source_observed_child_pid",
  "source_process_instance_id", "source_process_launch_receipt_hash", "source_response_validation_hash",
  "source_schedule_admission", "source_schedule_admission_hash", "status", "successor_authority_policy",
  "trial_authority", "worker_request_hash", "worker_response_hash"].sort()

function assertFields(value: object): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(FIELDS)) {
    throw new Error("Worker v10 Reproducibility Pair Contract fields drift")
  }
}
