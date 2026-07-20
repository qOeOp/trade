import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveStopReplacementTerminalOutcome,
  replayPortfolioProtectiveStopReplacementTerminalOutcomeHash,
  type ReplayPortfolioProtectiveStopReplacementTerminalOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-terminal-contracts"
import {
  executeReplayPortfolioProtectiveStopReplacementTerminal,
  type ReplayPortfolioProtectiveStopReplacementTerminalLane,
} from "../../../engine/src/lib/replay-portfolio-protective-stop-replacement-terminal-engine"
import {
  runReplayIntegratedPortfolio,
} from "./replay-integrated-portfolio-runner"
import {
  runReplayPortfolioProtectiveTerminal,
  type ReplayPortfolioProtectiveTerminalRunInput,
} from "./replay-portfolio-protective-terminal-runner"
import { publishReplayPortfolioProtectiveStopReplacementTerminalArtifact } from
  "./replay-portfolio-protective-stop-replacement-terminal-artifact-publisher"
import { materializeReplayPortfolioProtectiveReplacementTerminalLanes } from
  "./replay-portfolio-protective-replacement-terminal-lane-materialization"

export interface ReplayPortfolioProtectiveStopReplacementTerminalRunInput
  extends ReplayPortfolioProtectiveTerminalRunInput {
  execute_replacement_terminal?: typeof executeReplayPortfolioProtectiveStopReplacementTerminal
  publish_replacement_terminal_artifact?: typeof publishReplayPortfolioProtectiveStopReplacementTerminalArtifact
}

export function runReplayPortfolioProtectiveStopReplacementTerminal(
  input: ReplayPortfolioProtectiveStopReplacementTerminalRunInput,
): ReplayPortfolioProtectiveStopReplacementTerminalOutcome {
  const projectedInput = {
    ...input,
    allow_predeclared_protective_stop_replacement_projection: true as const,
  }
  const source = runReplayPortfolioProtectiveTerminal(projectedInput)
  if (source.status !== "completed" || !source.evidence || !source.artifact_manifest) {
    return failed(input, "protective-terminal-failed", source.failure?.message ?? "Protective Terminal failed")
  }
  const integrated = runReplayIntegratedPortfolio(projectedInput)
  if (integrated.status !== "completed" || !integrated.risk_result) {
    return failed(input, "replacement-terminal-input-invalid", integrated.failure?.message ?? "Risk source missing")
  }
  let lanes: ReplayPortfolioProtectiveStopReplacementTerminalLane[]
  try {
    lanes = materializeReplayPortfolioProtectiveStopReplacementTerminalLanes(input)
  } catch (error) {
    return failed(input, "replacement-terminal-input-invalid", error)
  }
  let evidence
  try {
    evidence = (input.execute_replacement_terminal
      ?? executeReplayPortfolioProtectiveStopReplacementTerminal)({
      source_evidence: source.evidence,
      source_manifest: source.artifact_manifest,
      risk_result: integrated.risk_result,
      lanes,
    })
  } catch (error) {
    return failed(input, "replacement-terminal-engine-failed", error)
  }
  try {
    const published = (input.publish_replacement_terminal_artifact
      ?? publishReplayPortfolioProtectiveStopReplacementTerminalArtifact)({
      source_manifest: source.artifact_manifest,
      source_evidence: source.evidence,
      evidence,
      authority_frozen_at: input.allocation_reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioProtectiveStopReplacementTerminalOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.integrated_plan.portfolio_id,
      status: "completed",
      source_protective_terminal_evidence: source.evidence,
      evidence,
      artifact_manifest: published.manifest,
      idempotent_replay: source.idempotent_replay && published.idempotent_replay,
      failure: null,
    }
    const outcome = {
      ...body,
      outcome_hash: replayPortfolioProtectiveStopReplacementTerminalOutcomeHash(body),
    }
    assertReplayPortfolioProtectiveStopReplacementTerminalOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "replacement-terminal-artifact-failed", error)
  }
}

export function materializeReplayPortfolioProtectiveStopReplacementTerminalLanes(
  input: Pick<ReplayPortfolioProtectiveStopReplacementTerminalRunInput, "risk_plan" | "lanes">,
): ReplayPortfolioProtectiveStopReplacementTerminalLane[] {
  return materializeReplayPortfolioProtectiveReplacementTerminalLanes(input, {
    replacement_effect: "authorized_protective_stop_replace",
    select_intent: (entry) => entry.authorized_protective_stop_replace,
  })
}

function failed(
  input: ReplayPortfolioProtectiveStopReplacementTerminalRunInput,
  code: NonNullable<ReplayPortfolioProtectiveStopReplacementTerminalOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioProtectiveStopReplacementTerminalOutcome {
  const body: Omit<ReplayPortfolioProtectiveStopReplacementTerminalOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id,
    status: "failed",
    source_protective_terminal_evidence: null,
    evidence: null,
    artifact_manifest: null,
    idempotent_replay: false,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  const outcome = { ...body, outcome_hash: replayPortfolioProtectiveStopReplacementTerminalOutcomeHash(body) }
  assertReplayPortfolioProtectiveStopReplacementTerminalOutcome(outcome)
  return outcome
}
