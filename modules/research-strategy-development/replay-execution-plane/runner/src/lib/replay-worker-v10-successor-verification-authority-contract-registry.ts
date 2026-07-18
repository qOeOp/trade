import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_IMMUTABLE_BINDINGS,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_CONTRACT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
  createReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
  replayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContractKey,
  type ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-verification-authority-contract"
import {
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
  type ReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-reproducibility-pair-contract"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10ReproducibilityPairContract } from "./replay-worker-v10-reproducibility-pair-contract-registry"

export interface RegisterReplayWorkerV10SuccessorVerificationAuthorityContractInput {
  registry_root: string
  source_reproducibility_pair_contract: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract
}

export function registerReplayWorkerV10SuccessorVerificationAuthorityContract(
  input: RegisterReplayWorkerV10SuccessorVerificationAuthorityContractInput,
): ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract {
  requireDurablePairContract(input)
  const pair = input.source_reproducibility_pair_contract
  const launch = pair.source_schedule_admission.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.source_process_launch_receipt
  const command = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
    .source_authority_process_launch_intent.source_authority_execution_admission_command
  const key = contractKey(pair)
  const existing = readReplayWorkerV10SuccessorVerificationAuthorityContract(input)
  if (existing) return existing
  const contract = createReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_CONTRACT_SCHEMA_VERSION,
    contract_id: `decision-harness-worker-v10-successor-authority-${key.slice(0, 24)}`,
    contract_ref: `contract://replay-decision-harness-worker-v10-successor-authority/${key.slice(0, 24)}`,
    contract_key: key,
    authority_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_POLICY_VERSION,
    scope: "one_reproducibility_pair_contract_bound_zero_instance_successor_authority_selection",
    owner: "replay_runner_worker_v10_successor_verification_authority_registry",
    purpose: "select_the_control_plane_authority_lineage_for_the_second_reproducibility_member",
    status: "same_attempt_successor_generation_selected_not_materialized",
    source_reproducibility_pair_contract_hash: pair.contract_hash,
    source_reproducibility_pair_contract: structuredClone(pair),
    source_first_schedule_admission_hash: pair.source_schedule_admission_hash,
    source_first_execution_envelope_hash: command.source_execution_envelope_hash,
    source_first_attempt_lease_hash: command.current_attempt_lease_hash,
    source_first_attempt_id: command.attempt_id,
    source_first_attempt_ordinal: command.attempt_ordinal,
    source_first_worker_id: command.worker_id,
    source_first_lease_generation: command.lease_generation,
    selected_successor_authority_kind: "same_attempt_higher_lease_generation",
    selection_reason:
      "reproducibility_verification_is_one_attempt_execution_obligation_not_a_terminal_retry",
    cross_attempt_policy:
      "new_attempt_reserved_for_control_plane_authorized_recovery_after_prior_attempt_terminal_or_expired",
    replay_renewal_authority: "none_control_plane_only",
    control_plane_required_operation:
      "renew_current_active_attempt_lease_then_publish_authoritative_successor_lease_evidence",
    successor_generation_policy: "strictly_higher_generation_with_predecessor_link",
    minimum_successor_lease_generation: command.lease_generation + 1,
    immutable_binding_policy: "all_listed_attempt_request_and_reservation_bindings_exactly_equal",
    required_immutable_bindings: [...REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_IMMUTABLE_BINDINGS],
    successor_envelope_policy:
      "new_execution_envelope_must_reference_first_envelope_as_predecessor_and_bind_successor_lease",
    successor_command_policy:
      "new_generation_requires_fresh_command_intent_capsule_revalidation_and_process_lineage",
    first_authority_reuse_policy: "forbidden_first_command_intent_capsule_and_process_are_historical",
    currentness_policy:
      "future_control_plane_transaction_must_prove_first_attempt_is_current_active_and_not_cancelled_or_fenced",
    successor_attempt_lease: null,
    successor_execution_envelope: null,
    successor_execution_admission_command: null,
    successor_process_launch_intent: null,
    successor_authority_capsule: null,
    successor_authority_lineage_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    blockers: [
      "control_plane_successor_lease_evidence_not_materialized",
      "predecessor_linked_successor_execution_envelope_not_materialized",
      "successor_command_intent_capsule_and_process_lineage_not_materialized",
      "second_distinct_fresh_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_not_materialized",
      "worker_v10_harness_receipt_not_materialized",
    ],
    decision_output_authority: "first_schedule_matched_claim_only_successor_not_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const content = `${canonicalJson(contract)}\n`
  writeReplayImmutableCas(contractPath(input.registry_root, key), content)
  return parseContract(content)
}

export function readReplayWorkerV10SuccessorVerificationAuthorityContract(
  input: RegisterReplayWorkerV10SuccessorVerificationAuthorityContractInput,
): ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract | null {
  requireDurablePairContract(input)
  const path = contractPath(input.registry_root, contractKey(input.source_reproducibility_pair_contract))
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Worker v10 successor verification authority Contract must be a regular file")
  }
  const contract = parseContract(readFileSync(path, "utf8"))
  if (contract.source_reproducibility_pair_contract_hash
      !== input.source_reproducibility_pair_contract.contract_hash) {
    throw new Error("Worker v10 successor verification authority Contract parent mismatch")
  }
  return contract
}

function requireDurablePairContract(
  input: RegisterReplayWorkerV10SuccessorVerificationAuthorityContractInput,
): void {
  if (input.registry_root.trim() === "") {
    throw new Error("Worker v10 successor verification authority registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract(
    input.source_reproducibility_pair_contract,
  )
  const pair = input.source_reproducibility_pair_contract
  const durable = readReplayWorkerV10ReproducibilityPairContract({
    registry_root: input.registry_root,
    source_schedule_admission: pair.source_schedule_admission,
  })
  if (!durable || durable.contract_hash !== pair.contract_hash) {
    throw new Error("Worker v10 successor authority requires the exact durable Reproducibility Pair Contract")
  }
}

function contractKey(pair: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract): string {
  return replayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContractKey({
    reproducibility_pair_contract_hash: pair.contract_hash,
    authority_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_VERIFICATION_AUTHORITY_POLICY_VERSION,
  })
}

function contractPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-verification-authority-contract-${key}.json`)
}

function parseContract(content: string): ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Worker v10 successor verification authority Contract is not canonical")
  }
  return value
}
