import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import { assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import { expectSuccessorExecutionContracts } from "./replay-worker-v10-successor-contract-stage.assertions"
import { readReplayWorkerV10SuccessorExecutionContract, registerReplayWorkerV10SuccessorExecutionContract } from "../../lib/replay-worker-v10-successor-execution-contract-registry"

export interface ReplayWorkerV10SuccessorContractAdmissionStageInput {
  registry_root: string
  envelope_admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission
  transport_admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission
  stdio_probe_admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  predecessor_successor_transport_contract:
    ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  predecessor_execution_admission_contract:
    ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract
  profile(stage: string): void
}

export function runReplayWorkerV10SuccessorContractAdmissionStage(
  input: ReplayWorkerV10SuccessorContractAdmissionStageInput,
) {
  const missingRoot = mkdtempSync(
    join(tmpdir(), "replay-worker-v10-successor-execution-contract-missing-"),
  )
  try {
    expect(() => registerReplayWorkerV10SuccessorExecutionContract({
      registry_root: missingRoot,
      source_successor_execution_stdio_probe_admission: input.stdio_probe_admission,
    })).toThrow()
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  const admission = registerReplayWorkerV10SuccessorExecutionContract({
    registry_root: input.registry_root,
    source_successor_execution_stdio_probe_admission: input.stdio_probe_admission,
  })
  input.profile("successor execution contract")
  expectSuccessorExecutionContracts({
    admission,
    stdio_admission: input.stdio_probe_admission,
    source_transport: input.transport_admission,
    source_envelope: input.envelope_admission,
    predecessor_transport: input.predecessor_successor_transport_contract,
    predecessor_execution: input.predecessor_execution_admission_contract,
  })
  expect(readReplayWorkerV10SuccessorExecutionContract({
    registry_root: input.registry_root,
    source_successor_execution_stdio_probe_admission: input.stdio_probe_admission,
  })).toEqual(admission)
  expect(registerReplayWorkerV10SuccessorExecutionContract({
    registry_root: input.registry_root,
    source_successor_execution_stdio_probe_admission: structuredClone(input.stdio_probe_admission),
  })).toEqual(admission)
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission({
    ...admission,
    successor_execution_admission_command_count: 1 as never,
  })).toThrow()
  return { execution_contract_admission: admission }
}
