import { expect } from "bun:test"
import type { ReplayDecisionHarnessExecutionEnvelope } from "../../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import { assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-lease-admission"
import { readReplayWorkerV10SuccessorExecutionEnvelope, registerReplayWorkerV10SuccessorExecutionEnvelope } from "../../lib/replay-worker-v10-successor-execution-envelope-registry"

export interface ReplayWorkerV10SuccessorEnvelopeAdmissionStageInput {
  registry_root: string
  successor_lease_admission: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission
  predecessor_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  comparison_successor_envelope: ReplayDecisionHarnessExecutionEnvelope
  predecessor_lease_generation: number
}

export function runReplayWorkerV10SuccessorEnvelopeAdmissionStage(
  input: ReplayWorkerV10SuccessorEnvelopeAdmissionStageInput,
) {
  const admission = registerReplayWorkerV10SuccessorExecutionEnvelope({
    registry_root: input.registry_root,
    source_successor_lease_admission: input.successor_lease_admission,
  })
  const envelope = admission.successor_execution_envelope
  expect(admission.status).toBe("successor_execution_envelope_admitted_command_not_materialized")
  expect(admission.source_successor_lease_admission_hash)
    .toBe(input.successor_lease_admission.admission_hash)
  expect(admission.source_predecessor_execution_envelope_hash)
    .toBe(input.predecessor_execution_envelope.envelope_hash)
  expect(envelope.succession_kind).toBe("same_attempt_lease_generation_successor")
  expect(envelope.predecessor_execution_envelope_hash)
    .toBe(input.predecessor_execution_envelope.envelope_hash)
  expect(envelope.attempt_lease_hash)
    .toBe(input.successor_lease_admission.successor_attempt_lease_hash)
  expect(envelope.lease_generation).toBe(input.predecessor_lease_generation + 1)
  expect(envelope.envelope_hash).not.toBe(input.predecessor_execution_envelope.envelope_hash)
  expect(envelope.envelope_hash).not.toBe(input.comparison_successor_envelope.envelope_hash)
  expect(admission.successor_execution_envelope_count).toBe(1)
  expect(admission.successor_execution_admission_command_count).toBe(0)
  expect(admission.successor_process_launch_intent_count).toBe(0)
  expect(admission.successor_authority_capsule_count).toBe(0)
  expect(admission.successor_spawn_revalidation_count).toBe(0)
  expect(admission.successor_process_count).toBe(0)
  expect(admission.second_response_count).toBe(0)
  expect(admission.second_schedule_admission_count).toBe(0)
  expect(admission.reproducibility_pair_count).toBe(0)
  expect(admission.harness_receipt_count).toBe(0)
  expect(admission.envelope_authority).toBe("admitted_for_fresh_successor_command_construction_only")
  expect(admission.process_authority)
    .toBe("none_fresh_command_intent_capsule_revalidation_required")
  expect(admission.blockers).toEqual([
    "successor_command_intent_capsule_and_process_lineage_not_materialized",
    "second_distinct_fresh_process_schedule_admission_not_materialized",
    "response_reproducibility_pair_not_materialized",
    "worker_v10_harness_receipt_not_materialized",
  ])
  expect(admission.signal_authority).toBe("none")
  expect(admission.order_authority).toBe("none")
  expect(admission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(admission))
    .not.toThrow()
  expect(readReplayWorkerV10SuccessorExecutionEnvelope({
    registry_root: input.registry_root,
    source_successor_lease_admission: input.successor_lease_admission,
  })).toEqual(admission)
  expect(registerReplayWorkerV10SuccessorExecutionEnvelope({
    registry_root: input.registry_root,
    source_successor_lease_admission: structuredClone(input.successor_lease_admission),
  })).toEqual(admission)
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission({
    ...admission,
    successor_execution_admission_command_count: 1 as never,
  })).toThrow()
  return { envelope_admission: admission }
}
