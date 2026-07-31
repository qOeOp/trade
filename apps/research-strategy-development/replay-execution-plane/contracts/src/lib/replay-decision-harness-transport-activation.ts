import {
  REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
  canonicalHash,
  canonicalJson,
} from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
} from "./replay-decision-harness-logical-request-identity-upgrade"
import {
  assertReplayDecisionHarnessProcessLaunchReceipt,
  type ReplayDecisionHarnessProcessLaunchReceipt,
} from "./replay-decision-harness-process-launch"
import {
  assertReplayDecisionHarnessWorkerRequestV10,
  type ReplayDecisionHarnessWorkerRequestV10,
} from "./replay-decision-harness-worker-request-v10"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_TRANSPORT_ACTIVATION_GATE_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-transport-activation-gate.v1" as const
export const REPLAY_DECISION_HARNESS_TRANSPORT_ACTIVATION_GATE_POLICY_VERSION =
  "rd-replay-decision-harness-transport-activation-gate-v1" as const

export type ReplayDecisionHarnessTransportActivationBlocker =
  | "attested_artifact_worker_protocol_v9_target_request_protocol_v10_mismatch"
  | "source_process_launch_receipt_is_terminal_probe_not_reusable_worker_process"
  | "source_process_launch_not_observed"
  | "target_worker_request_execution_admission_not_granted"
  | "target_worker_request_transport_status_not_invoked"

export interface ReplayDecisionHarnessTransportActivationGate {
  schema_version: typeof REPLAY_DECISION_HARNESS_TRANSPORT_ACTIVATION_GATE_SCHEMA_VERSION
  gate_id: string
  gate_hash: string
  gate_key: string
  gate_policy_version: typeof REPLAY_DECISION_HARNESS_TRANSPORT_ACTIVATION_GATE_POLICY_VERSION
  scope: "pre_transport_protocol_and_process_activation_gate"
  owner: "replay_runner_transport_activation_registry"
  purpose: "block_worker_request_write_until_attested_artifact_protocol_and_live_process_semantics_match_target"
  status: "blocked"
  source_process_launch_receipt_id: string
  source_process_launch_receipt_hash: string
  source_process_launch_receipt: ReplayDecisionHarnessProcessLaunchReceipt
  source_dispatch_claim_hash: string
  source_execution_envelope_hash: string
  target_worker_request_id: string
  target_worker_request_hash: string
  target_worker_request: ReplayDecisionHarnessWorkerRequestV10
  target_worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  attested_artifact_worker_protocol_version: typeof REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
  attested_build_hash: string
  attested_artifact_hash: string
  protocol_relation: "incompatible_v9_artifact_v10_request"
  request_contract_execution_admission: "not_granted"
  request_contract_transport_status: "not_invoked"
  process_reuse_policy: "completed_probe_process_is_not_a_live_dispatch_process"
  compatibility_projection_policy: "forbidden_no_silent_v10_to_v9_request_projection"
  activation_status: "denied"
  blockers: ReplayDecisionHarnessTransportActivationBlocker[]
  blocker_set_policy: "complete_deterministic_ordered_blocker_set"
  successor_policy: "new_versioned_capability_and_process_evidence_requires_new_gate_key"
  transport_frame_design_status: "not_designed_by_this_gate"
  transport_frame_instance_count: 0
  transport_frame_instances: []
  request_write_receipt_count: 0
  request_write_receipts: []
  dispatch_occurrence: "not_materialized"
  worker_request_write: "forbidden"
  harness_invocation: "forbidden"
  response_instance: null
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessTransportActivationGateBody = Omit<
  ReplayDecisionHarnessTransportActivationGate,
  "gate_hash"
>

export function replayDecisionHarnessTransportActivationGateKey(input: {
  dispatch_registry_key: string
  process_launch_receipt_hash: string
  target_worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
}): string {
  requireHash(input.dispatch_registry_key, "decision harness Transport Activation dispatch registry key")
  requireHash(input.process_launch_receipt_hash, "decision harness Transport Activation Process Receipt hash")
  if (input.target_worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION) {
    throw new Error("decision harness Transport Activation target worker protocol is unsupported")
  }
  return canonicalHash(input)
}

export function replayDecisionHarnessTransportActivationBlockers(
  receipt: ReplayDecisionHarnessProcessLaunchReceipt,
): ReplayDecisionHarnessTransportActivationBlocker[] {
  assertReplayDecisionHarnessProcessLaunchReceipt(receipt)
  const blockers: ReplayDecisionHarnessTransportActivationBlocker[] = [
    "attested_artifact_worker_protocol_v9_target_request_protocol_v10_mismatch",
    "source_process_launch_receipt_is_terminal_probe_not_reusable_worker_process",
  ]
  if (receipt.process_launch_occurrence !== "runner_observed_child_started") {
    blockers.push("source_process_launch_not_observed")
  }
  blockers.push(
    "target_worker_request_execution_admission_not_granted",
    "target_worker_request_transport_status_not_invoked",
  )
  return blockers
}

export function createReplayDecisionHarnessTransportActivationGate(
  body: ReplayDecisionHarnessTransportActivationGateBody,
): ReplayDecisionHarnessTransportActivationGate {
  const value = { ...structuredClone(body), gate_hash: canonicalHash(body) }
  assertReplayDecisionHarnessTransportActivationGate(value)
  return value
}

export function assertReplayDecisionHarnessTransportActivationGate(
  value: ReplayDecisionHarnessTransportActivationGate,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_TRANSPORT_ACTIVATION_GATE_SCHEMA_VERSION
      || value.gate_policy_version !== REPLAY_DECISION_HARNESS_TRANSPORT_ACTIVATION_GATE_POLICY_VERSION
      || value.scope !== "pre_transport_protocol_and_process_activation_gate"
      || value.owner !== "replay_runner_transport_activation_registry"
      || value.purpose
        !== "block_worker_request_write_until_attested_artifact_protocol_and_live_process_semantics_match_target"
      || value.status !== "blocked" || value.protocol_relation !== "incompatible_v9_artifact_v10_request"
      || value.target_worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.attested_artifact_worker_protocol_version !== REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
      || value.request_contract_execution_admission !== "not_granted"
      || value.request_contract_transport_status !== "not_invoked"
      || value.process_reuse_policy !== "completed_probe_process_is_not_a_live_dispatch_process"
      || value.compatibility_projection_policy !== "forbidden_no_silent_v10_to_v9_request_projection"
      || value.activation_status !== "denied"
      || value.blocker_set_policy !== "complete_deterministic_ordered_blocker_set"
      || value.successor_policy !== "new_versioned_capability_and_process_evidence_requires_new_gate_key"
      || value.transport_frame_design_status !== "not_designed_by_this_gate"
      || value.transport_frame_instance_count !== 0 || value.transport_frame_instances.length !== 0
      || value.request_write_receipt_count !== 0 || value.request_write_receipts.length !== 0
      || value.dispatch_occurrence !== "not_materialized" || value.worker_request_write !== "forbidden"
      || value.harness_invocation !== "forbidden" || value.response_instance !== null
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Transport Activation authority")
  }
  for (const item of [value.gate_id, value.source_process_launch_receipt_id,
    value.target_worker_request_id]) {
    requireText(item, "decision harness Transport Activation identity")
  }
  for (const item of [value.gate_hash, value.gate_key, value.source_process_launch_receipt_hash,
    value.source_dispatch_claim_hash, value.source_execution_envelope_hash,
    value.target_worker_request_hash, value.attested_build_hash, value.attested_artifact_hash]) {
    requireHash(item, "decision harness Transport Activation hash")
  }
  assertReplayDecisionHarnessProcessLaunchReceipt(value.source_process_launch_receipt)
  assertReplayDecisionHarnessWorkerRequestV10(value.target_worker_request)
  const receipt = value.source_process_launch_receipt
  const claim = receipt.source_process_launch_attempt.source_claim
  const envelope = claim.source_registration.source_authority_binding
    .source_dispatch_lease_admission.source_execution_envelope
  const responseContract = envelope.source_response_contract
  const request = responseContract.source_request_materialization.requests
    .find((item) => item.logical_request_id === envelope.logical_request_id)
  const codeAdmission = responseContract.source_request_materialization.source_identity_upgrade
    .source_invocation_identity_set.code_admission
  const build = codeAdmission.registry_entry.build_attestation
  const expectedKey = replayDecisionHarnessTransportActivationGateKey({
    dispatch_registry_key: receipt.registry_key,
    process_launch_receipt_hash: receipt.process_launch_receipt_hash,
    target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  })
  if (!request || value.gate_key !== expectedKey
      || value.source_process_launch_receipt_id !== receipt.process_launch_receipt_id
      || value.source_process_launch_receipt_hash !== receipt.process_launch_receipt_hash
      || value.source_dispatch_claim_hash !== claim.claim_hash
      || value.source_execution_envelope_hash !== envelope.envelope_hash
      || value.target_worker_request_id !== request.logical_request_id
      || value.target_worker_request_hash !== request.request_hash
      || canonicalJson(value.target_worker_request) !== canonicalJson(request)
      || value.attested_build_hash !== build.attestation_hash
      || value.attested_artifact_hash !== build.artifact.sha256
      || build.worker_protocol_version !== value.attested_artifact_worker_protocol_version
      || value.target_worker_request.worker_protocol_version !== value.target_worker_protocol_version
      || value.target_worker_request.execution_admission !== value.request_contract_execution_admission
      || value.target_worker_request.transport_status !== value.request_contract_transport_status
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessTransportActivationBlockers(receipt))) {
    throw new Error("decision harness Transport Activation parent or blocker binding drift")
  }
  const { gate_hash: gateHash, ...body } = value
  if (value.gate_id !== `decision-harness-transport-activation-${value.gate_key.slice(0, 24)}`
      || gateHash !== canonicalHash(body)) {
    throw new Error("decision harness Transport Activation identity or hash mismatch")
  }
}

const FIELDS = ["activation_status", "attested_artifact_hash",
  "attested_artifact_worker_protocol_version", "attested_build_hash", "blocker_set_policy",
  "blockers", "compatibility_projection_policy", "decision_output_authority", "dispatch_occurrence",
  "economic_authority", "gate_hash", "gate_id", "gate_key", "gate_policy_version",
  "harness_invocation", "order_authority", "owner", "process_reuse_policy", "protocol_relation",
  "purpose", "request_contract_execution_admission", "request_contract_transport_status",
  "request_write_receipt_count", "request_write_receipts", "response_admission", "response_instance",
  "schema_version", "scope", "signal_authority", "source_dispatch_claim_hash",
  "source_execution_envelope_hash", "source_process_launch_receipt", "source_process_launch_receipt_hash",
  "source_process_launch_receipt_id", "status", "successor_policy", "target_worker_protocol_version",
  "target_worker_request", "target_worker_request_hash", "target_worker_request_id",
  "transport_frame_design_status", "transport_frame_instance_count", "transport_frame_instances",
  "trial_authority", "worker_request_write"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision harness Transport Activation field whitelist drift")
  }
}
