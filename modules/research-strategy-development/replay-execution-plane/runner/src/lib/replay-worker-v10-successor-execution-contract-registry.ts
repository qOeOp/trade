import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  predecessorExecutionContracts,
  replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContractKey,
  replayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContractKey,
  replayDecisionHarnessWorkerV10SuccessorExecutionContractAdmissionKey,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import {
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  readReplayDurableParentValidationReceipt,
} from "./replay-durable-parent-validation-receipt"

export interface ReplayWorkerV10SuccessorExecutionContractRegistryInput {
  registry_root: string
  source_successor_execution_stdio_probe_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
}

interface ReplayWorkerV10SuccessorExecutionParentSnapshot {
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  file_sha256: string
  cache_key: string
}

const validatedParentCache = new Map<
  string,
  ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
>()

export function readReplayWorkerV10SuccessorExecutionArtifactTransport(
  input: ReplayWorkerV10SuccessorExecutionContractRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract | null {
  const parent = readParentSnapshot(input)
  const transport = readArtifactTransport(input.registry_root, parent.source, parent.file_sha256)
  if (transport) rememberValidatedParent(parent)
  return transport
}

export function readReplayWorkerV10SuccessorExecutionAdmission(
  input: ReplayWorkerV10SuccessorExecutionContractRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract | null {
  const parent = readParentSnapshot(input)
  const transport = readArtifactTransport(input.registry_root, parent.source, parent.file_sha256)
  const execution = transport
    ? readExecutionAdmission(input.registry_root, parent.source, parent.file_sha256, transport)
    : null
  if (execution) rememberValidatedParent(parent)
  return execution
}

export function registerReplayWorkerV10SuccessorExecutionContract(
  input: ReplayWorkerV10SuccessorExecutionContractRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission {
  const parent = readParentSnapshot(input)
  const source = parent.source
  const expectedTransport = buildArtifactTransport(source, parent.file_sha256)
  const expectedExecution = buildExecutionAdmission(source, parent.file_sha256, expectedTransport)
  const expectedAdmission = buildAdmission(source, parent.file_sha256, expectedTransport, expectedExecution)
  const existingAdmission = readAdmission(
    admissionPath(input.registry_root, expectedAdmission.admission_key),
  )
  if (existingAdmission) {
    const durableTransport = readArtifactTransport(input.registry_root, source, parent.file_sha256)
    const durableExecution = durableTransport
      ? readExecutionAdmission(input.registry_root, source, parent.file_sha256, durableTransport)
      : null
    if (!durableTransport || !durableExecution) {
      throw new Error("successor execution Contract retry lost its exact durable child contracts")
    }
    const admission = sameAdmission(existingAdmission,
      buildAdmission(source, parent.file_sha256, durableTransport, durableExecution))
    rememberValidatedParent(parent)
    return admission
  }
  rememberValidatedParent(parent)
  const transport = registerArtifactTransport(input.registry_root, source, parent.file_sha256)
  const execution = registerExecutionAdmission(input.registry_root, source, parent.file_sha256, transport)
  const expected = buildAdmission(source, parent.file_sha256, transport, execution)
  const path = admissionPath(input.registry_root, expected.admission_key)
  const existing = readAdmission(path)
  if (existing) return sameAdmission(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readAdmission(path)
    if (winner) return sameAdmission(winner, expected)
    throw error
  }
  return parseAdmission(content)
}

export function readReplayWorkerV10SuccessorExecutionContract(
  input: ReplayWorkerV10SuccessorExecutionContractRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission | null {
  const parent = readParentSnapshot(input)
  const source = parent.source
  const transport = readArtifactTransport(input.registry_root, source, parent.file_sha256)
  if (!transport) return null
  const execution = readExecutionAdmission(input.registry_root, source, parent.file_sha256, transport)
  if (!execution) return null
  const expected = buildAdmission(source, parent.file_sha256, transport, execution)
  const value = readAdmission(admissionPath(input.registry_root, expected.admission_key))
  if (!value) return null
  const admission = sameAdmission(value, expected)
  rememberValidatedParent(parent)
  return admission
}

function registerArtifactTransport(
  root: string,
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentFileSha256: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract {
  const expected = buildArtifactTransport(source, parentFileSha256)
  const path = artifactTransportPath(root, expected.contract_key)
  const existing = readArtifactTransportFile(path)
  if (existing) return sameArtifactTransport(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readArtifactTransportFile(path)
    if (winner) return sameArtifactTransport(winner, expected)
    throw error
  }
  return parseArtifactTransport(content)
}

function readArtifactTransport(
  root: string,
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentFileSha256: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract | null {
  const expected = buildArtifactTransport(source, parentFileSha256)
  const value = readArtifactTransportFile(artifactTransportPath(root, expected.contract_key))
  return value ? sameArtifactTransport(value, expected) : null
}

function buildArtifactTransport(
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentFileSha256: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract {
  const base = source.source_successor_execution_transport_admission.successor_base_transport_contract
  const stdio = source.successor_stdio_capability
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContractKey({
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    source_successor_base_transport_contract_hash: base.contract_hash,
    source_successor_stdio_capability_hash: stdio.capability_hash,
    source_successor_negative_probe_receipt_hash: source.successor_negative_probe_receipt_hash,
    successor_process_artifact_hash: stdio.artifact.sha256,
    transport_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_SCHEMA_VERSION,
    contract_id: `decision-harness-worker-v10-successor-execution-artifact-transport-${key.slice(0, 24)}`,
    contract_key: key,
    transport_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ARTIFACT_TRANSPORT_POLICY_VERSION,
    scope: "successor_generation_artifact_bound_zero_instance_transport_contract",
    owner: "replay_runner_worker_v10_successor_execution_contract_registry",
    purpose: "bind_exact_successor_stdio_artifact_without_recursive_parent_reembedding_or_activation",
    status: "successor_artifact_bound_transport_frozen_activation_blocked",
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    source_successor_base_transport_contract_hash: base.contract_hash,
    source_successor_stdio_capability_hash: stdio.capability_hash,
    source_successor_negative_probe_receipt_hash: source.successor_negative_probe_receipt_hash,
    source_successor_execution_envelope_hash: base.source_execution_envelope_hash,
    target_logical_request_id: base.target_logical_request_id,
    target_worker_request_hash: base.target_worker_request_hash,
    target_worker_request_execution_admission: base.target_worker_request.execution_admission,
    target_worker_request_transport_status: base.target_worker_request.transport_status,
    successor_process_artifact_hash: stdio.artifact.sha256,
    artifact_binding_policy: "exact_successor_stdio_capability_artifact_hash",
    evidence_binding_policy:
      "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding",
    process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex",
    process_lifecycle: ["spawn_exact_successor_artifact", "write_one_request_frame", "close_stdin",
      "read_one_response_frame", "await_process_exit"],
    request_frame_schema_version: base.request_frame_schema_version,
    response_frame_schema_version: base.response_frame_schema_version,
    request_frame_encoding: base.request_frame_encoding,
    response_frame_encoding: base.response_frame_encoding,
    trailing_bytes_policy: base.trailing_bytes_policy,
    max_request_frame_bytes: base.max_request_frame_bytes,
    max_response_frame_bytes: base.max_response_frame_bytes,
    timeout_ms: base.timeout_ms,
    attempt_id: source.attempt_id,
    attempt_ordinal: source.attempt_ordinal,
    worker_id: source.worker_id,
    lease_generation: source.successor_lease_generation,
    source_negative_probe_process_count: source.successor_negative_probe_process_count,
    worker_request_frame_count: 0,
    worker_request_decode_count: 0,
    worker_process_count: 0,
    blocker_set_policy: "complete_deterministic_ordered_successor_artifact_transport_blockers",
    blockers: ["successor_execution_admission_command_not_issued",
      "successor_current_lease_revalidation_not_materialized", "successor_worker_process_not_materialized",
      "successor_worker_request_frame_write_and_decode_not_materialized",
      "successor_worker_response_frame_read_and_admission_not_materialized"],
    dispatch_occurrence: "not_materialized",
    transport_activation: "blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function registerExecutionAdmission(
  root: string,
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentFileSha256: string,
  transport: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract {
  const expected = buildExecutionAdmission(source, parentFileSha256, transport)
  const path = executionAdmissionPath(root, expected.contract_key)
  const existing = readExecutionAdmissionFile(path)
  if (existing) return sameExecutionAdmission(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readExecutionAdmissionFile(path)
    if (winner) return sameExecutionAdmission(winner, expected)
    throw error
  }
  return parseExecutionAdmission(content)
}

function readExecutionAdmission(
  root: string,
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentFileSha256: string,
  transport: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract | null {
  const expected = buildExecutionAdmission(source, parentFileSha256, transport)
  const value = readExecutionAdmissionFile(executionAdmissionPath(root, expected.contract_key))
  return value ? sameExecutionAdmission(value, expected) : null
}

function buildExecutionAdmission(
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentFileSha256: string,
  transport: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract {
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContractKey({
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    source_artifact_bound_transport_contract_hash: transport.contract_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_CONTRACT_SCHEMA_VERSION,
    contract_id: `decision-harness-worker-v10-successor-execution-admission-${key.slice(0, 24)}`,
    contract_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_POLICY_VERSION,
    scope: "successor_generation_zero_instance_execution_admission_contract",
    owner: "replay_runner_worker_v10_successor_execution_contract_registry",
    purpose: "freeze_future_attempt_bound_command_model_without_issuing_command",
    status: "successor_execution_authority_model_frozen_command_not_issued",
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    source_artifact_bound_transport_contract_hash: transport.contract_hash,
    target_logical_request_id: transport.target_logical_request_id,
    target_worker_request_hash: transport.target_worker_request_hash,
    target_worker_request_execution_admission: transport.target_worker_request_execution_admission,
    target_worker_request_transport_status: transport.target_worker_request_transport_status,
    attempt_id: source.attempt_id,
    attempt_ordinal: source.attempt_ordinal,
    worker_id: source.worker_id,
    lease_generation: source.successor_lease_generation,
    execution_authority_model: "separate_attempt_bound_execution_admission_command",
    command_identity_policy:
      "hash_exact_request_attempt_generation_claim_lease_observation_process_artifact_and_transport_policy",
    command_reuse_policy: "forbidden_across_attempt_or_lease_generation",
    future_command_required_bindings: ["worker_request_hash", "logical_request_id", "attempt_id",
      "attempt_ordinal", "worker_id", "lease_generation", "dispatch_claim_hash",
      "current_lease_observation_hash", "successor_process_artifact_hash", "transport_contract_hash"],
    evidence_binding_policy:
      "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding",
    admission_command_instance_count: 0,
    worker_process_count: 0,
    request_frame_instance_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    blocker_set_policy: "complete_deterministic_ordered_successor_execution_admission_blockers",
    blockers: ["successor_exact_durable_dispatch_claim_not_bound",
      "successor_control_plane_registry_read_provenance_not_materialized",
      "successor_independent_dispatch_clock_attestation_not_materialized",
      "successor_current_lease_revalidation_for_command_not_materialized",
      "successor_execution_admission_command_not_issued"],
    transport_activation: "blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function buildAdmission(
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentFileSha256: string,
  transport: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  execution: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission {
  const predecessor = predecessorExecutionContracts(source)
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionContractAdmissionKey({
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    successor_artifact_bound_transport_contract_hash: transport.contract_hash,
    successor_execution_admission_contract_hash: execution.contract_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_SCHEMA_VERSION,
    admission_id: `decision-harness-worker-v10-successor-execution-contract-${key.slice(0, 24)}`,
    admission_ref:
      `admission://replay-decision-harness-worker-v10-successor-execution-contract/${key.slice(0, 24)}`,
    admission_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_CONTRACT_ADMISSION_POLICY_VERSION,
    scope: "one_successor_artifact_bound_transport_and_zero_instance_execution_admission_contract",
    owner: "replay_runner_worker_v10_successor_execution_contract_registry",
    purpose: "rebuild_envelope_bound_execution_contracts_without_issuing_command_or_starting_worker",
    status: "successor_execution_contracts_admitted_command_not_issued",
    source_successor_execution_stdio_probe_admission_hash: source.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    source_predecessor_artifact_bound_transport_contract_hash: predecessor.transport.contract_hash,
    source_predecessor_execution_admission_contract_hash: predecessor.execution.contract_hash,
    successor_artifact_bound_transport_contract_hash: transport.contract_hash,
    successor_artifact_bound_transport_contract: structuredClone(transport),
    successor_execution_admission_contract_hash: execution.contract_hash,
    successor_execution_admission_contract: structuredClone(execution),
    successor_base_transport_contract_hash:
      source.source_successor_execution_transport_admission.successor_base_transport_contract_hash,
    successor_stdio_capability_hash: source.successor_stdio_capability_hash,
    successor_negative_probe_receipt_hash: source.successor_negative_probe_receipt_hash,
    successor_execution_envelope_hash:
      source.source_successor_execution_transport_admission.successor_base_transport_contract
        .source_execution_envelope_hash,
    successor_process_artifact_hash: transport.successor_process_artifact_hash,
    target_logical_request_id: transport.target_logical_request_id,
    target_worker_request_hash: transport.target_worker_request_hash,
    target_worker_request_execution_admission: transport.target_worker_request_execution_admission,
    target_worker_request_transport_status: transport.target_worker_request_transport_status,
    attempt_id: source.attempt_id,
    attempt_ordinal: source.attempt_ordinal,
    worker_id: source.worker_id,
    predecessor_lease_generation: source.predecessor_lease_generation,
    successor_lease_generation: source.successor_lease_generation,
    artifact_transport_identity_policy:
      "fresh_identity_per_exact_envelope_stdio_capability_and_negative_probe_receipt",
    artifact_byte_parity_policy:
      "identical_process_artifact_hash_does_not_permit_transport_contract_identity_reuse",
    execution_admission_identity_policy: "fresh_identity_per_exact_artifact_bound_transport_contract",
    request_marker_policy: "worker_request_v10_remains_not_granted_and_not_invoked",
    command_issue_policy: "separate_future_attempt_bound_command_required",
    evidence_binding_policy:
      "exact_durable_local_cas_hash_references_without_recursive_lineage_reembedding",
    parent_validation_policy:
      "durable_parent_validation_receipt_binds_self_hash_and_canonical_file_sha256",
    registry_durability: "replay_local_immutable_cas_regular_file_canonical_json",
    successor_base_transport_contract_count: 1,
    successor_stdio_capability_count: 1,
    successor_negative_probe_receipt_count: 1,
    successor_negative_probe_process_count: 5,
    successor_artifact_bound_transport_contract_count: 1,
    successor_execution_admission_contract_count: 1,
    successor_execution_admission_command_count: 0,
    successor_process_launch_intent_count: 0,
    successor_authority_capsule_count: 0,
    successor_spawn_revalidation_count: 0,
    successor_worker_process_count: 0,
    successor_worker_request_frame_count: 0,
    successor_worker_request_decode_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    transport_authority: "artifact_bound_contract_frozen_activation_blocked",
    command_authority: "contract_frozen_zero_instance_not_issued",
    worker_process_authority: "none",
    blockers: [
      "successor_command_intent_capsule_revalidation_and_worker_process_not_materialized",
      "second_distinct_fresh_worker_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_and_harness_receipt_not_materialized",
    ],
    decision_output_authority:
      "first_schedule_matched_claim_only_successor_execution_contracts_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function readParentSnapshot(
  input: ReplayWorkerV10SuccessorExecutionContractRegistryInput,
): ReplayWorkerV10SuccessorExecutionParentSnapshot {
  requireReferenceInput(input)
  const expected = input.source_successor_execution_stdio_probe_admission
  const path = join(resolve(input.registry_root),
    `worker-v10-successor-execution-stdio-probe-${expected.admission_key}.json`)
  if (!existsSync(path)) {
    throw new Error("successor execution Contract requires its durable R4.146 parent reference")
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Contract R4.146 parent reference must be a regular file")
  }
  const content = readFileSync(path, "utf8")
  const fileSha256 = sha256(content)
  const receipt = readReplayDurableParentValidationReceipt({
    registry_root: input.registry_root,
    parent_kind: "worker_v10_successor_execution_stdio_probe_admission",
    parent_key: expected.admission_key,
  })
  if (!receipt || receipt.parent_self_hash !== expected.admission_hash
      || receipt.parent_canonical_file_sha256 !== fileSha256) {
    throw new Error("successor execution Contract requires an exact durable parent validation receipt")
  }
  const cacheKey = `${path}\u0000${fileSha256}`
  const cached = validatedParentCache.get(cacheKey)
  if (cached) {
    if (cached.admission_key !== expected.admission_key
        || cached.admission_hash !== expected.admission_hash) {
      throw new Error("successor execution Contract R4.146 cached parent key or hash drift")
    }
    return { source: cached, file_sha256: fileSha256, cache_key: cacheKey }
  }
  const durable = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  if (durable.admission_key !== expected.admission_key || durable.admission_hash !== expected.admission_hash) {
    throw new Error("successor execution Contract R4.146 direct parent key or hash drift")
  }
  return { source: durable, file_sha256: fileSha256, cache_key: cacheKey }
}

function rememberValidatedParent(parent: ReplayWorkerV10SuccessorExecutionParentSnapshot): void {
  validatedParentCache.clear()
  validatedParentCache.set(parent.cache_key, parent.source)
}

function requireReferenceInput(input: ReplayWorkerV10SuccessorExecutionContractRegistryInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("successor execution Contract registry root is required")
  }
  const source = input.source_successor_execution_stdio_probe_admission
  if (typeof source?.admission_key !== "string" || !/^[a-f0-9]{64}$/.test(source.admission_key)
      || typeof source.admission_hash !== "string" || !/^[a-f0-9]{64}$/.test(source.admission_hash)) {
    throw new Error("successor execution Contract R4.146 parent reference is invalid")
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function sameAdmission(
  existing: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor execution Contract admission natural key has different evidence")
  }
  return existing
}

function readAdmission(
  path: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Contract admission must be a regular file")
  }
  return parseAdmission(readFileSync(path, "utf8"))
}

function parseAdmission(content: string): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor execution Contract admission is not canonical")
  }
  return value
}

function sameArtifactTransport(
  existing: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor execution artifact Transport natural key has different evidence")
  }
  return existing
}

function readArtifactTransportFile(
  path: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution artifact Transport must be a regular file")
  }
  return parseArtifactTransport(readFileSync(path, "utf8"))
}

function parseArtifactTransport(
  content: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor execution artifact Transport is not canonical")
  }
  return value
}

function sameExecutionAdmission(
  existing: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor Execution Admission natural key has different evidence")
  }
  return existing
}

function readExecutionAdmissionFile(
  path: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor Execution Admission must be a regular file")
  }
  return parseExecutionAdmission(readFileSync(path, "utf8"))
}

function parseExecutionAdmission(
  content: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor Execution Admission is not canonical")
  }
  return value
}

function admissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-contract-${key}.json`)
}

function artifactTransportPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-artifact-transport-${key}.json`)
}

function executionAdmissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-admission-${key}.json`)
}
