import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome,
  replayPortfolioProtectiveTakeProfitReplacementTerminalOutcomeHash,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-contracts"
import {
  executeReplayPortfolioProtectiveTakeProfitReplacementTerminal,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalLane,
} from "../../../engine/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-engine"
import {
  runReplayIntegratedPortfolio,
} from "./replay-integrated-portfolio-runner"
import {
  runReplayPortfolioProtectiveTerminal,
  type ReplayPortfolioProtectiveTerminalRunInput,
} from "./replay-portfolio-protective-terminal-runner"
import { publishReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifact } from
  "./replay-portfolio-protective-take-profit-replacement-terminal-artifact-publisher"
import { materializeReplayPortfolioProtectiveReplacementTerminalLanes } from
  "./replay-portfolio-protective-replacement-terminal-lane-materialization"

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalRunInput
  extends ReplayPortfolioProtectiveTerminalRunInput {
  execute_replacement_terminal?: typeof executeReplayPortfolioProtectiveTakeProfitReplacementTerminal
  publish_replacement_terminal_artifact?: typeof publishReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifact
}

export function runReplayPortfolioProtectiveTakeProfitReplacementTerminal(
  input: ReplayPortfolioProtectiveTakeProfitReplacementTerminalRunInput,
): ReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome {
  const projectedInput = {
    ...input,
    allow_predeclared_take_profit_replacement_projection: true as const,
  }
  const source = runReplayPortfolioProtectiveTerminal(projectedInput)
  if (source.status !== "completed" || !source.evidence || !source.artifact_manifest) {
    return failed(input, "protective-terminal-failed", source.failure?.message ?? "Protective Terminal failed")
  }
  const integrated = runReplayIntegratedPortfolio(projectedInput)
  if (integrated.status !== "completed" || !integrated.risk_result) {
    return failed(input, "replacement-terminal-input-invalid", integrated.failure?.message ?? "Risk source missing")
  }
  let lanes: ReplayPortfolioProtectiveTakeProfitReplacementTerminalLane[]
  try {
    lanes = materializeReplayPortfolioProtectiveTakeProfitReplacementTerminalLanes(input)
  } catch (error) {
    return failed(input, "replacement-terminal-input-invalid", error)
  }
  let evidence
  try {
    evidence = (input.execute_replacement_terminal
      ?? executeReplayPortfolioProtectiveTakeProfitReplacementTerminal)({
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
      ?? publishReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifact)({
      source_manifest: source.artifact_manifest,
      source_evidence: source.evidence,
      evidence,
      authority_frozen_at: input.allocation_reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION,
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
      outcome_hash: replayPortfolioProtectiveTakeProfitReplacementTerminalOutcomeHash(body),
    }
    assertReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "replacement-terminal-artifact-failed", error)
  }
}

export function materializeReplayPortfolioProtectiveTakeProfitReplacementTerminalLanes(
  input: Pick<ReplayPortfolioProtectiveTakeProfitReplacementTerminalRunInput, "risk_plan" | "lanes">,
): ReplayPortfolioProtectiveTakeProfitReplacementTerminalLane[] {
  return materializeReplayPortfolioProtectiveReplacementTerminalLanes(input, {
    replacement_effect: "authorized_take_profit_replace",
    select_intent: (entry) => entry.authorized_take_profit_replace,
  })
}

function failed(
  input: ReplayPortfolioProtectiveTakeProfitReplacementTerminalRunInput,
  code: NonNullable<ReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome {
  const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id,
    status: "failed",
    source_protective_terminal_evidence: null,
    evidence: null,
    artifact_manifest: null,
    idempotent_replay: false,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  const outcome = { ...body, outcome_hash: replayPortfolioProtectiveTakeProfitReplacementTerminalOutcomeHash(body) }
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalOutcome(outcome)
  return outcome
}
