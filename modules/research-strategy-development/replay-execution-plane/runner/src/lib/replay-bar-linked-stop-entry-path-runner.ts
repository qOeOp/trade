import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayAuthorizedStopEntryPathStep,
  executeReplayAuthorizedStopEntryPathStep,
  type ReplayAuthorizedStopEntryPathStep,
  type ReplayAuthorizedStopEntryPathStepInput,
} from "../../../engine/src/lib/replay-authorized-stop-entry-path-step"

export const REPLAY_BAR_LINKED_STOP_ENTRY_PATH_RUN_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-bar-linked-stop-entry-path-run-outcome.v1" as const

export interface ReplayBarLinkedStopEntryPathRunInput extends ReplayAuthorizedStopEntryPathStepInput {
  activation_mode: "explicit_opt_in_pre_result_binding"
}

export interface ReplayBarLinkedStopEntryPathRunOutcome {
  schema_version: typeof REPLAY_BAR_LINKED_STOP_ENTRY_PATH_RUN_OUTCOME_SCHEMA_VERSION
  run_id: string
  status: "resolved"
  activation_mode: "explicit_opt_in_pre_result_binding"
  step: ReplayAuthorizedStopEntryPathStep
  result_published: false
  artifact_published: false
  checkpoint_bound: false
  outcome_hash: string
}

export function runReplayBarLinkedStopEntryPathStep(
  input: ReplayBarLinkedStopEntryPathRunInput,
): ReplayBarLinkedStopEntryPathRunOutcome {
  if (input.activation_mode !== "explicit_opt_in_pre_result_binding") {
    throw new Error("bar-linked Stop-entry path Runner requires explicit pre-Result opt-in")
  }
  const step = executeReplayAuthorizedStopEntryPathStep(input)
  const body: Omit<ReplayBarLinkedStopEntryPathRunOutcome, "outcome_hash"> = {
    schema_version: REPLAY_BAR_LINKED_STOP_ENTRY_PATH_RUN_OUTCOME_SCHEMA_VERSION,
    run_id: input.request.run_id,
    status: "resolved",
    activation_mode: input.activation_mode,
    step,
    result_published: false,
    artifact_published: false,
    checkpoint_bound: false,
  }
  return { ...body, outcome_hash: canonicalHash(body) }
}

export function assertReplayBarLinkedStopEntryPathRunOutcome(
  value: ReplayBarLinkedStopEntryPathRunOutcome,
  input: ReplayBarLinkedStopEntryPathRunInput,
): void {
  assertReplayAuthorizedStopEntryPathStep(value.step, input)
  const expected = runReplayBarLinkedStopEntryPathStep(input)
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("bar-linked Stop-entry path Runner outcome does not match its authorized Step")
  }
}
