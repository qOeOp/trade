import { createReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-strategy-exit-cancel-terminal-accounting"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome,
  replayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcomeHash,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-strategy-exit-cancel-terminal-accounting-contracts"
import { readReplayPortfolioProtectiveTerminalArtifactEvidence } from
  "./replay-portfolio-protective-terminal-accounting-runner"
import { publishReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifact } from
  "./replay-portfolio-protective-strategy-exit-cancel-terminal-accounting-artifact-publisher"
import {
  readReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactEvidence,
  runReplayPortfolioProtectiveStrategyExitCancelTerminal,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalRunInput,
} from "./replay-portfolio-protective-strategy-exit-cancel-terminal-runner"

export interface ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingRunInput
  extends ReplayPortfolioProtectiveStrategyExitCancelTerminalRunInput {
  publish_cancel_terminal_accounting_artifact?:
    typeof publishReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifact
}

export function runReplayPortfolioProtectiveStrategyExitCancelTerminalAccounting(
  input: ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingRunInput,
): ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome {
  const terminal = runReplayPortfolioProtectiveStrategyExitCancelTerminal(input)
  if (terminal.status !== "completed" || !terminal.evidence || !terminal.artifact_manifest) {
    return failed(input, "cancel-terminal-execution-failed",
      terminal.failure?.message ?? "Cancel terminal execution failed")
  }
  let committed
  let riskResult
  try {
    committed = readReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactEvidence(
      input, terminal.evidence, terminal.artifact_manifest,
    )
    const source = readReplayPortfolioProtectiveTerminalArtifactEvidence({
      ...input, allow_predeclared_strategy_exit_cancel_projection: true,
    }, committed.source_protective_terminal_evidence, committed.source_protective_terminal_manifest)
    riskResult = source.risk_result
    if (riskResult.result_hash !== committed.cancel_terminal_evidence.risk_result_hash) {
      throw new Error("Cancel terminal Risk Result source drift")
    }
  } catch (error) {
    return failed(input, "cancel-terminal-artifact-read-failed", error)
  }
  let evidence
  try {
    evidence = createReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence({
      cancel_terminal_evidence: committed.cancel_terminal_evidence,
      cancel_terminal_manifest: committed.cancel_terminal_manifest,
      risk_result: riskResult,
    })
  } catch (error) {
    return failed(input, "cancel-terminal-accounting-invalid", error)
  }
  try {
    const published = (input.publish_cancel_terminal_accounting_artifact
      ?? publishReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifact)({
      cancel_terminal_manifest: committed.cancel_terminal_manifest,
      cancel_terminal_evidence: committed.cancel_terminal_evidence,
      risk_result: riskResult,
      evidence,
      authority_frozen_at: input.allocation_reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    return completed(input, committed.cancel_terminal_evidence, evidence, published.manifest,
      terminal.idempotent_replay && published.idempotent_replay)
  } catch (error) {
    return failed(input, "cancel-terminal-accounting-artifact-failed", error)
  }
}

function completed(
  input: ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingRunInput,
  cancelEvidence: NonNullable<ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome["cancel_terminal_evidence"]>,
  evidence: NonNullable<ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome["evidence"]>,
  manifest: NonNullable<ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome["artifact_manifest"]>,
  idempotent: boolean,
): ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome {
  const body: Omit<ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id, status: "completed",
    cancel_terminal_evidence: cancelEvidence, evidence, artifact_manifest: manifest,
    idempotent_replay: idempotent, failure: null,
  }
  return checked({ ...body, outcome_hash: replayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcomeHash(body) })
}

function failed(
  input: ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingRunInput,
  code: NonNullable<ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome {
  const body: Omit<ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id, status: "failed",
    cancel_terminal_evidence: null, evidence: null, artifact_manifest: null,
    idempotent_replay: false,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  return checked({ ...body, outcome_hash: replayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcomeHash(body) })
}
function checked(value: ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome) {
  assertReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingOutcome(value); return value
}
