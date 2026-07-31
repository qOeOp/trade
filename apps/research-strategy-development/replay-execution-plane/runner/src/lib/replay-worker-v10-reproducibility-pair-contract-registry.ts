import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_DISTINCT_BINDINGS,
  REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_CONTRACT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_SAME_BINDINGS,
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
  createReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
  replayDecisionHarnessWorkerV10ReproducibilityPairContractKey,
  type ReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-reproducibility-pair-contract"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission,
  type ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-schedule-admission"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10AuthorityScheduleAdmission } from "./replay-worker-v10-authority-schedule-admission-registry"

export interface RegisterReplayWorkerV10ReproducibilityPairContractInput {
  registry_root: string
  source_schedule_admission: ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission
}

export function registerReplayWorkerV10ReproducibilityPairContract(
  input: RegisterReplayWorkerV10ReproducibilityPairContractInput,
): ReplayDecisionHarnessWorkerV10ReproducibilityPairContract {
  requireDurableScheduleAdmission(input)
  const schedule = input.source_schedule_admission
  const validation = schedule.source_response_validation
  const dispatch = validation.source_dispatch_receipt
  const attempt = dispatch.source_dispatch_attempt
  const launch = attempt.source_process_launch_receipt
  const request = attempt.request_frame.worker_request
  const response = validation.response_frame?.worker_response
  if (!response || !launch.process_instance_id || launch.observed_child_pid === null) {
    throw new Error("Worker v10 Reproducibility Pair first process evidence is incomplete")
  }
  const key = contractKey(schedule)
  const existing = readReplayWorkerV10ReproducibilityPairContract(input)
  if (existing) return existing
  const contract = createReplayDecisionHarnessWorkerV10ReproducibilityPairContract({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_CONTRACT_SCHEMA_VERSION,
    contract_id: `decision-harness-worker-v10-reproducibility-pair-${key.slice(0, 24)}`,
    contract_ref: `contract://replay-decision-harness-worker-v10-reproducibility-pair/${key.slice(0, 24)}`,
    contract_key: key,
    reproducibility_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_POLICY_VERSION,
    scope: "one_schedule_admitted_response_bound_zero_pair_reproducibility_contract",
    owner: "replay_runner_worker_v10_reproducibility_pair_registry",
    purpose: "freeze_second_fresh_process_independence_and_parity_requirements_before_materialization",
    status: "requirements_frozen_second_response_and_pair_not_materialized",
    source_schedule_admission_hash: schedule.admission_hash,
    source_schedule_admission: structuredClone(schedule),
    source_response_validation_hash: validation.validation_hash,
    source_dispatch_receipt_hash: dispatch.receipt_hash,
    source_process_launch_receipt_hash: launch.receipt_hash,
    source_process_instance_id: launch.process_instance_id,
    source_observed_child_pid: launch.observed_child_pid,
    logical_request_id: request.logical_request_id,
    worker_request_hash: request.request_hash,
    worker_response_hash: response.response_hash,
    replay_execution_request_hash: schedule.source_replay_execution_request_hash,
    selected_schedule_entry_hash: schedule.selected_schedule_entry_hash,
    expected_decision_output_hash: schedule.expected_decision_output_hash,
    claimed_decision_output_hash: schedule.claimed_decision_output_hash,
    pair_model: "same_logical_request_exact_inner_response_two_distinct_fresh_authority_processes",
    same_binding_policy: "all_listed_bindings_exactly_equal_across_pair_members",
    required_same_bindings: [...REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_SAME_BINDINGS],
    process_independence_policy: "all_listed_authority_process_and_receipt_bindings_must_differ",
    required_distinct_bindings: [...REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_DISTINCT_BINDINGS],
    inner_response_parity_policy: "canonical_worker_response_v10_must_be_identical_including_trace",
    outer_response_parity_policy: "not_equal_authority_echoes_bind_distinct_command_intent_and_process_lineage",
    capsule_reuse_policy: "forbidden_second_process_requires_distinct_command_intent_capsule_lineage",
    successor_authority_policy:
      "not_selected_same_attempt_new_generation_or_control_plane_authorized_new_attempt_only",
    caller_supplied_second_response_policy: "forbidden_requires_future_durable_authority_lineage",
    first_schedule_admission_count: 1,
    second_schedule_admission_count: 0,
    response_instance_count: 1,
    required_response_instance_count: 2,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    second_schedule_admission: null,
    reproducibility_pair: null,
    harness_receipt: null,
    blockers: [
      "successor_verification_authority_lineage_not_materialized",
      "second_distinct_fresh_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_not_materialized",
      "worker_v10_harness_receipt_not_materialized",
    ],
    schedule_admission: "first_member_granted_second_member_not_granted",
    decision_output_authority: "first_schedule_matched_claim_only_pair_not_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const content = `${canonicalJson(contract)}\n`
  writeReplayImmutableCas(contractPath(input.registry_root, key), content)
  return parseContract(content)
}

export function readReplayWorkerV10ReproducibilityPairContract(
  input: RegisterReplayWorkerV10ReproducibilityPairContractInput,
): ReplayDecisionHarnessWorkerV10ReproducibilityPairContract | null {
  requireDurableScheduleAdmission(input)
  const path = contractPath(input.registry_root, contractKey(input.source_schedule_admission))
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Worker v10 Reproducibility Pair Contract must be a regular file")
  }
  const contract = parseContract(readFileSync(path, "utf8"))
  if (contract.source_schedule_admission_hash !== input.source_schedule_admission.admission_hash) {
    throw new Error("Worker v10 Reproducibility Pair Contract parent mismatch")
  }
  return contract
}

function requireDurableScheduleAdmission(input: RegisterReplayWorkerV10ReproducibilityPairContractInput): void {
  if (input.registry_root.trim() === "") throw new Error("Worker v10 Reproducibility Pair registry root is required")
  assertReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission(input.source_schedule_admission)
  if (input.source_schedule_admission.admission_status
      !== "admitted_exact_frozen_schedule_match_non_economic") {
    throw new Error("Worker v10 Reproducibility Pair requires an admitted Schedule parent")
  }
  const schedule = input.source_schedule_admission
  const durable = readReplayWorkerV10AuthorityScheduleAdmission({
    registry_root: input.registry_root,
    source_response_validation: schedule.source_response_validation,
    source_replay_execution_request: schedule.source_replay_execution_request,
  })
  if (!durable || durable.admission_hash !== schedule.admission_hash) {
    throw new Error("Worker v10 Reproducibility Pair requires the exact durable Schedule Admission")
  }
}

function contractKey(schedule: ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission): string {
  return replayDecisionHarnessWorkerV10ReproducibilityPairContractKey({
    schedule_admission_hash: schedule.admission_hash,
    reproducibility_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_PAIR_POLICY_VERSION,
  })
}

function contractPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-reproducibility-pair-contract-${key}.json`)
}

function parseContract(content: string): ReplayDecisionHarnessWorkerV10ReproducibilityPairContract {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10ReproducibilityPairContract
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Worker v10 Reproducibility Pair Contract is not canonical")
  return value
}
