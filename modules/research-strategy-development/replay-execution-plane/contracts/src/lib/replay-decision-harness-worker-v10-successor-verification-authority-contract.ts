import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
  type ReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
} from "./replay-decision-harness-worker-v10-reproducibility-pair-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_CONTRACT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-verification-authority-contract.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-verification-authority-v1" as const

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_IMMUTABLE_BINDINGS = Object.freeze([
  "attempt_id", "attempt_ordinal", "claimed_at", "logical_request_id", "replay_execution_request_hash",
  "reservation_hash", "reservation_ref", "run_id", "trial_id", "worker_id", "worker_request_hash",
].sort())

export interface ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_CONTRACT_SCHEMA_VERSION
  contract_id: string
  contract_ref: string
  contract_key: string
  contract_hash: string
  authority_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_POLICY_VERSION
  scope: "one_reproducibility_pair_contract_bound_zero_instance_successor_authority_selection"
  owner: "replay_runner_worker_v10_successor_verification_authority_registry"
  purpose: "select_the_control_plane_authority_lineage_for_the_second_reproducibility_member"
  status: "same_attempt_successor_generation_selected_not_materialized"
  source_reproducibility_pair_contract_hash: string
  source_reproducibility_pair_contract: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract
  source_first_schedule_admission_hash: string
  source_first_execution_envelope_hash: string
  source_first_attempt_lease_hash: string
  source_first_attempt_id: string
  source_first_attempt_ordinal: number
  source_first_worker_id: string
  source_first_lease_generation: number
  selected_successor_authority_kind: "same_attempt_higher_lease_generation"
  selection_reason:
    "reproducibility_verification_is_one_attempt_execution_obligation_not_a_terminal_retry"
  cross_attempt_policy:
    "new_attempt_reserved_for_control_plane_authorized_recovery_after_prior_attempt_terminal_or_expired"
  replay_renewal_authority: "none_control_plane_only"
  control_plane_required_operation:
    "renew_current_active_attempt_lease_then_publish_authoritative_successor_lease_evidence"
  successor_generation_policy: "strictly_higher_generation_with_predecessor_link"
  minimum_successor_lease_generation: number
  immutable_binding_policy: "all_listed_attempt_request_and_reservation_bindings_exactly_equal"
  required_immutable_bindings: string[]
  successor_envelope_policy:
    "new_execution_envelope_must_reference_first_envelope_as_predecessor_and_bind_successor_lease"
  successor_command_policy:
    "new_generation_requires_fresh_command_intent_capsule_revalidation_and_process_lineage"
  first_authority_reuse_policy: "forbidden_first_command_intent_capsule_and_process_are_historical"
  currentness_policy:
    "future_control_plane_transaction_must_prove_first_attempt_is_current_active_and_not_cancelled_or_fenced"
  successor_attempt_lease: null
  successor_execution_envelope: null
  successor_execution_admission_command: null
  successor_process_launch_intent: null
  successor_authority_capsule: null
  successor_authority_lineage_count: 0
  second_schedule_admission_count: 0
  reproducibility_pair_count: 0
  harness_receipt_count: 0
  blockers: [
    "control_plane_successor_lease_evidence_not_materialized",
    "predecessor_linked_successor_execution_envelope_not_materialized",
    "successor_command_intent_capsule_and_process_lineage_not_materialized",
    "second_distinct_fresh_process_schedule_admission_not_materialized",
    "response_reproducibility_pair_not_materialized",
    "worker_v10_harness_receipt_not_materialized",
  ]
  decision_output_authority: "first_schedule_matched_claim_only_successor_not_admitted"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContractBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
  "contract_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContractKey(input: {
  reproducibility_pair_contract_hash: string
  authority_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_POLICY_VERSION
}): string {
  requireHash(input.reproducibility_pair_contract_hash, "Worker v10 successor authority Pair Contract hash")
  if (input.authority_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_POLICY_VERSION) {
    throw new Error("unsupported Worker v10 successor verification authority natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract(
  body: ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContractBody,
): ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract {
  const value = { ...structuredClone(body), contract_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract(
  value: ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_CONTRACT_SCHEMA_VERSION
      || value.authority_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_POLICY_VERSION
      || value.scope !== "one_reproducibility_pair_contract_bound_zero_instance_successor_authority_selection"
      || value.owner !== "replay_runner_worker_v10_successor_verification_authority_registry"
      || value.purpose
        !== "select_the_control_plane_authority_lineage_for_the_second_reproducibility_member"
      || value.status !== "same_attempt_successor_generation_selected_not_materialized"
      || value.selected_successor_authority_kind !== "same_attempt_higher_lease_generation"
      || value.selection_reason
        !== "reproducibility_verification_is_one_attempt_execution_obligation_not_a_terminal_retry"
      || value.cross_attempt_policy
        !== "new_attempt_reserved_for_control_plane_authorized_recovery_after_prior_attempt_terminal_or_expired"
      || value.replay_renewal_authority !== "none_control_plane_only"
      || value.control_plane_required_operation
        !== "renew_current_active_attempt_lease_then_publish_authoritative_successor_lease_evidence"
      || value.successor_generation_policy !== "strictly_higher_generation_with_predecessor_link"
      || value.immutable_binding_policy
        !== "all_listed_attempt_request_and_reservation_bindings_exactly_equal"
      || canonicalJson(value.required_immutable_bindings)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_IMMUTABLE_BINDINGS)
      || value.successor_envelope_policy
        !== "new_execution_envelope_must_reference_first_envelope_as_predecessor_and_bind_successor_lease"
      || value.successor_command_policy
        !== "new_generation_requires_fresh_command_intent_capsule_revalidation_and_process_lineage"
      || value.first_authority_reuse_policy
        !== "forbidden_first_command_intent_capsule_and_process_are_historical"
      || value.currentness_policy
        !== "future_control_plane_transaction_must_prove_first_attempt_is_current_active_and_not_cancelled_or_fenced"
      || value.successor_attempt_lease !== null || value.successor_execution_envelope !== null
      || value.successor_execution_admission_command !== null
      || value.successor_process_launch_intent !== null || value.successor_authority_capsule !== null
      || value.successor_authority_lineage_count !== 0 || value.second_schedule_admission_count !== 0
      || value.reproducibility_pair_count !== 0 || value.harness_receipt_count !== 0
      || canonicalJson(value.blockers) !== canonicalJson([
        "control_plane_successor_lease_evidence_not_materialized",
        "predecessor_linked_successor_execution_envelope_not_materialized",
        "successor_command_intent_capsule_and_process_lineage_not_materialized",
        "second_distinct_fresh_process_schedule_admission_not_materialized",
        "response_reproducibility_pair_not_materialized",
        "worker_v10_harness_receipt_not_materialized",
      ])
      || value.decision_output_authority !== "first_schedule_matched_claim_only_successor_not_admitted"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Worker v10 successor verification authority Contract")
  }
  for (const item of [value.contract_id, value.contract_ref, value.source_first_attempt_id,
    value.source_first_worker_id]) requireText(item, "Worker v10 successor authority identity")
  for (const item of [value.contract_key, value.contract_hash, value.source_reproducibility_pair_contract_hash,
    value.source_first_schedule_admission_hash, value.source_first_execution_envelope_hash,
    value.source_first_attempt_lease_hash]) requireHash(item, "Worker v10 successor authority hash")
  if (!Number.isSafeInteger(value.source_first_attempt_ordinal) || value.source_first_attempt_ordinal < 1
      || !Number.isSafeInteger(value.source_first_lease_generation) || value.source_first_lease_generation < 1
      || value.minimum_successor_lease_generation !== value.source_first_lease_generation + 1) {
    throw new Error("Worker v10 successor authority Attempt ordinal or generation is invalid")
  }
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract(
    value.source_reproducibility_pair_contract,
  )
  const pair = value.source_reproducibility_pair_contract
  const launch = pair.source_schedule_admission.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.source_process_launch_receipt
  const spawn = launch.source_launch_attempt.source_spawn_revalidation
  const command = spawn.source_authority_capsule.source_authority_process_launch_intent
    .source_authority_execution_admission_command
  if (value.source_reproducibility_pair_contract_hash !== pair.contract_hash
      || value.source_first_schedule_admission_hash !== pair.source_schedule_admission_hash
      || value.source_first_execution_envelope_hash !== command.source_execution_envelope_hash
      || value.source_first_attempt_lease_hash !== command.current_attempt_lease_hash
      || value.source_first_attempt_id !== command.attempt_id
      || value.source_first_attempt_ordinal !== command.attempt_ordinal
      || value.source_first_worker_id !== command.worker_id
      || value.source_first_lease_generation !== command.lease_generation) {
    throw new Error("Worker v10 successor authority first lineage binding drift")
  }
  const key = replayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContractKey({
    reproducibility_pair_contract_hash: pair.contract_hash,
    authority_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_POLICY_VERSION,
  })
  if (value.contract_key !== key
      || value.contract_id !== `decision-harness-worker-v10-successor-authority-${key.slice(0, 24)}`
      || value.contract_ref !== `contract://replay-decision-harness-worker-v10-successor-authority/${key.slice(0, 24)}`) {
    throw new Error("Worker v10 successor authority identity drift")
  }
  const { contract_hash: hash, ...body } = value
  if (hash !== canonicalHash(body)) throw new Error("Worker v10 successor authority Contract hash mismatch")
}

const FIELDS = ["authority_policy_version", "blockers", "contract_hash", "contract_id", "contract_key",
  "contract_ref", "control_plane_required_operation", "cross_attempt_policy", "currentness_policy",
  "decision_output_authority", "economic_authority", "first_authority_reuse_policy", "harness_receipt_count",
  "immutable_binding_policy", "minimum_successor_lease_generation", "order_authority", "owner", "purpose",
  "replay_renewal_authority", "reproducibility_pair_count", "required_immutable_bindings", "schema_version",
  "scope", "second_schedule_admission_count", "selected_successor_authority_kind", "selection_reason",
  "signal_authority", "source_first_attempt_id", "source_first_attempt_lease_hash",
  "source_first_attempt_ordinal", "source_first_execution_envelope_hash", "source_first_lease_generation",
  "source_first_schedule_admission_hash", "source_first_worker_id", "source_reproducibility_pair_contract",
  "source_reproducibility_pair_contract_hash", "status", "successor_attempt_lease",
  "successor_authority_capsule", "successor_authority_lineage_count", "successor_command_policy",
  "successor_envelope_policy", "successor_execution_admission_command", "successor_execution_envelope",
  "successor_generation_policy", "successor_process_launch_intent", "trial_authority"].sort()

function assertFields(value: object): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(FIELDS)) {
    throw new Error("Worker v10 successor verification authority Contract fields drift")
  }
}
