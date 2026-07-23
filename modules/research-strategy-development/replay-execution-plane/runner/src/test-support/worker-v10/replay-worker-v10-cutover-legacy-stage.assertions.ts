import { expect } from "bun:test"
import {
  assertReplayDecisionHarnessProcessLaunchAttempt,
  assertReplayDecisionHarnessProcessLaunchReceipt,
  type ReplayDecisionHarnessProcessLaunchReceipt,
} from "../../../../contracts/src/lib/replay-decision-harness-process-launch"
import {
  assertReplayDecisionHarnessTransportActivationGate,
  type ReplayDecisionHarnessTransportActivationGate,
} from "../../../../contracts/src/lib/replay-decision-harness-transport-activation"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  type ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import type { ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-authority-capsule"
import type { ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import type { ReplayDecisionHarnessWorkerV10CutoverReceipt } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-cutover-receipt"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import type { ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult } from "../../lib/replay-worker-v10-successor-spawn-boundary-revalidation-registry"
import type { ReplayWorkerV10CutoverOutcome } from "../../lib/replay-worker-v10-cutover"

export function expectSuccessorSpawnRevalidation(input: {
  result: ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult
  capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord
  intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
}): void {
  const { result, capsule, intent } = input
  const request = result.revalidation_request
  const receipt = result.control_plane_revalidation_receipt
  const value: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation =
    result.spawn_boundary_revalidation
  expect(request.source_authority_capsule_record_hash).toBe(capsule.record_hash)
  expect(request.source_authority_process_launch_intent_hash).toBe(intent.intent_hash)
  expect(request.expected_current_attempt_lease_hash).toBe(capsule.current_attempt_lease_hash)
  expect(receipt.source_request_hash).toBe(request.request_hash)
  expect(receipt.registry_read_started_at).toBe("2026-07-14T00:04:08Z")
  expect(receipt.revalidated_at).toBe("2026-07-14T00:04:09Z")
  expect(receipt.process_authority).toBe("none")
  expect(value.status).toBe("successor_spawn_boundary_revalidated_process_not_materialized")
  expect(value.source_successor_authority_capsule_record_hash).toBe(capsule.record_hash)
  expect(value.source_successor_process_launch_intent_hash).toBe(intent.intent_hash)
  expect(value.source_intent_issued_at).toBe(intent.intent_issued_at)
  for (const hash of [value.source_capsule_parent_canonical_file_sha256,
    value.source_intent_parent_canonical_file_sha256, value.source_request_canonical_file_sha256,
    value.source_receipt_canonical_file_sha256]) {
    expect(hash).toHaveLength(64)
  }
  expect(value.successor_execution_admission_command_count).toBe(1)
  expect(value.successor_process_launch_intent_count).toBe(1)
  expect(value.successor_authority_capsule_count).toBe(1)
  expect(value.successor_spawn_revalidation_request_count).toBe(1)
  expect(value.successor_spawn_revalidation_receipt_count).toBe(1)
  expect(value.successor_spawn_revalidation_count).toBe(1)
  expect(value.successor_worker_process_count).toBe(0)
  expect(value.successor_worker_request_frame_count).toBe(0)
  expect(value.successor_worker_request_decode_count).toBe(0)
  expect(value.second_response_count).toBe(0)
  expect(value.second_schedule_admission_count).toBe(0)
  expect(value.reproducibility_pair_count).toBe(0)
  expect(value.harness_receipt_count).toBe(0)
  expect(value.spawn_transition_authority)
    .toBe("granted_for_one_immediate_attempt_bound_process_start_candidate")
  expect(value.process_start_evidence).toBe("none")
  expect(value.blockers).toEqual([
    "successor_worker_process_and_request_dispatch_not_materialized",
    "second_response_schedule_pair_and_harness_receipt_not_materialized",
  ])
  expect(value.signal_authority).toBe("none")
  expect(value.order_authority).toBe("none")
  expect(value.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation(value))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage(
    value,
    capsule,
    intent,
  )).not.toThrow()
}

export function expectWorkerV10Cutover(input: {
  outcome: ReplayWorkerV10CutoverOutcome
  revalidation_calls: number
}): void {
  const { outcome, revalidation_calls: calls } = input
  const receipt: ReplayDecisionHarnessWorkerV10CutoverReceipt = outcome.receipt
  expect(outcome.disposition).toBe("new_cutover_receipt")
  expect(receipt.status).toBe("admitted_two_fresh_process_pair_and_exact_schedule_effect")
  expect(receipt.first_observed_child_pid).not.toBe(receipt.second_observed_child_pid)
  expect(receipt.first_process_instance_id).not.toBe(receipt.second_process_instance_id)
  expect(receipt.first_worker_response_hash).toBe(receipt.second_worker_response_hash)
  expect(receipt.response_instance_count).toBe(2)
  expect(receipt.schedule_admission_count).toBe(2)
  expect(receipt.reproducibility_pair_count).toBe(1)
  expect(receipt.harness_receipt_count).toBe(1)
  expect(receipt.economic_authority).toBe("granted_exact_frozen_schedule_effect")
  expect(receipt.blockers).toEqual([])
  expect(calls).toBe(1)
}

export function expectFormalCutoverAdmission(input: {
  receipt: { receipt_hash: string; worker_protocol_version: string; decision_output: unknown } | null
  cutover: ReplayDecisionHarnessWorkerV10CutoverReceipt
}): void {
  expect(input.receipt?.receipt_hash).toBe(input.cutover.receipt_hash)
  expect(input.receipt?.worker_protocol_version).toBe("rd-replay-harness-worker-stdio-v10")
  expect(input.receipt?.decision_output).toEqual(input.cutover.decision_output)
}

export function expectLegacyProcessProbe(receipt: ReplayDecisionHarnessProcessLaunchReceipt): void {
  expect(receipt.receipt_status).toBe("started_probe_eof_rejected")
  expect(receipt.process_launch_occurrence).toBe("runner_observed_child_started")
  expect(receipt.observed_child_pid).toBeGreaterThan(0)
  expect(receipt.process_instance_id).toHaveLength(64)
  expect(receipt.worker_request_count).toBe(0)
  expect(receipt.dispatch_occurrence).toBe("not_materialized_zero_worker_request_bytes")
  expect(receipt.transport_admission).toBe("not_granted")
  expect(receipt.response_instance).toBeNull()
  expect(receipt.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessProcessLaunchAttempt(receipt.source_process_launch_attempt))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessProcessLaunchReceipt(receipt)).not.toThrow()
}

export function expectLegacyTransportActivation(gate: ReplayDecisionHarnessTransportActivationGate): void {
  expect(gate.status).toBe("blocked")
  expect(gate.activation_status).toBe("denied")
  expect(gate.attested_artifact_worker_protocol_version).toBe("rd-replay-harness-worker-stdio-v9")
  expect(gate.target_worker_protocol_version).toBe("rd-replay-harness-worker-stdio-v10")
  expect(gate.protocol_relation).toBe("incompatible_v9_artifact_v10_request")
  expect(gate.compatibility_projection_policy).toBe("forbidden_no_silent_v10_to_v9_request_projection")
  expect(gate.process_reuse_policy).toBe("completed_probe_process_is_not_a_live_dispatch_process")
  expect(gate.blockers).toEqual([
    "attested_artifact_worker_protocol_v9_target_request_protocol_v10_mismatch",
    "source_process_launch_receipt_is_terminal_probe_not_reusable_worker_process",
    "target_worker_request_execution_admission_not_granted",
    "target_worker_request_transport_status_not_invoked",
  ])
  expect(gate.transport_frame_instance_count).toBe(0)
  expect(gate.request_write_receipt_count).toBe(0)
  expect(gate.dispatch_occurrence).toBe("not_materialized")
  expect(gate.worker_request_write).toBe("forbidden")
  expect(gate.harness_invocation).toBe("forbidden")
  expect(gate.response_instance).toBeNull()
  expect(gate.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessTransportActivationGate(gate)).not.toThrow()
}
