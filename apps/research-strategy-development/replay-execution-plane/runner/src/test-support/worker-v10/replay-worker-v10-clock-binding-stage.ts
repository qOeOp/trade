import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayDispatchClockAttestation } from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import { assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationLineage, buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation } from "../../lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import { readReplayWorkerV10ExecutionAdmissionClockAttestation, registerReplayWorkerV10ExecutionAdmissionClockAttestation } from "../../lib/replay-worker-v10-execution-admission-clock-attestation-registry"

export interface ReplayWorkerV10ClockBindingStageInput {
  registry_root: string
  registry_provenance: ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance
  build_clock(completedAt: string, completedMonotonicNs: string): ReplayDispatchClockAttestation
  profile(stage: string): void
}

export function runReplayWorkerV10ClockBindingStage(
  input: ReplayWorkerV10ClockBindingStageInput,
) {
  const clock = input.build_clock("2026-07-14T00:00:36Z", "3000100")
  const bindingInput = {
    source_registry_provenance: input.registry_provenance,
    control_plane_clock_attestation: clock,
  }
  const binding = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(bindingInput)
  input.profile("clock binding")
  expect(binding.status).toBe("authority_clock_attested_command_issue_blocked")
  expect(binding.independent_dispatch_clock_attestation)
    .toBe("authority_internal_dual_sample_bound")
  expect(binding.clock_authority_limit)
    .toBe("local_control_plane_process_clock_not_signed_remote_or_tsa_time")
  expect(binding.predecessor_blocker_closure)
    .toBe("independent_dispatch_clock_attestation_closed_only")
  expect(binding.execution_admission_command_instance_count).toBe(0)
  expect(binding.blockers).toEqual([
    "execution_admission_command_instance_not_issued",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(binding))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationLineage(
    binding,
    bindingInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation({
    ...bindingInput,
    control_plane_clock_attestation: { ...clock, attestation_hash: "2".repeat(64) },
  })).toThrow()

  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-clock-attestation-missing-"))
  try {
    expect(() => registerReplayWorkerV10ExecutionAdmissionClockAttestation({
      registry_root: missingRoot,
      ...bindingInput,
    })).toThrow("requires the exact durable registry provenance")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10ExecutionAdmissionClockAttestation({
    registry_root: input.registry_root,
    ...bindingInput,
  })).toEqual(binding)
  expect(readReplayWorkerV10ExecutionAdmissionClockAttestation({
    registry_root: input.registry_root,
    ...bindingInput,
  })).toEqual(binding)
  return { clock_attestation: clock, clock_binding_input: bindingInput, clock_binding: binding }
}
