import { createReplayIntegratedPortfolioResult } from
  "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import { executeReplayPortfolioAllocationSlice } from
  "../../../engine/src/lib/replay-portfolio-allocation-engine"
import { executeReplayPortfolioMarkRiskRevaluation } from
  "../../../engine/src/lib/replay-portfolio-mark-risk-revaluation-engine"
import { executeReplayPortfolioProtectiveTerminal } from
  "../../../engine/src/lib/replay-portfolio-protective-terminal-engine"
import { executeReplayRuntimeSharedWalletRiskSlice } from
  "../../../engine/src/lib/replay-runtime-shared-wallet-risk-engine"
import { publishReplayIntegratedPortfolioArtifact } from
  "./replay-integrated-portfolio-artifact-publisher"
import { materializeReplayPortfolioAllocationLanes } from
  "./replay-portfolio-allocation-runner"
import {
  materializeReplayPortfolioCycleSequenceAuthority,
  type ReplayPortfolioCycleSequenceRunCycleInput,
  type ReplayPortfolioCycleSequenceRunInput,
} from "./replay-portfolio-cycle-sequence-runner"
import { publishReplayPortfolioMarkRiskRevaluationArtifact } from
  "./replay-portfolio-mark-risk-revaluation-artifact-publisher"
import { publishReplayPortfolioProtectiveTerminalArtifact } from
  "./replay-portfolio-protective-terminal-artifact-publisher"
import { materializeReplayPortfolioProtectiveTerminalLanes } from
  "./replay-portfolio-protective-terminal-runner"
import { materializeReplayRuntimeSharedWalletRiskLanes } from
  "./replay-runtime-shared-wallet-risk-runner"

type SourceStageCode = "replacement-cycle-allocation-failed" | "replacement-cycle-risk-failed"
  | "replacement-cycle-integrated-artifact-failed" | "replacement-cycle-revaluation-failed"
  | "replacement-cycle-terminal-failed"

export class ReplayPortfolioProtectiveReplacementCycleSourceError extends Error {
  constructor(readonly stage_code: SourceStageCode, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
  }
}

export function runReplayPortfolioProtectiveReplacementCycleSource(
  input: ReplayPortfolioCycleSequenceRunInput,
  cycle: ReplayPortfolioCycleSequenceRunCycleInput,
  openingCash: number,
  variant: "protective_stop" | "take_profit" | "take_profit_cancel" | "protective_stop_cancel"
    | "strategy_exit_cancel" | "fixed_partial_reduce",
) {
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
    throw new ReplayPortfolioProtectiveReplacementCycleSourceError("replacement-cycle-allocation-failed", error)
  }
  let riskResult
  try {
    const common = {
      plan: cycle.risk_plan,
      risk_reservation: authority.risk_materialization,
      lanes: cycle.lanes,
    }
    const lanes = variant === "protective_stop"
      ? materializeReplayRuntimeSharedWalletRiskLanes({
        ...common, allow_predeclared_protective_stop_replacement_projection: true,
      })
      : variant === "take_profit" ? materializeReplayRuntimeSharedWalletRiskLanes({
        ...common, allow_predeclared_take_profit_replacement_projection: true,
      }) : variant === "take_profit_cancel" ? materializeReplayRuntimeSharedWalletRiskLanes({
        ...common, allow_predeclared_take_profit_cancel_projection: true,
      }) : variant === "protective_stop_cancel" ? materializeReplayRuntimeSharedWalletRiskLanes({
        ...common, allow_predeclared_protective_stop_cancel_projection: true,
      }) : variant === "strategy_exit_cancel" ? materializeReplayRuntimeSharedWalletRiskLanes({
        ...common, allow_predeclared_strategy_exit_cancel_projection: true,
      }) : materializeReplayRuntimeSharedWalletRiskLanes({
        ...common, allow_predeclared_fixed_partial_reduce_projection: true,
      })
    riskResult = (input.execute_risk_slice ?? executeReplayRuntimeSharedWalletRiskSlice)({
      plan: cycle.risk_plan, authority: authority.risk, lanes, allocation_result: allocationResult,
    })
  } catch (error) {
    throw new ReplayPortfolioProtectiveReplacementCycleSourceError("replacement-cycle-risk-failed", error)
  }
  const integratedResult = createReplayIntegratedPortfolioResult({
    plan: cycle.integrated_plan, allocation_result: allocationResult, risk_result: riskResult,
  })
  let integratedManifest
  let childIdempotent = true
  try {
    const published = publishReplayIntegratedPortfolioArtifact({
      integrated_plan: cycle.integrated_plan,
      allocation_reservation: authority.allocation,
      allocation_result: allocationResult,
      risk_plan: cycle.risk_plan,
      risk_reservation: authority.risk,
      risk_result: riskResult,
      integrated_result: integratedResult,
      artifact_store: input.artifact_store,
    })
    if (published.status !== "committed" || !published.artifact_manifest) {
      throw new Error(published.failure?.message ?? "Integrated Artifact was not committed")
    }
    integratedManifest = published.artifact_manifest
    childIdempotent = published.idempotent_replay
  } catch (error) {
    throw new ReplayPortfolioProtectiveReplacementCycleSourceError(
      "replacement-cycle-integrated-artifact-failed", error,
    )
  }
  let revaluationEvidence
  let revaluationManifest
  try {
    revaluationEvidence = executeReplayPortfolioMarkRiskRevaluation({
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
    const published = publishReplayPortfolioMarkRiskRevaluationArtifact({
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
    throw new ReplayPortfolioProtectiveReplacementCycleSourceError("replacement-cycle-revaluation-failed", error)
  }
  let sourceTerminalEvidence
  let sourceTerminalManifest
  try {
    const lanes = materializeReplayPortfolioProtectiveTerminalLanes({
      risk_plan: cycle.risk_plan, risk_authority: authority.risk, lanes: cycle.lanes,
    })
    sourceTerminalEvidence = executeReplayPortfolioProtectiveTerminal({
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
    const published = publishReplayPortfolioProtectiveTerminalArtifact({
      integrated_manifest: integratedManifest,
      revaluation_manifest: revaluationManifest,
      allocation_result: allocationResult,
      risk_result: riskResult,
      evidence: sourceTerminalEvidence,
      authority_frozen_at: input.reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    sourceTerminalManifest = published.manifest
    childIdempotent = childIdempotent && published.idempotent_replay
  } catch (error) {
    throw new ReplayPortfolioProtectiveReplacementCycleSourceError("replacement-cycle-terminal-failed", error)
  }
  return {
    allocationResult,
    riskResult,
    sourceTerminalEvidence,
    sourceTerminalManifest,
    childIdempotent,
  }
}

export function assertReplayPortfolioProtectiveReplacementCycleFullFlat(evidence: {
  lane_records: Array<{ lane_id: string; ending_open: boolean }>
  ending_reserved_isolated_collateral: number
  ending_unrealized_pnl: number
  ending_gross_mark_exposure: number
  ending_net_mark_exposure: number
  ending_portfolio_frozen_stop_risk: number
}): void {
  if (evidence.lane_records.some((record) => record.ending_open)
      || evidence.ending_reserved_isolated_collateral !== 0
      || evidence.ending_unrealized_pnl !== 0
      || evidence.ending_gross_mark_exposure !== 0
      || evidence.ending_net_mark_exposure !== 0
      || evidence.ending_portfolio_frozen_stop_risk !== 0) {
    throw new Error(`Replacement-aware cycle did not reach a full-flat committed boundary: ${JSON.stringify({
      open_lane_ids: evidence.lane_records.filter((record) => record.ending_open).map((record) => record.lane_id),
      reserved: evidence.ending_reserved_isolated_collateral,
      unrealized: evidence.ending_unrealized_pnl,
      gross: evidence.ending_gross_mark_exposure,
      net: evidence.ending_net_mark_exposure,
      stop_risk: evidence.ending_portfolio_frozen_stop_risk,
    })}`)
  }
}
