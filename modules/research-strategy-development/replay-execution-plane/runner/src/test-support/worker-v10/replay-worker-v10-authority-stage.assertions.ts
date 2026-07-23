import { expect } from "bun:test"
import { canonicalHash, type ReplayExecutionRequest } from "../../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-request-dispatch"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityResponseValidation,
  type ReplayDecisionHarnessWorkerV10AuthorityResponseValidation,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-response-validation"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission,
  type ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-schedule-admission"
import {
  assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidationLineage,
  type BuildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidationInput,
} from "../../lib/replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import {
  assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
  type ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"

export function expectAuthoritySpawnBoundary(input: {
  revalidation: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation
  lineage: BuildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidationInput
}): void {
  const { revalidation: value, lineage } = input
  expect(value.status).toBe("spawn_boundary_revalidated_process_not_materialized")
  expect(value.source_authority_capsule_record_hash).toBe(lineage.source_authority_capsule.record_hash)
  expect(value.control_plane_revalidation_receipt_hash)
    .toBe(lineage.control_plane_revalidation_receipt.receipt_hash)
  expect(value.freshness_semantics)
    .toBe("receipt_binds_capsule_challenge_and_does_not_reuse_pre_capsule_clock_evidence")
  expect(value.blockers).toEqual([
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(value.spawn_boundary_revalidation_request_count).toBe(1)
  expect(value.spawn_boundary_revalidation_receipt_count).toBe(1)
  expect(value.process_launch_receipt_count).toBe(0)
  expect(value.admitted_process_instance_count).toBe(0)
  expect(value.request_frame_instance_count).toBe(0)
  expect(value.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(value))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidationLineage(
    value,
    lineage,
  )).not.toThrow()
}

export function expectAuthorityProcessLaunch(input: {
  receipt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
  spawn_revalidation_hash: string
  authority_capsule_hash: string
  process_artifact_hash: string
  live_process_instance_id: string
}): void {
  const { receipt } = input
  expect(receipt.receipt_status).toBe("started_process_frame_not_written")
  expect(receipt.source_spawn_revalidation_hash).toBe(input.spawn_revalidation_hash)
  expect(receipt.authority_capsule_hash).toBe(input.authority_capsule_hash)
  expect(receipt.process_artifact_hash).toBe(input.process_artifact_hash)
  expect(receipt.observed_child_pid).toBeGreaterThan(0)
  expect(receipt.process_instance_id).toBe(input.live_process_instance_id)
  expect(receipt.stdin_bytes_written).toBe(0)
  expect(receipt.stdin_closed).toBe(false)
  expect(receipt.request_frame_instance_count).toBe(0)
  expect(receipt.response_frame_instance_count).toBe(0)
  expect(receipt.blockers).toEqual(["authority_frame_write_decode_read_and_admission_not_materialized"])
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt(receipt)).not.toThrow()
}

export function expectAuthorityDispatch(input: {
  receipt: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt
  attempt: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt
  process_launch_receipt_hash: string
  process_instance_id: string
  transport_contract_hash: string
  execution_command_hash: string
  process_launch_intent_hash: string
  worker_request_hash: string
}): void {
  const { receipt, attempt } = input
  expect(receipt.receipt_status).toBe("process_exited_opaque_output_captured")
  expect(receipt.source_process_launch_receipt_hash).toBe(input.process_launch_receipt_hash)
  expect(receipt.process_instance_id).toBe(input.process_instance_id)
  expect(receipt.stdin_bytes_written).toBe(receipt.request_frame_bytes)
  expect(receipt.stdin_closed).toBe(true)
  expect(receipt.stdout_bytes_read).toBeGreaterThan(0)
  expect(receipt.stderr_bytes_read).toBe(0)
  expect(receipt.exit_status).toBe(0)
  expect(receipt.exit_signal).toBeNull()
  expect(receipt.transport_error_code).toBeNull()
  expect(receipt.raw_capture_authority).toBe("opaque_transport_candidate_not_response_frame")
  expect(receipt.request_frame_instance_count).toBe(1)
  expect(receipt.request_write_receipt_count).toBe(1)
  expect(receipt.request_decode_receipt_count).toBe(0)
  expect(receipt.response_frame_instance_count).toBe(0)
  expect(receipt.response_read_receipt_count).toBe(0)
  expect(receipt.blockers).toEqual(["raw_response_frame_decode_validation_and_admission_not_materialized"])
  expect(receipt.response_admission).toBe("not_granted")
  expect(receipt.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt(receipt)).not.toThrow()
  expect(attempt.request_frame.frame_kind).toBe("worker_request")
  expect(attempt.request_frame.transport_contract_hash).toBe(input.transport_contract_hash)
  expect(attempt.request_frame.execution_admission_command_hash).toBe(input.execution_command_hash)
  expect(attempt.request_frame.process_launch_intent_hash).toBe(input.process_launch_intent_hash)
  expect(attempt.request_frame.worker_request_hash).toBe(input.worker_request_hash)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt(attempt)).not.toThrow()
}

export function expectAuthorityResponseAndSchedule(input: {
  validation: ReplayDecisionHarnessWorkerV10AuthorityResponseValidation
  schedule: ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission
  request: ReplayExecutionRequest
}): void {
  const { validation, schedule, request } = input
  expect(validation.validation_status).toBe("admitted_non_economic_worker_response_candidate")
  expect(validation.validation_error_code).toBeNull()
  expect(validation.response_frame_hash).not.toBeNull()
  expect(validation.worker_response_hash).not.toBeNull()
  expect(validation.request_decode_receipt_count).toBe(1)
  expect(validation.response_frame_instance_count).toBe(1)
  expect(validation.response_read_receipt_count).toBe(1)
  expect(validation.response_validation_receipt_count).toBe(1)
  expect(validation.response_admission).toBe("granted_non_economic_worker_response_candidate_only")
  expect(validation.decision_output_authority).toBe("typed_worker_claim_only_not_schedule_admitted")
  expect(validation.signal_authority).toBe("none")
  expect(validation.order_authority).toBe("none")
  expect(validation.economic_authority).toBe("none")
  expect(validation.blockers).toEqual(["schedule_and_harness_receipt_admission_not_materialized"])
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityResponseValidation(validation)).not.toThrow()
  expect(schedule.admission_status).toBe("admitted_exact_frozen_schedule_match_non_economic")
  expect(schedule.control_plane_attempt_lease_request_hash).toBe(canonicalHash(request))
  expect(schedule.decision_sequence).toBe(1)
  expect(schedule.decision_time).toBe(request.order.signal_time)
  expect(schedule.selected_schedule_entry_hash).toBe(canonicalHash(request.decision_schedule.entries[0]))
  expect(schedule.claimed_decision_output).toEqual(schedule.expected_decision_output)
  expect(schedule.schedule_admission).toBe("granted_exact_boundary_match")
  expect(schedule.decision_output_authority)
    .toBe("schedule_matched_worker_claim_not_harness_receipt_admitted")
  expect(schedule.response_instance_count).toBe(1)
  expect(schedule.required_reproducibility_response_count).toBe(2)
  expect(schedule.harness_receipt_count).toBe(0)
  expect(schedule.blockers).toEqual([
    "independent_worker_response_reproducibility_pair_and_harness_receipt_not_materialized",
  ])
  expect(schedule.signal_authority).toBe("none")
  expect(schedule.order_authority).toBe("none")
  expect(schedule.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission(schedule)).not.toThrow()
}
