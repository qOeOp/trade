import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  replayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmissionKey,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import type {
  ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import {
  type ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  type ReplayDecisionHarnessWorkerV10StdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  type ReplayWorkerV10NegativeProbeClock,
  readReplayWorkerV10NegativeProbeReceipt,
  runReplayWorkerV10NegativeProbeSuite,
} from "./replay-worker-v10-negative-probe-registry"
import {
  readReplayWorkerV10StdioCapability,
  registerReplayWorkerV10StdioCapability,
} from "./replay-worker-v10-stdio-capability-registry"
import {
  readReplayDurableParentValidationReceipt,
  registerReplayDurableParentValidationReceipt,
} from "./replay-durable-parent-validation-receipt"

export interface RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput {
  registry_root: string
  source_successor_execution_transport_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission
  clock?: ReplayWorkerV10NegativeProbeClock
}

export function registerReplayWorkerV10SuccessorExecutionStdioProbe(
  input: RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission {
  const transportAdmission = requireDurableParent(input)
  const predecessor = extractPredecessorEvidence(transportAdmission)
  const successor = registerReplayWorkerV10StdioCapability({
    registry_root: input.registry_root,
    source_transport_contract: transportAdmission.successor_base_transport_contract,
  })
  const probe = runReplayWorkerV10NegativeProbeSuite({
    registry_root: input.registry_root,
    source_stdio_capability: successor,
    clock: input.clock,
  })
  const expected = buildAdmission(transportAdmission, predecessor, successor, probe)
  const path = admissionPath(input.registry_root, expected.admission_key)
  const existing = readAdmission(path)
  if (existing) {
    const admission = sameAdmission(existing, expected)
    registerParentValidationReceipt(input.registry_root, admission, `${canonicalJson(admission)}\n`)
    return admission
  }
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readAdmission(path)
    if (winner) {
      const admission = sameAdmission(winner, expected)
      registerParentValidationReceipt(input.registry_root, admission, `${canonicalJson(admission)}\n`)
      return admission
    }
    throw error
  }
  const admission = parseAdmission(content)
  registerParentValidationReceipt(input.registry_root, admission, content)
  return admission
}

export function readReplayWorkerV10SuccessorExecutionStdioProbe(
  input: Omit<RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput, "clock">,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission | null {
  const transportAdmission = requireDurableParent(input)
  const predecessor = extractPredecessorEvidence(transportAdmission)
  const successor = readReplayWorkerV10StdioCapability({
    registry_root: input.registry_root,
    source_transport_contract: transportAdmission.successor_base_transport_contract,
  })
  if (!successor) return null
  const probe = readReplayWorkerV10NegativeProbeReceipt({
    registry_root: input.registry_root,
    source_stdio_capability: successor,
  })
  if (!probe) return null
  const expected = buildAdmission(transportAdmission, predecessor, successor, probe)
  const value = readAdmission(admissionPath(input.registry_root, expected.admission_key))
  return value ? sameAdmission(value, expected) : null
}

function buildAdmission(
  transportAdmission: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  predecessor: {
    stdio_capability_hash: string
    transport_contract_hash: string
    execution_contract_hash: string
  },
  successor: ReplayDecisionHarnessWorkerV10StdioCapability,
  probe: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission {
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmissionKey({
    source_successor_execution_transport_admission_hash: transportAdmission.admission_hash,
    successor_stdio_capability_hash: successor.capability_hash,
    successor_negative_probe_receipt_hash: probe.receipt_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_SCHEMA_VERSION,
    admission_id: `decision-harness-worker-v10-successor-stdio-probe-${key.slice(0, 24)}`,
    admission_ref:
      `admission://replay-decision-harness-worker-v10-successor-stdio-probe/${key.slice(0, 24)}`,
    admission_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION,
    scope: "one_successor_base_transport_bound_stdio_capability_and_negative_probe_receipt",
    owner: "replay_runner_worker_v10_successor_execution_stdio_probe_registry",
    purpose: "rebuild_transport_bound_stdio_identity_and_certify_non_request_rejections",
    status: "successor_stdio_and_negative_probe_admitted_execution_contract_not_materialized",
    source_successor_execution_transport_admission_hash: transportAdmission.admission_hash,
    source_successor_base_transport_contract_hash:
      transportAdmission.successor_base_transport_contract_hash,
    source_successor_execution_envelope_hash:
      transportAdmission.successor_base_transport_contract.source_execution_envelope_hash,
    source_predecessor_artifact_bound_transport_contract_hash: predecessor.transport_contract_hash,
    source_predecessor_execution_admission_contract_hash: predecessor.execution_contract_hash,
    source_predecessor_stdio_capability_hash: predecessor.stdio_capability_hash,
    successor_stdio_capability_hash: successor.capability_hash,
    successor_stdio_artifact_evidence: {
      capability_id: successor.capability_id,
      capability_hash: successor.capability_hash,
      source_transport_contract_hash: successor.source_transport_contract_hash,
      runtime: structuredClone(successor.runtime),
      artifact: structuredClone(successor.artifact),
    },
    successor_negative_probe_receipt_hash: probe.receipt_hash,
    successor_process_artifact_hash: successor.artifact.sha256,
    target_logical_request_id: successor.source_transport_contract.target_logical_request_id,
    target_worker_request_hash: successor.source_transport_contract.target_worker_request_hash,
    target_worker_request_execution_admission:
      successor.source_transport_contract.target_worker_request.execution_admission,
    target_worker_request_transport_status:
      successor.source_transport_contract.target_worker_request.transport_status,
    request_frame_schema_version: successor.source_transport_contract.request_frame_schema_version,
    response_frame_schema_version: successor.source_transport_contract.response_frame_schema_version,
    request_frame_encoding: successor.source_transport_contract.request_frame_encoding,
    response_frame_encoding: successor.source_transport_contract.response_frame_encoding,
    trailing_bytes_policy: successor.source_transport_contract.trailing_bytes_policy,
    max_request_frame_bytes: successor.source_transport_contract.max_request_frame_bytes,
    max_response_frame_bytes: successor.source_transport_contract.max_response_frame_bytes,
    timeout_ms: successor.source_transport_contract.timeout_ms,
    attempt_id: transportAdmission.attempt_id,
    attempt_ordinal: transportAdmission.attempt_ordinal,
    worker_id: transportAdmission.worker_id,
    predecessor_lease_generation: transportAdmission.predecessor_lease_generation,
    successor_lease_generation: transportAdmission.successor_lease_generation,
    capability_identity_policy: "fresh_capability_identity_per_exact_base_transport_contract",
    artifact_parity_policy: "identical_bytes_allowed_only_as_rebuild_evidence_not_identity_reuse",
    artifact_parity_status: "successor_rebuild_byte_identical_to_predecessor_stdio_artifact",
    probe_identity_policy: "fresh_receipt_bound_to_successor_capability_hash",
    probe_execution_class: "non_worker_request_malformed_input_processes_only",
    evidence_binding_policy: "content_addressed_parent_hashes_without_recursive_reembedding",
    registry_durability: "replay_local_immutable_cas_regular_file_canonical_json",
    successor_base_transport_contract_count: 1,
    successor_stdio_capability_count: 1,
    successor_negative_probe_receipt_count: 1,
    successor_negative_probe_process_count: 5,
    successor_worker_request_frame_count: 0,
    successor_worker_request_decode_count: 0,
    successor_artifact_bound_transport_contract_count: 0,
    successor_execution_admission_contract_count: 0,
    successor_execution_admission_command_count: 0,
    successor_process_launch_intent_count: 0,
    successor_authority_capsule_count: 0,
    successor_spawn_revalidation_count: 0,
    successor_worker_process_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    transport_authority: "stdio_artifact_certified_activation_not_granted",
    command_authority: "none",
    worker_process_authority: "none",
    blockers: [
      "successor_artifact_bound_transport_and_execution_admission_contract_not_materialized",
      "successor_command_intent_capsule_revalidation_and_worker_process_not_materialized",
      "second_distinct_fresh_worker_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_and_harness_receipt_not_materialized",
    ],
    decision_output_authority: "first_schedule_matched_claim_only_successor_stdio_probe_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function extractPredecessorEvidence(
  transportAdmission: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
): {
  stdio_capability_hash: string
  transport_contract_hash: string
  execution_contract_hash: string
} {
  const pair = transportAdmission.source_successor_execution_envelope_admission
    .source_successor_lease_admission.source_successor_authority_contract
    .source_reproducibility_pair_contract
  const launch = pair.source_schedule_admission.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.source_process_launch_receipt
  const command = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
    .source_authority_process_launch_intent.source_authority_execution_admission_command
  const predecessorCommand = command.source_authority_transport_contract.source_activated_stdio_capability
    .source_authority_frame_build_contract.source_launch_readiness_gate.source_process_launch_intent
    .source_execution_admission_command
  const execution = predecessorCommand.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract
  const transport = execution.source_successor_transport_contract
  const capability = transport.source_negative_probe_receipt.source_stdio_capability
  if (capability.source_transport_contract_hash
      !== transportAdmission.source_predecessor_transport_contract_hash) {
    throw new Error("successor execution Stdio Probe does not embed its exact predecessor capability")
  }
  return {
    stdio_capability_hash: capability.capability_hash,
    transport_contract_hash: transport.contract_hash,
    execution_contract_hash: execution.contract_hash,
  }
}

function requireDurableParent(
  input: Omit<RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput, "clock">,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  requireReferenceInput(input)
  const expected = input.source_successor_execution_transport_admission
  const path = join(resolve(input.registry_root),
    `worker-v10-successor-execution-transport-${expected.admission_key}.json`)
  if (!existsSync(path)) {
    throw new Error("successor execution Stdio Probe requires the exact durable R4.145 Transport Admission")
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Stdio Probe R4.145 parent must be a regular file")
  }
  const content = readFileSync(path, "utf8")
  const receipt = readReplayDurableParentValidationReceipt({
    registry_root: input.registry_root,
    parent_kind: "worker_v10_successor_execution_transport_admission",
    parent_key: expected.admission_key,
  })
  if (!receipt || receipt.parent_self_hash !== expected.admission_hash
      || receipt.parent_canonical_file_sha256 !== sha256(content)) {
    throw new Error("successor execution Stdio Probe requires the exact durable R4.145 Transport Admission")
  }
  const durable = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission
  if (durable.admission_key !== expected.admission_key || durable.admission_hash !== expected.admission_hash) {
    throw new Error("successor execution Stdio Probe R4.145 parent reference drift")
  }
  return durable
}

function requireReferenceInput(
  input: Omit<RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput, "clock">,
): void {
  if (input.registry_root.trim() === "") {
    throw new Error("successor execution Stdio Probe registry root is required")
  }
  const source = input.source_successor_execution_transport_admission
  if (typeof source?.admission_key !== "string" || !/^[a-f0-9]{64}$/.test(source.admission_key)
      || typeof source.admission_hash !== "string" || !/^[a-f0-9]{64}$/.test(source.admission_hash)) {
    throw new Error("successor execution Stdio Probe R4.145 parent reference is invalid")
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function sameAdmission(
  existing: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor execution Stdio Probe admission natural key has different evidence")
  }
  return existing
}

function readAdmission(
  path: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Stdio Probe admission must be a regular file")
  }
  return parseAdmission(readFileSync(path, "utf8"))
}

function parseAdmission(content: string): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor execution Stdio Probe admission is not canonical")
  }
  return value
}

function admissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-stdio-probe-${key}.json`)
}

function registerParentValidationReceipt(
  root: string,
  admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  canonicalContent: string,
): void {
  registerReplayDurableParentValidationReceipt({
    registry_root: root,
    parent_kind: "worker_v10_successor_execution_stdio_probe_admission",
    parent_key: admission.admission_key,
    parent_self_hash: admission.admission_hash,
    parent_canonical_content: canonicalContent,
  })
}
