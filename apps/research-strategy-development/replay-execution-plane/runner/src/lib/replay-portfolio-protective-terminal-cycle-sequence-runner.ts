import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveTerminalCycleSequenceOutcome,
  createReplayPortfolioProtectiveTerminalCycleSequenceResult,
  replayPortfolioProtectiveTerminalCycleSequenceOutcomeHash,
  type ReplayPortfolioProtectiveTerminalCycleExecution,
  type ReplayPortfolioProtectiveTerminalCycleSequenceOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-cycle-sequence-contracts"
import { createReplayIntegratedPortfolioResult } from
  "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import { executeReplayPortfolioAllocationSlice } from
  "../../../engine/src/lib/replay-portfolio-allocation-engine"
import { executeReplayRuntimeSharedWalletRiskSlice } from
  "../../../engine/src/lib/replay-runtime-shared-wallet-risk-engine"
import { executeReplayPortfolioMarkRiskRevaluation } from
  "../../../engine/src/lib/replay-portfolio-mark-risk-revaluation-engine"
import { executeReplayPortfolioProtectiveTerminal } from
  "../../../engine/src/lib/replay-portfolio-protective-terminal-engine"
import { createReplayPortfolioProtectiveTerminalAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-terminal-accounting"
import {
  materializeReplayPortfolioAllocationLanes,
} from "./replay-portfolio-allocation-runner"
import {
  materializeReplayRuntimeSharedWalletRiskLanes,
} from "./replay-runtime-shared-wallet-risk-runner"
import {
  materializeReplayPortfolioCycleSequenceAuthority,
  validateReplayPortfolioCycleSequenceRunInput,
  type ReplayPortfolioCycleSequenceRunInput,
} from "./replay-portfolio-cycle-sequence-runner"
import { materializeReplayPortfolioProtectiveTerminalLanes } from
  "./replay-portfolio-protective-terminal-runner"
import { publishReplayIntegratedPortfolioArtifact } from
  "./replay-integrated-portfolio-artifact-publisher"
import { publishReplayPortfolioMarkRiskRevaluationArtifact } from
  "./replay-portfolio-mark-risk-revaluation-artifact-publisher"
import { publishReplayPortfolioProtectiveTerminalArtifact } from
  "./replay-portfolio-protective-terminal-artifact-publisher"
import { publishReplayPortfolioProtectiveTerminalAccountingArtifact } from
  "./replay-portfolio-protective-terminal-accounting-artifact-publisher"
import { publishReplayPortfolioProtectiveTerminalCycleSequenceArtifact } from
  "./replay-portfolio-protective-terminal-cycle-sequence-artifact-publisher"

export interface ReplayPortfolioProtectiveTerminalCycleSequenceRunInput
  extends ReplayPortfolioCycleSequenceRunInput {
  execute_revaluation?: typeof executeReplayPortfolioMarkRiskRevaluation
  execute_protective_terminal?: typeof executeReplayPortfolioProtectiveTerminal
  create_protective_terminal_accounting?: typeof createReplayPortfolioProtectiveTerminalAccountingEvidence
  publish_integrated_artifact?: typeof publishReplayIntegratedPortfolioArtifact
  publish_revaluation_artifact?: typeof publishReplayPortfolioMarkRiskRevaluationArtifact
  publish_protective_terminal_artifact?: typeof publishReplayPortfolioProtectiveTerminalArtifact
  publish_protective_terminal_accounting_artifact?:
    typeof publishReplayPortfolioProtectiveTerminalAccountingArtifact
  publish_protective_cycle_sequence_artifact?:
    typeof publishReplayPortfolioProtectiveTerminalCycleSequenceArtifact
}

export function runReplayPortfolioProtectiveTerminalCycleSequence(
  input: ReplayPortfolioProtectiveTerminalCycleSequenceRunInput,
): ReplayPortfolioProtectiveTerminalCycleSequenceOutcome {
  try {
    validateReplayPortfolioCycleSequenceRunInput(input)
  } catch (error) {
    return failed(input, "protective-cycle-sequence-input-invalid", null, error)
  }
  const executions: ReplayPortfolioProtectiveTerminalCycleExecution[] = []
  let openingCash = input.reservation.initial_cash
  let childIdempotent = true
  for (const cycle of input.cycles) {
    const index = cycle.cycle_index
    const authority = materializeReplayPortfolioCycleSequenceAuthority(input.reservation, cycle, openingCash)
    let allocationResult
    try {
      const lanes = materializeReplayPortfolioAllocationLanes({
        plan: cycle.allocation_plan, authority: authority.allocation, lanes: cycle.lanes,
      })
      allocationResult = (input.execute_allocation_slice ?? executeReplayPortfolioAllocationSlice)({
        plan: cycle.allocation_plan, authority: authority.allocation, lanes,
      })
    } catch (error) {
      return failed(input, "protective-cycle-allocation-failed", index, error)
    }
    let riskResult
    try {
      const lanes = materializeReplayRuntimeSharedWalletRiskLanes({
        plan: cycle.risk_plan, risk_reservation: authority.risk_materialization, lanes: cycle.lanes,
      })
      riskResult = (input.execute_risk_slice ?? executeReplayRuntimeSharedWalletRiskSlice)({
        plan: cycle.risk_plan, authority: authority.risk, lanes, allocation_result: allocationResult,
      })
    } catch (error) {
      return failed(input, "protective-cycle-risk-failed", index, error)
    }
    const integratedResult = createReplayIntegratedPortfolioResult({
      plan: cycle.integrated_plan, allocation_result: allocationResult, risk_result: riskResult,
    })
    let integratedManifest
    try {
      const outcome = (input.publish_integrated_artifact ?? publishReplayIntegratedPortfolioArtifact)({
        integrated_plan: cycle.integrated_plan,
        allocation_reservation: authority.allocation,
        allocation_result: allocationResult,
        risk_plan: cycle.risk_plan,
        risk_reservation: authority.risk,
        risk_result: riskResult,
        integrated_result: integratedResult,
        artifact_store: input.artifact_store,
      })
      if (outcome.status !== "committed" || !outcome.artifact_manifest) {
        throw new Error(outcome.failure?.message ?? "Integrated Artifact was not committed")
      }
      integratedManifest = outcome.artifact_manifest
      childIdempotent = childIdempotent && outcome.idempotent_replay
    } catch (error) {
      return failed(input, "protective-cycle-integrated-artifact-failed", index, error)
    }
    let revaluationEvidence
    let revaluationManifest
    try {
      revaluationEvidence = (input.execute_revaluation ?? executeReplayPortfolioMarkRiskRevaluation)({
        integrated_plan: cycle.integrated_plan,
        allocation_plan: cycle.allocation_plan,
        allocation_reservation: authority.allocation,
        allocation_result: allocationResult,
        risk_plan: cycle.risk_plan,
        risk_reservation: authority.risk,
        risk_result: riskResult,
        integrated_result: integratedResult,
        integrated_manifest: integratedManifest,
      })
      const published = (input.publish_revaluation_artifact
        ?? publishReplayPortfolioMarkRiskRevaluationArtifact)({
        integrated_result: integratedResult,
        integrated_manifest: integratedManifest,
        allocation_reservation: authority.allocation,
        allocation_result: allocationResult,
        risk_result: riskResult,
        evidence: revaluationEvidence,
        authority_frozen_at: input.reservation.issued_at,
        artifact_store: input.artifact_store,
      })
      revaluationManifest = published.manifest
      childIdempotent = childIdempotent && published.idempotent_replay
    } catch (error) {
      return failed(input, "protective-cycle-revaluation-failed", index, error)
    }
    let terminalEvidence
    let terminalManifest
    try {
      const lanes = materializeReplayPortfolioProtectiveTerminalLanes({
        risk_plan: cycle.risk_plan,
        risk_authority: authority.risk,
        lanes: cycle.lanes,
      })
      terminalEvidence = (input.execute_protective_terminal
        ?? executeReplayPortfolioProtectiveTerminal)({
        identity: {
          experiment_id: input.reservation.experiment_id,
          trial_group_id: input.reservation.trial_group_id,
          trial_group_hash: input.reservation.trial_group_hash,
        },
        allocation_result: allocationResult,
        risk_result: riskResult,
        integrated_result: integratedResult,
        integrated_manifest: integratedManifest,
        revaluation_evidence: revaluationEvidence,
        revaluation_manifest: revaluationManifest,
        lanes,
      })
      const published = (input.publish_protective_terminal_artifact
        ?? publishReplayPortfolioProtectiveTerminalArtifact)({
        integrated_manifest: integratedManifest,
        revaluation_manifest: revaluationManifest,
        allocation_result: allocationResult,
        risk_result: riskResult,
        evidence: terminalEvidence,
        authority_frozen_at: input.reservation.issued_at,
        artifact_store: input.artifact_store,
      })
      terminalManifest = published.manifest
      childIdempotent = childIdempotent && published.idempotent_replay
    } catch (error) {
      return failed(input, "protective-cycle-terminal-failed", index, error)
    }
    if (terminalEvidence.lane_records.some((record) => record.ending_open)
        || terminalEvidence.ending_reserved_isolated_collateral !== 0
        || terminalEvidence.ending_gross_mark_exposure !== 0
        || terminalEvidence.ending_net_mark_exposure !== 0
        || terminalEvidence.ending_portfolio_frozen_stop_risk !== 0) {
      return failed(input, "protective-cycle-not-full-flat", index,
        "Protective terminal cycle did not reach a full-flat committed boundary")
    }
    let accountingEvidence
    let accountingManifest
    try {
      accountingEvidence = (input.create_protective_terminal_accounting
        ?? createReplayPortfolioProtectiveTerminalAccountingEvidence)({
        protective_terminal_evidence: terminalEvidence,
        protective_terminal_manifest: terminalManifest,
        risk_result: riskResult,
      })
      const published = (input.publish_protective_terminal_accounting_artifact
        ?? publishReplayPortfolioProtectiveTerminalAccountingArtifact)({
        protective_terminal_manifest: terminalManifest,
        protective_terminal_evidence: terminalEvidence,
        risk_result: riskResult,
        evidence: accountingEvidence,
        authority_frozen_at: input.reservation.issued_at,
        artifact_store: input.artifact_store,
      })
      accountingManifest = published.manifest
      childIdempotent = childIdempotent && published.idempotent_replay
    } catch (error) {
      return failed(input, "protective-cycle-accounting-failed", index, error)
    }
    executions.push({
      cycle_index: index,
      integrated_plan: cycle.integrated_plan,
      allocation_plan: cycle.allocation_plan,
      allocation_authority: authority.allocation,
      allocation_result: allocationResult,
      risk_plan: cycle.risk_plan,
      risk_authority: authority.risk,
      risk_result: riskResult,
      integrated_result: integratedResult,
      integrated_manifest: integratedManifest,
      revaluation_evidence: revaluationEvidence,
      revaluation_manifest: revaluationManifest,
      protective_terminal_evidence: terminalEvidence,
      protective_terminal_manifest: terminalManifest,
      accounting_evidence: accountingEvidence,
      accounting_manifest: accountingManifest,
    })
    openingCash = accountingEvidence.trial_balance.ending_available_cash
  }
  try {
    const result = createReplayPortfolioProtectiveTerminalCycleSequenceResult({
      plan: input.plan, reservation: input.reservation, executions,
    })
    const published = (input.publish_protective_cycle_sequence_artifact
      ?? publishReplayPortfolioProtectiveTerminalCycleSequenceArtifact)({
      plan: input.plan, reservation: input.reservation, result, artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioProtectiveTerminalCycleSequenceOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id,
      sequence_plan_hash: input.plan.plan_hash,
      status: "completed",
      result,
      artifact_manifest: published.manifest,
      idempotent_replay: childIdempotent && published.idempotent_replay,
      failure: null,
    }
    const outcome = { ...body,
      outcome_hash: replayPortfolioProtectiveTerminalCycleSequenceOutcomeHash(body) }
    assertReplayPortfolioProtectiveTerminalCycleSequenceOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "protective-cycle-sequence-artifact-failed", null, error)
  }
}

function failed(
  input: ReplayPortfolioProtectiveTerminalCycleSequenceRunInput,
  code: NonNullable<ReplayPortfolioProtectiveTerminalCycleSequenceOutcome["failure"]>["code"],
  cycleIndex: number | null,
  error: unknown,
): ReplayPortfolioProtectiveTerminalCycleSequenceOutcome {
  const body: Omit<ReplayPortfolioProtectiveTerminalCycleSequenceOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    sequence_plan_hash: input.plan.plan_hash,
    status: "failed",
    result: null,
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
    outcome_hash: replayPortfolioProtectiveTerminalCycleSequenceOutcomeHash(body) }
  assertReplayPortfolioProtectiveTerminalCycleSequenceOutcome(outcome)
  return outcome
}
