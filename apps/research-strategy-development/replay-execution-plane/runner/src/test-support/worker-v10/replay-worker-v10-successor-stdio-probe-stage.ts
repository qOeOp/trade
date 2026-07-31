import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayDecisionHarnessWorkerV10NegativeProbeReceipt, ReplayDecisionHarnessWorkerV10StdioCapability } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import { assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import { expectCompactSuccessorStdioProbe } from "./replay-worker-v10-successor-contract-stage.assertions"
import { readReplayWorkerV10SuccessorExecutionStdioProbe, registerReplayWorkerV10SuccessorExecutionStdioProbe } from "../../lib/replay-worker-v10-successor-execution-stdio-probe-registry"
import { registerReplayWorkerV10StdioCapability } from "../../lib/replay-worker-v10-stdio-capability-registry"

export interface ReplayWorkerV10SuccessorStdioProbeStageInput {
  registry_root: string
  transport_admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission
  predecessor_stdio_capability: ReplayDecisionHarnessWorkerV10StdioCapability
  predecessor_negative_probe_receipt: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt
}

export function runReplayWorkerV10SuccessorStdioProbeStage(
  input: ReplayWorkerV10SuccessorStdioProbeStageInput,
) {
  expect(() => registerReplayWorkerV10StdioCapability({
    registry_root: input.registry_root,
    source_transport_contract: input.transport_admission.successor_base_transport_contract,
  })).toThrow()
  expect(() => registerReplayWorkerV10StdioCapability({
    registry_root: input.registry_root,
    source_transport_contract:
      input.transport_admission.source_predecessor_transport_contract,
    source_successor_execution_transport_admission: input.transport_admission,
  })).toThrow("successor Transport Admission binding drift")
  const missingRoot = mkdtempSync(
    join(tmpdir(), "replay-worker-v10-successor-execution-stdio-probe-missing-"),
  )
  try {
    expect(() => registerReplayWorkerV10SuccessorExecutionStdioProbe({
      registry_root: missingRoot,
      source_successor_execution_transport_admission: input.transport_admission,
      clock: { now: () => "2026-07-14T00:01:00Z" },
    })).toThrow()
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  let clockCalls = 0
  const admission = registerReplayWorkerV10SuccessorExecutionStdioProbe({
    registry_root: input.registry_root,
    source_successor_execution_transport_admission: input.transport_admission,
    clock: {
      now: () => {
        clockCalls += 1
        return "2026-07-14T00:01:00Z"
      },
    },
  })
  expect(clockCalls).toBe(1)
  expectCompactSuccessorStdioProbe({
    admission,
    source_transport: input.transport_admission,
    predecessor_stdio: input.predecessor_stdio_capability,
    predecessor_probe_hash: input.predecessor_negative_probe_receipt.receipt_hash,
  })
  expect(readReplayWorkerV10SuccessorExecutionStdioProbe({
    registry_root: input.registry_root,
    source_successor_execution_transport_admission: input.transport_admission,
  })).toEqual(admission)
  expect(registerReplayWorkerV10SuccessorExecutionStdioProbe({
    registry_root: input.registry_root,
    source_successor_execution_transport_admission: structuredClone(input.transport_admission),
    clock: {
      now: () => {
        clockCalls += 1
        return "2026-07-14T00:01:01Z"
      },
    },
  })).toEqual(admission)
  expect(clockCalls).toBe(1)
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission({
    ...admission,
    successor_worker_process_count: 1 as never,
  })).toThrow()
  return { stdio_probe_admission: admission }
}
