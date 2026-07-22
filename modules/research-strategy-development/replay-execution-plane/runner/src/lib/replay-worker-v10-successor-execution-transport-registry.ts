import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  replayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmissionKey,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import {
  assertReplayDecisionHarnessWorkerV10TransportContract,
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  buildReplayDecisionHarnessWorkerV10TransportContract,
} from "./replay-decision-harness-worker-v10-transport-contract"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  readReplayWorkerV10SuccessorExecutionEnvelope,
} from "./replay-worker-v10-successor-execution-envelope-registry"
import {
  readReplayWorkerV10TransportContract,
  registerReplayWorkerV10TransportContract,
} from "./replay-worker-v10-transport-contract-registry"
import { registerReplayDurableParentValidationReceipt } from "./replay-durable-parent-validation-receipt"

export interface RegisterReplayWorkerV10SuccessorExecutionTransportInput {
  registry_root: string
  source_successor_execution_envelope_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission
}

export function registerReplayWorkerV10SuccessorExecutionTransport(
  input: RegisterReplayWorkerV10SuccessorExecutionTransportInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  requireDurableParent(input)
  const predecessor = extractPredecessorTransportContract(
    input.source_successor_execution_envelope_admission,
  )
  const successor = registerReplayWorkerV10TransportContract({
    registry_root: input.registry_root,
    source_worker_v10_build_capability: predecessor.source_worker_v10_build_capability,
    source_execution_envelope:
      input.source_successor_execution_envelope_admission.successor_execution_envelope,
    source_successor_execution_envelope_admission:
      input.source_successor_execution_envelope_admission,
  })
  const expected = buildAdmission(
    input.source_successor_execution_envelope_admission,
    predecessor,
    successor,
  )
  const path = admissionPath(input.registry_root, expected.admission_key)
  const existing = readAdmission(path)
  if (existing) return registerValidationReceipt(
    input.registry_root,
    sameAdmission(existing, expected),
    `${canonicalJson(existing)}\n`,
  )
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readAdmission(path)
    if (winner) return registerValidationReceipt(
      input.registry_root,
      sameAdmission(winner, expected),
      `${canonicalJson(winner)}\n`,
    )
    throw error
  }
  return registerValidationReceipt(input.registry_root, parseAdmission(content), content)
}

export function readReplayWorkerV10SuccessorExecutionTransport(
  input: RegisterReplayWorkerV10SuccessorExecutionTransportInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission | null {
  requireDurableParent(input)
  const predecessor = extractPredecessorTransportContract(
    input.source_successor_execution_envelope_admission,
  )
  const successor = readReplayWorkerV10TransportContract({
    registry_root: input.registry_root,
    source_worker_v10_build_capability: predecessor.source_worker_v10_build_capability,
    source_execution_envelope:
      input.source_successor_execution_envelope_admission.successor_execution_envelope,
    source_successor_execution_envelope_admission:
      input.source_successor_execution_envelope_admission,
  })
  if (!successor) return null
  const expected = buildAdmission(
    input.source_successor_execution_envelope_admission,
    predecessor,
    successor,
  )
  const value = readAdmission(admissionPath(input.registry_root, expected.admission_key))
  if (!value) return null
  return registerValidationReceipt(
    input.registry_root,
    sameAdmission(value, expected),
    `${canonicalJson(value)}\n`,
  )
}

function buildAdmission(
  envelopeAdmission: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
  predecessor: ReplayDecisionHarnessWorkerV10TransportContract,
  successor: ReplayDecisionHarnessWorkerV10TransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(envelopeAdmission)
  assertReplayDecisionHarnessWorkerV10TransportContract(predecessor)
  assertReplayDecisionHarnessWorkerV10TransportContract(successor)
  const rebuilt = buildReplayDecisionHarnessWorkerV10TransportContract({
    source_worker_v10_build_capability: predecessor.source_worker_v10_build_capability,
    source_execution_envelope: envelopeAdmission.successor_execution_envelope,
  })
  if (canonicalJson(successor) !== canonicalJson(rebuilt)) {
    throw new Error("successor execution Transport Contract deterministic rebuild drift")
  }
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmissionKey({
    source_successor_execution_envelope_admission_hash: envelopeAdmission.admission_hash,
    successor_base_transport_contract_hash: successor.contract_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_SCHEMA_VERSION,
    admission_id: `decision-harness-worker-v10-successor-transport-${key.slice(0, 24)}`,
    admission_ref:
      `admission://replay-decision-harness-worker-v10-successor-transport/${key.slice(0, 24)}`,
    admission_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION,
    scope: "one_successor_execution_envelope_bound_zero_instance_base_transport_contract",
    owner: "replay_runner_worker_v10_successor_execution_transport_registry",
    purpose: "freeze_reuse_boundary_and_rebind_transport_root_without_command_or_process",
    status: "successor_base_transport_admitted_command_not_materialized",
    source_successor_execution_envelope_admission_hash: envelopeAdmission.admission_hash,
    source_successor_execution_envelope_admission: structuredClone(envelopeAdmission),
    source_predecessor_transport_contract_hash: predecessor.contract_hash,
    source_predecessor_transport_contract: structuredClone(predecessor),
    successor_base_transport_contract_hash: successor.contract_hash,
    successor_base_transport_contract: structuredClone(successor),
    attempt_id: envelopeAdmission.attempt_id,
    attempt_ordinal: envelopeAdmission.attempt_ordinal,
    worker_id: envelopeAdmission.worker_id,
    predecessor_lease_generation: envelopeAdmission.predecessor_lease_generation,
    successor_lease_generation: envelopeAdmission.successor_lease_generation,
    reuse_boundary_policy: "reuse_only_envelope_independent_immutable_code_and_logical_request_evidence",
    reusable_evidence: [
      "code_admission_and_source_bundle",
      "worker_v10_build_capability_and_decoder_artifact",
      "logical_worker_request_and_response_contract",
      "protocol_frame_schemas_and_resource_limits",
    ],
    rebuild_boundary_policy:
      "every_object_whose_hash_or_semantics_embed_predecessor_envelope_must_be_fresh",
    rebuild_required: [
      "execution_envelope_bound_base_transport_contract",
      "transport_bound_stdio_capability_even_if_artifact_bytes_rebuild_identically",
      "stdio_capability_bound_negative_probe_receipt",
      "artifact_bound_successor_transport_and_execution_admission_contract",
      "lease_observation_clock_command_intent_capsule_revalidation_and_process_lineage",
    ],
    registry_durability: "replay_local_immutable_cas_regular_file_canonical_json",
    reused_worker_v10_build_capability_count: 1,
    successor_base_transport_contract_count: 1,
    successor_stdio_capability_count: 0,
    successor_negative_probe_receipt_count: 0,
    successor_artifact_bound_transport_contract_count: 0,
    successor_execution_admission_contract_count: 0,
    successor_execution_admission_command_count: 0,
    successor_process_launch_intent_count: 0,
    successor_authority_capsule_count: 0,
    successor_spawn_revalidation_count: 0,
    successor_process_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    transport_authority: "contract_frozen_zero_instance_not_activated",
    command_authority: "none_fresh_envelope_bound_chain_required",
    process_authority: "none",
    blockers: [
      "successor_stdio_capability_and_negative_probe_not_materialized",
      "successor_artifact_bound_transport_and_execution_admission_contract_not_materialized",
      "successor_command_intent_capsule_revalidation_and_process_lineage_not_materialized",
      "second_distinct_fresh_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_and_harness_receipt_not_materialized",
    ],
    decision_output_authority: "first_schedule_matched_claim_only_successor_transport_root_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function extractPredecessorTransportContract(
  envelopeAdmission: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
): ReplayDecisionHarnessWorkerV10TransportContract {
  const pair = envelopeAdmission.source_successor_lease_admission.source_successor_authority_contract
    .source_reproducibility_pair_contract
  const launch = pair.source_schedule_admission.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.source_process_launch_receipt
  const command = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
    .source_authority_process_launch_intent.source_authority_execution_admission_command
  const predecessorCommand = command.source_authority_transport_contract.source_activated_stdio_capability
    .source_authority_frame_build_contract.source_launch_readiness_gate.source_process_launch_intent
    .source_execution_admission_command
  const transport = predecessorCommand.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract.source_negative_probe_receipt
    .source_stdio_capability.source_transport_contract
  assertReplayDecisionHarnessWorkerV10TransportContract(transport)
  if (transport.source_execution_envelope_hash
      !== envelopeAdmission.source_predecessor_execution_envelope_hash) {
    throw new Error("successor execution Transport Admission does not embed its exact predecessor Transport")
  }
  return structuredClone(transport)
}

function requireDurableParent(input: RegisterReplayWorkerV10SuccessorExecutionTransportInput): void {
  requireInput(input)
  const admission = input.source_successor_execution_envelope_admission
  const durable = readReplayWorkerV10SuccessorExecutionEnvelope({
    registry_root: input.registry_root,
    source_successor_lease_admission: admission.source_successor_lease_admission,
  })
  if (!durable || durable.admission_hash !== admission.admission_hash) {
    throw new Error("successor execution Transport requires the exact durable R4.144 Envelope Admission")
  }
}

function requireInput(input: RegisterReplayWorkerV10SuccessorExecutionTransportInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("successor execution Transport registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(
    input.source_successor_execution_envelope_admission,
  )
}

function sameAdmission(
  existing: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor execution Transport admission natural key has different evidence")
  }
  return existing
}

function readAdmission(
  path: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Transport admission must be a regular file")
  }
  return parseAdmission(readFileSync(path, "utf8"))
}

function parseAdmission(content: string): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor execution Transport admission is not canonical")
  }
  return value
}

function admissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-transport-${key}.json`)
}

function registerValidationReceipt(
  root: string,
  admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  canonicalContent: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  registerReplayDurableParentValidationReceipt({
    registry_root: root,
    parent_kind: "worker_v10_successor_execution_transport_admission",
    parent_key: admission.admission_key,
    parent_self_hash: admission.admission_hash,
    parent_canonical_content: canonicalContent,
  })
  return admission
}
