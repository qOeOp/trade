import { createReplayPortfolioProtectiveStopCancelCycleSequenceEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-stop-cancel-cycle-sequence-accounting"
import { createReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-stop-cancel-terminal-accounting"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveStopCancelCycleSequenceOutcome,
  replayPortfolioProtectiveStopCancelCycleSequenceOutcomeHash,
  type ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome,
  type ReplayPortfolioProtectiveStopCancelCycleSource,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-cancel-cycle-sequence-contracts"
import { executeReplayPortfolioProtectiveStopCancelTerminal } from
  "../../../engine/src/lib/replay-portfolio-protective-stop-cancel-terminal-engine"
import { validateReplayPortfolioCycleSequenceRunInput, type ReplayPortfolioCycleSequenceRunInput } from
  "./replay-portfolio-cycle-sequence-runner"
import { publishReplayPortfolioProtectiveStopCancelCycleSequenceArtifact } from
  "./replay-portfolio-protective-stop-cancel-cycle-sequence-artifact-publisher"
import { publishReplayPortfolioProtectiveStopCancelTerminalAccountingArtifact } from
  "./replay-portfolio-protective-stop-cancel-terminal-accounting-artifact-publisher"
import { materializeReplayPortfolioProtectiveStopCancelTerminalLanes,
  publishReplayPortfolioProtectiveStopCancelTerminalArtifact } from
  "./replay-portfolio-protective-stop-cancel-terminal-runner"
import { ReplayPortfolioProtectiveReplacementCycleSourceError,
  assertReplayPortfolioProtectiveReplacementCycleFullFlat,
  runReplayPortfolioProtectiveReplacementCycleSource } from
  "./replay-portfolio-protective-replacement-cycle-source-runner"

export interface ReplayPortfolioProtectiveStopCancelCycleSequenceRunInput
  extends ReplayPortfolioCycleSequenceRunInput {
  publish_cancel_cycle_sequence_artifact?: typeof publishReplayPortfolioProtectiveStopCancelCycleSequenceArtifact
}
export function runReplayPortfolioProtectiveStopCancelCycleSequence(
  input: ReplayPortfolioProtectiveStopCancelCycleSequenceRunInput,
): ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome {
  try { validateReplayPortfolioCycleSequenceRunInput(input) } catch (error) {
    return failed(input, "cancel-cycle-sequence-input-invalid", null, error)
  }
  const cycles: ReplayPortfolioProtectiveStopCancelCycleSource[] = []
  let openingCash = input.reservation.initial_cash; let childIdempotent = true
  for (const cycle of input.cycles) {
    const index = cycle.cycle_index; let source
    try {
      source = runReplayPortfolioProtectiveReplacementCycleSource(
        input, cycle, openingCash, "protective_stop_cancel",
      )
    } catch (error) {
      const code = error instanceof ReplayPortfolioProtectiveReplacementCycleSourceError
        ? cancelCode(error.stage_code) : "cancel-cycle-terminal-failed"
      return failed(input, code, index, error)
    }
    const { riskResult, sourceTerminalEvidence, sourceTerminalManifest } = source
    childIdempotent = childIdempotent && source.childIdempotent
    let cancelTerminalEvidence; let cancelTerminalManifest
    try {
      const lanes = materializeReplayPortfolioProtectiveStopCancelTerminalLanes({
        risk_plan: cycle.risk_plan, lanes: cycle.lanes,
      })
      cancelTerminalEvidence = executeReplayPortfolioProtectiveStopCancelTerminal({
        source_evidence: sourceTerminalEvidence, source_manifest: sourceTerminalManifest,
        risk_result: riskResult, lanes,
      })
      const published = publishReplayPortfolioProtectiveStopCancelTerminalArtifact({
        source_manifest: sourceTerminalManifest, source_evidence: sourceTerminalEvidence,
        evidence: cancelTerminalEvidence, authority_frozen_at: input.reservation.issued_at,
        artifact_store: input.artifact_store,
      })
      cancelTerminalManifest = published.manifest
      childIdempotent = childIdempotent && published.idempotent_replay
    } catch (error) { return failed(input, "cancel-cycle-terminal-failed", index, error) }
    try { assertReplayPortfolioProtectiveReplacementCycleFullFlat(cancelTerminalEvidence) } catch (error) {
      return failed(input, "cancel-cycle-not-full-flat", index, error)
    }
    let accountingEvidence; let accountingManifest
    try {
      accountingEvidence = createReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence({
        cancel_terminal_evidence: cancelTerminalEvidence, cancel_terminal_manifest: cancelTerminalManifest,
        risk_result: riskResult,
      })
      const published = publishReplayPortfolioProtectiveStopCancelTerminalAccountingArtifact({
        cancel_terminal_manifest: cancelTerminalManifest, cancel_terminal_evidence: cancelTerminalEvidence,
        risk_result: riskResult, evidence: accountingEvidence,
        authority_frozen_at: input.reservation.issued_at, artifact_store: input.artifact_store,
      })
      accountingManifest = published.manifest
      childIdempotent = childIdempotent && published.idempotent_replay
    } catch (error) { return failed(input, "cancel-cycle-accounting-failed", index, error) }
    cycles.push({ cycle_index: index, cancel_terminal_evidence: cancelTerminalEvidence,
      cancel_terminal_manifest: cancelTerminalManifest, accounting_evidence: accountingEvidence,
      accounting_manifest: accountingManifest })
    openingCash = accountingEvidence.trial_balance.ending_available_cash
  }
  let evidence
  try {
    evidence = createReplayPortfolioProtectiveStopCancelCycleSequenceEvidence({
      plan: input.plan, reservation: input.reservation, cycles,
    })
  } catch (error) { return failed(input, "cancel-cycle-sequence-invalid", null, error) }
  try {
    const published = (input.publish_cancel_cycle_sequence_artifact
      ?? publishReplayPortfolioProtectiveStopCancelCycleSequenceArtifact)({
      plan: input.plan, reservation: input.reservation, cycles, evidence, artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id, sequence_plan_hash: input.plan.plan_hash, status: "completed",
      evidence, artifact_manifest: published.manifest,
      idempotent_replay: childIdempotent && published.idempotent_replay, failure: null,
    }
    return checked({ ...body, outcome_hash: replayPortfolioProtectiveStopCancelCycleSequenceOutcomeHash(body) })
  } catch (error) { return failed(input, "cancel-cycle-sequence-artifact-failed", null, error) }
}
function cancelCode(code: ReplayPortfolioProtectiveReplacementCycleSourceError["stage_code"]):
NonNullable<ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome["failure"]>["code"] {
  return code.replace("replacement-cycle-", "cancel-cycle-") as
    NonNullable<ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome["failure"]>["code"]
}
function failed(input: ReplayPortfolioProtectiveStopCancelCycleSequenceRunInput,
  code: NonNullable<ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome["failure"]>["code"],
  cycleIndex: number | null, error: unknown): ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome {
  const body: Omit<ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id, sequence_plan_hash: input.plan.plan_hash, status: "failed",
    evidence: null, artifact_manifest: null, idempotent_replay: false,
    failure: { code, cycle_index: cycleIndex, message: error instanceof Error ? error.message : String(error),
      partial_sequence_result_published: false },
  }
  return checked({ ...body, outcome_hash: replayPortfolioProtectiveStopCancelCycleSequenceOutcomeHash(body) })
}
function checked(value: ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome) {
  assertReplayPortfolioProtectiveStopCancelCycleSequenceOutcome(value); return value
}
