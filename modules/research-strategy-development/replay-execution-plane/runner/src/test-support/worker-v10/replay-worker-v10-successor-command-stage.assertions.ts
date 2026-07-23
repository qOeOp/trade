import { expect } from "bun:test"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"

export function assertReplayWorkerV10SuccessorCommandStage(input: {
  admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission
  contract_admission_hash: string
  execution_admission_contract_hash: string
  artifact_transport_contract_hash: string
  predecessor_lease_generation: number
  predecessor_command_hash: string
  observation_hash: string
  registry_receipt_hash: string
  clock_attestation_hash: string
  requested_lease_expiry: string
}): void {
  const admission = input.admission
  const claim = admission.successor_execution_admission_command.source_dispatch_claim
  const command = admission.successor_execution_admission_command

  expect(admission.status)
    .toBe("successor_command_admitted_process_launch_intent_not_materialized")
  expect(admission.source_successor_execution_contract_admission_hash)
    .toBe(input.contract_admission_hash)
  expect(admission.source_execution_admission_contract_hash)
    .toBe(input.execution_admission_contract_hash)
  expect(admission.source_artifact_bound_transport_contract_hash)
    .toBe(input.artifact_transport_contract_hash)
  expect(claim.lease_generation).toBe(input.predecessor_lease_generation + 1)
  expect(claim.claim_effect)
    .toBe("at_most_one_local_successor_command_issuer_while_cas_record_is_preserved")
  expect(claim.execution_admission_command_instance_count).toBe(0)
  expect(command.command_hash).not.toBe(input.predecessor_command_hash)
  expect(command.source_dispatch_claim_hash).toBe(claim.claim_hash)
  expect(command.current_lease_observation_hash).toBe(input.observation_hash)
  expect(command.control_plane_registry_read_receipt_hash).toBe(input.registry_receipt_hash)
  expect(command.control_plane_clock_attestation_hash).toBe(input.clock_attestation_hash)
  expect(command.issued_at).toBe("2026-07-14T00:04:04Z")
  expect(command.valid_before).toBe(input.requested_lease_expiry)
  expect(command.command_instance_count).toBe(1)
  expect(command.execution_admission)
    .toBe("granted_for_exact_successor_process_launch_intent_creation_only")
  expect(command.process_launch_intent_count).toBe(0)
  expect(command.worker_process_count).toBe(0)
  expect(command.request_frame_instance_count).toBe(0)
  expect(command.response_frame_instance_count).toBe(0)
  expect(admission.successor_dispatch_claim_count).toBe(1)
  expect(admission.successor_current_lease_observation_count).toBe(1)
  expect(admission.successor_registry_read_receipt_count).toBe(1)
  expect(admission.successor_clock_attestation_count).toBe(1)
  expect(admission.successor_execution_admission_command_count).toBe(1)
  expect(admission.successor_process_launch_intent_count).toBe(0)
  expect(admission.successor_authority_capsule_count).toBe(0)
  expect(admission.successor_spawn_revalidation_count).toBe(0)
  expect(admission.successor_worker_process_count).toBe(0)
  expect(admission.second_response_count).toBe(0)
  expect(admission.second_schedule_admission_count).toBe(0)
  expect(admission.reproducibility_pair_count).toBe(0)
  expect(admission.harness_receipt_count).toBe(0)
  expect(admission.transport_authority).toBe("artifact_bound_command_issued_activation_blocked")
  expect(admission.command_authority)
    .toBe("issued_for_exact_successor_process_launch_intent_creation_only")
  expect(admission.worker_process_authority).toBe("none")
  expect(admission.signal_authority).toBe("none")
  expect(admission.order_authority).toBe("none")
  expect(admission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim(claim))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand(command))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission(admission))
    .not.toThrow()
}
