import {
  assertReplayDecisionHarnessCapability,
  canonicalJson,
  createReplayDecisionHarnessReceipt,
  type ReplayDecisionHarnessCapability,
  type ReplayDecisionHarnessReceipt,
  type ReplayDecisionInputSnapshot,
  type ReplayExecutionRequest,
  type ReplaySupplementalValue,
} from "../../../contracts/src/lib/replay-contracts"

export interface ReplayDecisionHarness {
  capability: ReplayDecisionHarnessCapability
  execute(input: {
    request: ReplayExecutionRequest
    decision_input_snapshot: ReplayDecisionInputSnapshot
  }): {
    derived_order: ReplayExecutionRequest["order"]
    trace: ReplaySupplementalValue
  }
}

export class ReplayDecisionHarnessError extends Error {
  readonly code = "decision-harness-rejected" as const

  constructor(message: string) {
    super(message)
    this.name = "ReplayDecisionHarnessError"
  }
}

export function executeReplayDecisionHarness(input: {
  harness: ReplayDecisionHarness | undefined
  request: ReplayExecutionRequest
  decision_input_snapshot: ReplayDecisionInputSnapshot
}): ReplayDecisionHarnessReceipt | null {
  if (input.request.supplemental_requirement_set.mode === "none") {
    if (input.harness) throw new ReplayDecisionHarnessError("Replay lane without supplemental requirements cannot inject a decision harness")
    return null
  }
  if (!input.harness) throw new ReplayDecisionHarnessError("Replay supplemental lane requires an injected decision harness capability")
  try {
    assertReplayDecisionHarnessCapability(input.harness.capability, input.request)
    const output = input.harness.execute({
      request: structuredClone(input.request),
      decision_input_snapshot: structuredClone(input.decision_input_snapshot),
    })
    if (!output || canonicalJson(output.derived_order) !== canonicalJson(input.request.order)) {
      throw new Error("decision harness derived Order does not match the authorized Replay request")
    }
    return createReplayDecisionHarnessReceipt({
      request: input.request,
      decision_input_snapshot: input.decision_input_snapshot,
      derived_order: output.derived_order,
      trace: output.trace,
    })
  } catch (error) {
    throw new ReplayDecisionHarnessError(error instanceof Error ? error.message : String(error))
  }
}
