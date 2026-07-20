import { createReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-take-profit-cancel-terminal-accounting"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome,
  replayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcomeHash,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-cancel-terminal-accounting-contracts"
import { readReplayPortfolioProtectiveTerminalArtifactEvidence } from
  "./replay-portfolio-protective-terminal-accounting-runner"
import { publishReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifact } from
  "./replay-portfolio-protective-take-profit-cancel-terminal-accounting-artifact-publisher"
import {
  readReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactEvidence,
  runReplayPortfolioProtectiveTakeProfitCancelTerminal,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalRunInput,
} from "./replay-portfolio-protective-take-profit-cancel-terminal-runner"

export interface ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingRunInput
  extends ReplayPortfolioProtectiveTakeProfitCancelTerminalRunInput {
  publish_cancel_terminal_accounting_artifact?:
    typeof publishReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifact
}

export function runReplayPortfolioProtectiveTakeProfitCancelTerminalAccounting(
  input: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingRunInput,
): ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome {
  const terminal = runReplayPortfolioProtectiveTakeProfitCancelTerminal(input)
  if (terminal.status !== "completed" || !terminal.evidence || !terminal.artifact_manifest) {
    return failed(input, "cancel-terminal-execution-failed",
      terminal.failure?.message ?? "Cancel terminal execution failed")
  }
  let committed
  let riskResult
  try {
    committed = readReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactEvidence(
      input, terminal.evidence, terminal.artifact_manifest,
    )
    const source = readReplayPortfolioProtectiveTerminalArtifactEvidence({
      ...input, allow_predeclared_take_profit_cancel_projection: true,
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
    evidence = createReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence({
      cancel_terminal_evidence: committed.cancel_terminal_evidence,
      cancel_terminal_manifest: committed.cancel_terminal_manifest,
      risk_result: riskResult,
    })
  } catch (error) {
    return failed(input, "cancel-terminal-accounting-invalid", error)
  }
  try {
    const published = (input.publish_cancel_terminal_accounting_artifact
      ?? publishReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifact)({
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
  input: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingRunInput,
  cancelEvidence: NonNullable<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome["cancel_terminal_evidence"]>,
  evidence: NonNullable<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome["evidence"]>,
  manifest: NonNullable<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome["artifact_manifest"]>,
  idempotent: boolean,
): ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome {
  const body: Omit<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id, status: "completed",
    cancel_terminal_evidence: cancelEvidence, evidence, artifact_manifest: manifest,
    idempotent_replay: idempotent, failure: null,
  }
  return checked({ ...body, outcome_hash: replayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcomeHash(body) })
}

function failed(
  input: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingRunInput,
  code: NonNullable<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome {
  const body: Omit<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id, status: "failed",
    cancel_terminal_evidence: null, evidence: null, artifact_manifest: null,
    idempotent_replay: false,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  return checked({ ...body, outcome_hash: replayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcomeHash(body) })
}
function checked(value: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome) {
  assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingOutcome(value); return value
}
