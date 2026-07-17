import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_TRANSPORT_ACTIVATION_GATE_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_TRANSPORT_ACTIVATION_GATE_SCHEMA_VERSION,
  assertReplayDecisionHarnessTransportActivationGate,
  createReplayDecisionHarnessTransportActivationGate,
  replayDecisionHarnessTransportActivationBlockers,
  replayDecisionHarnessTransportActivationGateKey,
  type ReplayDecisionHarnessTransportActivationGate,
} from "../../../contracts/src/lib/replay-decision-harness-transport-activation"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-logical-request-identity-upgrade"
import {
  assertReplayDecisionHarnessProcessLaunchReceipt,
  type ReplayDecisionHarnessProcessLaunchReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-process-launch"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { readReplayProcessLaunchReceipt } from "./replay-process-launch-registry"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"

export interface RegisterReplayTransportActivationGateInput {
  registry_root: string
  source_process_launch_receipt: ReplayDecisionHarnessProcessLaunchReceipt
}

export interface ReadReplayTransportActivationGateInput {
  registry_root: string
  source_process_launch_receipt: ReplayDecisionHarnessProcessLaunchReceipt
}

export function registerReplayTransportActivationGate(
  input: RegisterReplayTransportActivationGateInput,
): ReplayDecisionHarnessTransportActivationGate {
  assertReplayDecisionHarnessProcessLaunchReceipt(input.source_process_launch_receipt)
  requireRoot(input.registry_root)
  const receipt = input.source_process_launch_receipt
  const persistedReceipt = readReplayProcessLaunchReceipt(keyInput(input.registry_root, receipt))
  if (!persistedReceipt || persistedReceipt.process_launch_receipt_hash !== receipt.process_launch_receipt_hash) {
    throw new Error("Replay Transport Activation requires the exact durable Process Launch Receipt")
  }
  const gate = buildGate(receipt)
  const path = gatePath(input.registry_root, gate.gate_key)
  const existing = readGate(path)
  if (existing) return assertCreateOrIdentical(existing, receipt)
  const content = `${canonicalJson(gate)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readGate(path)
    if (winner) return assertCreateOrIdentical(winner, receipt)
    throw error
  }
  return parseGate(content)
}

export function readReplayTransportActivationGate(
  input: ReadReplayTransportActivationGateInput,
): ReplayDecisionHarnessTransportActivationGate | null {
  assertReplayDecisionHarnessProcessLaunchReceipt(input.source_process_launch_receipt)
  requireRoot(input.registry_root)
  const receipt = input.source_process_launch_receipt
  const gateKey = replayDecisionHarnessTransportActivationGateKey({
    dispatch_registry_key: receipt.registry_key,
    process_launch_receipt_hash: receipt.process_launch_receipt_hash,
    target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  })
  const gate = readGate(gatePath(input.registry_root, gateKey))
  if (!gate) return null
  const persistedReceipt = readReplayProcessLaunchReceipt(keyInput(input.registry_root, receipt))
  if (!persistedReceipt || persistedReceipt.process_launch_receipt_hash !== gate.source_process_launch_receipt_hash) {
    throw new Error("Replay Transport Activation Gate lost its durable Process Launch Receipt")
  }
  return assertCreateOrIdentical(gate, receipt)
}

function buildGate(
  receipt: ReplayDecisionHarnessProcessLaunchReceipt,
): ReplayDecisionHarnessTransportActivationGate {
  const claim = receipt.source_process_launch_attempt.source_claim
  const envelope = claim.source_registration.source_authority_binding
    .source_dispatch_lease_admission.source_execution_envelope
  const responseContract = envelope.source_response_contract
  const request = responseContract.source_request_materialization.requests
    .find((item) => item.logical_request_id === envelope.logical_request_id)
  if (!request) throw new Error("Replay Transport Activation target Request is missing")
  const build = responseContract.source_request_materialization.source_identity_upgrade
    .source_invocation_identity_set.code_admission.registry_entry.build_attestation
  const gateKey = replayDecisionHarnessTransportActivationGateKey({
    dispatch_registry_key: receipt.registry_key,
    process_launch_receipt_hash: receipt.process_launch_receipt_hash,
    target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  })
  return createReplayDecisionHarnessTransportActivationGate({
    schema_version: REPLAY_DECISION_HARNESS_TRANSPORT_ACTIVATION_GATE_SCHEMA_VERSION,
    gate_id: `decision-harness-transport-activation-${gateKey.slice(0, 24)}`,
    gate_key: gateKey,
    gate_policy_version: REPLAY_DECISION_HARNESS_TRANSPORT_ACTIVATION_GATE_POLICY_VERSION,
    scope: "pre_transport_protocol_and_process_activation_gate",
    owner: "replay_runner_transport_activation_registry",
    purpose: "block_worker_request_write_until_attested_artifact_protocol_and_live_process_semantics_match_target",
    status: "blocked",
    source_process_launch_receipt_id: receipt.process_launch_receipt_id,
    source_process_launch_receipt_hash: receipt.process_launch_receipt_hash,
    source_process_launch_receipt: structuredClone(receipt),
    source_dispatch_claim_hash: claim.claim_hash,
    source_execution_envelope_hash: envelope.envelope_hash,
    target_worker_request_id: request.logical_request_id,
    target_worker_request_hash: request.request_hash,
    target_worker_request: structuredClone(request),
    target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
    attested_artifact_worker_protocol_version: build.worker_protocol_version,
    attested_build_hash: build.attestation_hash,
    attested_artifact_hash: build.artifact.sha256,
    protocol_relation: "incompatible_v9_artifact_v10_request",
    request_contract_execution_admission: "not_granted",
    request_contract_transport_status: "not_invoked",
    process_reuse_policy: "completed_probe_process_is_not_a_live_dispatch_process",
    compatibility_projection_policy: "forbidden_no_silent_v10_to_v9_request_projection",
    activation_status: "denied",
    blockers: replayDecisionHarnessTransportActivationBlockers(receipt),
    blocker_set_policy: "complete_deterministic_ordered_blocker_set",
    successor_policy: "new_versioned_capability_and_process_evidence_requires_new_gate_key",
    transport_frame_design_status: "not_designed_by_this_gate",
    transport_frame_instance_count: 0,
    transport_frame_instances: [],
    request_write_receipt_count: 0,
    request_write_receipts: [],
    dispatch_occurrence: "not_materialized",
    worker_request_write: "forbidden",
    harness_invocation: "forbidden",
    response_instance: null,
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function assertCreateOrIdentical(
  existing: ReplayDecisionHarnessTransportActivationGate,
  receipt: ReplayDecisionHarnessProcessLaunchReceipt,
): ReplayDecisionHarnessTransportActivationGate {
  if (existing.source_process_launch_receipt_hash !== receipt.process_launch_receipt_hash) {
    throw new Error("Replay Transport Activation gate key is already registered with different evidence")
  }
  return existing
}

function keyInput(root: string, receipt: ReplayDecisionHarnessProcessLaunchReceipt) {
  const claim = receipt.source_process_launch_attempt.source_claim
  return {
    registry_root: root,
    attempt_id: claim.attempt_id,
    lease_generation: claim.lease_generation,
    logical_request_id: claim.logical_request_id,
  }
}

function readGate(path: string): ReplayDecisionHarnessTransportActivationGate | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Replay Transport Activation registry entry must be a regular file")
  }
  return parseGate(readFileSync(path, "utf8"))
}

function parseGate(content: string): ReplayDecisionHarnessTransportActivationGate {
  const value = JSON.parse(content) as ReplayDecisionHarnessTransportActivationGate
  assertReplayDecisionHarnessTransportActivationGate(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Transport Activation registry entry is not canonical")
  }
  return value
}

function gatePath(root: string, gateKey: string): string {
  return join(resolve(root), `transport-activation-${gateKey}.json`)
}

function requireRoot(root: string): void {
  if (root.trim() === "") throw new Error("Replay Transport Activation registry root is required")
}
