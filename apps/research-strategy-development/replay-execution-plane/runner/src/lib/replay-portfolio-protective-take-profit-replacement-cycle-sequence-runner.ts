import { createReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-take-profit-replacement-cycle-sequence-accounting"
import { createReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-accounting"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome,
  replayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcomeHash,
  type ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome,
  type ReplayPortfolioProtectiveTakeProfitReplacementCycleSource,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-cycle-sequence-contracts"
import { executeReplayPortfolioProtectiveTakeProfitReplacementTerminal } from
  "../../../engine/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-engine"
import {
  validateReplayPortfolioCycleSequenceRunInput,
  type ReplayPortfolioCycleSequenceRunInput,
} from "./replay-portfolio-cycle-sequence-runner"
import { publishReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifact } from
  "./replay-portfolio-protective-take-profit-replacement-cycle-sequence-artifact-publisher"
import { publishReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifact } from
  "./replay-portfolio-protective-take-profit-replacement-terminal-accounting-artifact-publisher"
import { publishReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifact } from
  "./replay-portfolio-protective-take-profit-replacement-terminal-artifact-publisher"
import { materializeReplayPortfolioProtectiveTakeProfitReplacementTerminalLanes } from
  "./replay-portfolio-protective-take-profit-replacement-terminal-runner"
import {
  ReplayPortfolioProtectiveReplacementCycleSourceError,
  assertReplayPortfolioProtectiveReplacementCycleFullFlat,
  runReplayPortfolioProtectiveReplacementCycleSource,
} from "./replay-portfolio-protective-replacement-cycle-source-runner"

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceRunInput
  extends ReplayPortfolioCycleSequenceRunInput {
  publish_replacement_cycle_sequence_artifact?:
    typeof publishReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifact
}

export function runReplayPortfolioProtectiveTakeProfitReplacementCycleSequence(
  input: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceRunInput,
): ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome {
  try {
    validateReplayPortfolioCycleSequenceRunInput(input)
  } catch (error) {
    return failed(input, "replacement-cycle-sequence-input-invalid", null, error)
  }
  const cycles: ReplayPortfolioProtectiveTakeProfitReplacementCycleSource[] = []
  let openingCash = input.reservation.initial_cash
  let childIdempotent = true
  for (const cycle of input.cycles) {
    const index = cycle.cycle_index
    let source
    try {
      source = runReplayPortfolioProtectiveReplacementCycleSource(input, cycle, openingCash, "take_profit")
    } catch (error) {
      const code = error instanceof ReplayPortfolioProtectiveReplacementCycleSourceError
        ? error.stage_code : "replacement-cycle-terminal-failed"
      return failed(input, code, index, error)
    }
    const { riskResult, sourceTerminalEvidence, sourceTerminalManifest } = source
    childIdempotent = childIdempotent && source.childIdempotent
    let replacementTerminalEvidence
    let replacementTerminalManifest
    try {
      const lanes = materializeReplayPortfolioProtectiveTakeProfitReplacementTerminalLanes({
        risk_plan: cycle.risk_plan, lanes: cycle.lanes,
      })
      replacementTerminalEvidence = executeReplayPortfolioProtectiveTakeProfitReplacementTerminal({
        source_evidence: sourceTerminalEvidence,
        source_manifest: sourceTerminalManifest,
        risk_result: riskResult,
        lanes,
      })
      const published = publishReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifact({
        source_manifest: sourceTerminalManifest,
        source_evidence: sourceTerminalEvidence,
        evidence: replacementTerminalEvidence,
        authority_frozen_at: input.reservation.issued_at,
        artifact_store: input.artifact_store,
      })
      replacementTerminalManifest = published.manifest
      childIdempotent = childIdempotent && published.idempotent_replay
    } catch (error) {
      return failed(input, "replacement-cycle-terminal-failed", index, error)
    }
    try {
      assertReplayPortfolioProtectiveReplacementCycleFullFlat(replacementTerminalEvidence)
    } catch (error) {
      return failed(input, "replacement-cycle-not-full-flat", index, error)
    }
    let accountingEvidence
    let accountingManifest
    try {
      accountingEvidence = createReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence({
        replacement_terminal_evidence: replacementTerminalEvidence,
        replacement_terminal_manifest: replacementTerminalManifest,
        risk_result: riskResult,
      })
      const published = publishReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifact({
        replacement_terminal_manifest: replacementTerminalManifest,
        replacement_terminal_evidence: replacementTerminalEvidence,
        risk_result: riskResult,
        evidence: accountingEvidence,
        authority_frozen_at: input.reservation.issued_at,
        artifact_store: input.artifact_store,
      })
      accountingManifest = published.manifest
      childIdempotent = childIdempotent && published.idempotent_replay
    } catch (error) {
      return failed(input, "replacement-cycle-accounting-failed", index, error)
    }
    cycles.push({
      cycle_index: index,
      replacement_terminal_evidence: replacementTerminalEvidence,
      replacement_terminal_manifest: replacementTerminalManifest,
      accounting_evidence: accountingEvidence,
      accounting_manifest: accountingManifest,
    })
    openingCash = accountingEvidence.trial_balance.ending_available_cash
  }
  let evidence
  try {
    evidence = createReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence({
      plan: input.plan, reservation: input.reservation, cycles,
    })
  } catch (error) {
    return failed(input, "replacement-cycle-sequence-invalid", null, error)
  }
  try {
    const published = (input.publish_replacement_cycle_sequence_artifact
      ?? publishReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifact)({
      plan: input.plan, reservation: input.reservation, cycles, evidence, artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id,
      sequence_plan_hash: input.plan.plan_hash,
      status: "completed",
      evidence,
      artifact_manifest: published.manifest,
      idempotent_replay: childIdempotent && published.idempotent_replay,
      failure: null,
    }
    const outcome = { ...body,
      outcome_hash: replayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcomeHash(body) }
    assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "replacement-cycle-sequence-artifact-failed", null, error)
  }
}

function failed(
  input: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceRunInput,
  code: NonNullable<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome["failure"]>["code"],
  cycleIndex: number | null,
  error: unknown,
): ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome {
  const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    sequence_plan_hash: input.plan.plan_hash,
    status: "failed",
    evidence: null,
    artifact_manifest: null,
    idempotent_replay: false,
    failure: {
      code,
      cycle_index: cycleIndex,
      message: error instanceof Error ? error.message : String(error),
      partial_sequence_result_published: false,
    },
  }
  const outcome = { ...body,
    outcome_hash: replayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcomeHash(body) }
  assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome(outcome)
  return outcome
}
