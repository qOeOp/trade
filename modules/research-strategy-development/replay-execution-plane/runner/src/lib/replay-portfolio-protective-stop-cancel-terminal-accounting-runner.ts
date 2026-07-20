import { createReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-stop-cancel-terminal-accounting"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome,
  replayPortfolioProtectiveStopCancelTerminalAccountingOutcomeHash,
  type ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-cancel-terminal-accounting-contracts"
import { readReplayPortfolioProtectiveTerminalArtifactEvidence } from
  "./replay-portfolio-protective-terminal-accounting-runner"
import { publishReplayPortfolioProtectiveStopCancelTerminalAccountingArtifact } from
  "./replay-portfolio-protective-stop-cancel-terminal-accounting-artifact-publisher"
import {
  readReplayPortfolioProtectiveStopCancelTerminalArtifactEvidence,
  runReplayPortfolioProtectiveStopCancelTerminal,
  type ReplayPortfolioProtectiveStopCancelTerminalRunInput,
} from "./replay-portfolio-protective-stop-cancel-terminal-runner"

export interface ReplayPortfolioProtectiveStopCancelTerminalAccountingRunInput
  extends ReplayPortfolioProtectiveStopCancelTerminalRunInput {
  publish_cancel_terminal_accounting_artifact?:
    typeof publishReplayPortfolioProtectiveStopCancelTerminalAccountingArtifact
}

export function runReplayPortfolioProtectiveStopCancelTerminalAccounting(
  input: ReplayPortfolioProtectiveStopCancelTerminalAccountingRunInput,
): ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome {
  const terminal = runReplayPortfolioProtectiveStopCancelTerminal(input)
  if (terminal.status !== "completed" || !terminal.evidence || !terminal.artifact_manifest) {
    return failed(input, "cancel-terminal-execution-failed",
      terminal.failure?.message ?? "Cancel terminal execution failed")
  }
  let committed
  let riskResult
  try {
    committed = readReplayPortfolioProtectiveStopCancelTerminalArtifactEvidence(
      input, terminal.evidence, terminal.artifact_manifest,
    )
    const source = readReplayPortfolioProtectiveTerminalArtifactEvidence({
      ...input, allow_predeclared_protective_stop_cancel_projection: true,
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
    evidence = createReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence({
      cancel_terminal_evidence: committed.cancel_terminal_evidence,
      cancel_terminal_manifest: committed.cancel_terminal_manifest,
      risk_result: riskResult,
    })
  } catch (error) {
    return failed(input, "cancel-terminal-accounting-invalid", error)
  }
  try {
    const published = (input.publish_cancel_terminal_accounting_artifact
      ?? publishReplayPortfolioProtectiveStopCancelTerminalAccountingArtifact)({
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
  input: ReplayPortfolioProtectiveStopCancelTerminalAccountingRunInput,
  cancelEvidence: NonNullable<ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome["cancel_terminal_evidence"]>,
  evidence: NonNullable<ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome["evidence"]>,
  manifest: NonNullable<ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome["artifact_manifest"]>,
  idempotent: boolean,
): ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome {
  const body: Omit<ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id, status: "completed",
    cancel_terminal_evidence: cancelEvidence, evidence, artifact_manifest: manifest,
    idempotent_replay: idempotent, failure: null,
  }
  return checked({ ...body, outcome_hash: replayPortfolioProtectiveStopCancelTerminalAccountingOutcomeHash(body) })
}

function failed(
  input: ReplayPortfolioProtectiveStopCancelTerminalAccountingRunInput,
  code: NonNullable<ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome {
  const body: Omit<ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id, status: "failed",
    cancel_terminal_evidence: null, evidence: null, artifact_manifest: null,
    idempotent_replay: false,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  return checked({ ...body, outcome_hash: replayPortfolioProtectiveStopCancelTerminalAccountingOutcomeHash(body) })
}
function checked(value: ReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome) {
  assertReplayPortfolioProtectiveStopCancelTerminalAccountingOutcome(value); return value
}
