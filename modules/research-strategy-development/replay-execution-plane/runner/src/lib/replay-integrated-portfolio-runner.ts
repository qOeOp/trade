import {
  assertReplayPortfolioAllocationReservationSnapshot,
  assertReplayRuntimeSharedWalletRiskReservationSnapshot,
  type ReplayPortfolioAllocationReservationSnapshot,
  type ReplayRuntimeSharedWalletRiskReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_INTEGRATED_PORTFOLIO_OUTCOME_SCHEMA_VERSION,
  assertReplayIntegratedPortfolioPlan,
  assertReplayIntegratedPortfolioOutcome,
  createReplayIntegratedPortfolioResult,
  replayIntegratedPortfolioOutcomeHash,
  type ReplayIntegratedPortfolioOutcome,
  type ReplayIntegratedPortfolioPlan,
} from "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import type { ReplayPortfolioAllocationPlan } from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import type { ReplayRuntimeSharedWalletRiskPlan } from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { executeReplayRuntimeSharedWalletRiskSlice } from "../../../engine/src/lib/replay-runtime-shared-wallet-risk-engine"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import {
  publishReplayIntegratedPortfolioArtifact,
  type ReplayIntegratedPortfolioArtifactPublishInput,
} from "./replay-integrated-portfolio-artifact-publisher"
import {
  runReplayPortfolioAllocationSlice,
  type ReplayPortfolioAllocationRunInput,
} from "./replay-portfolio-allocation-runner"
import {
  materializeReplayRuntimeSharedWalletRiskLanes,
} from "./replay-runtime-shared-wallet-risk-runner"
import type { ReplayTrialRunInput } from "./replay-trial-runner"

export interface ReplayIntegratedPortfolioRunInput {
  integrated_plan: ReplayIntegratedPortfolioPlan
  allocation_plan: ReplayPortfolioAllocationPlan
  allocation_reservation: ReplayPortfolioAllocationReservationSnapshot
  risk_plan: ReplayRuntimeSharedWalletRiskPlan
  risk_reservation: ReplayRuntimeSharedWalletRiskReservationSnapshot
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
  artifact_store: ReplayArtifactStore
  execute_allocation_slice?: ReplayPortfolioAllocationRunInput["execute_allocation_slice"]
  execute_risk_slice?: typeof executeReplayRuntimeSharedWalletRiskSlice
  publish_artifact?: typeof publishReplayIntegratedPortfolioArtifact
  allow_predeclared_protective_stop_replacement_projection?: true
  allow_predeclared_take_profit_replacement_projection?: true
  allow_predeclared_take_profit_cancel_projection?: true
  allow_predeclared_protective_stop_cancel_projection?: true
  allow_predeclared_strategy_exit_cancel_projection?: true
}

export function runReplayIntegratedPortfolio(
  input: ReplayIntegratedPortfolioRunInput,
): ReplayIntegratedPortfolioOutcome {
  try {
    validateInput(input)
  } catch (error) {
    return failed(input, "integrated-input-invalid", error)
  }
  const allocation = runReplayPortfolioAllocationSlice({
    plan: input.allocation_plan,
    allocation_reservation: input.allocation_reservation,
    lanes: input.lanes,
    execute_allocation_slice: input.execute_allocation_slice,
  })
  if (allocation.status !== "completed" || !allocation.result) {
    return failed(input, "allocation-failed", allocation.failure?.message ?? "Portfolio Allocation failed")
  }
  let riskResult
  try {
    const riskLanes = materializeReplayRuntimeSharedWalletRiskLanes({
      plan: input.risk_plan, risk_reservation: input.risk_reservation, lanes: input.lanes,
      allow_predeclared_protective_stop_replacement_projection:
        input.allow_predeclared_protective_stop_replacement_projection,
      allow_predeclared_take_profit_replacement_projection:
        input.allow_predeclared_take_profit_replacement_projection,
      allow_predeclared_take_profit_cancel_projection:
        input.allow_predeclared_take_profit_cancel_projection,
      allow_predeclared_protective_stop_cancel_projection:
        input.allow_predeclared_protective_stop_cancel_projection,
      allow_predeclared_strategy_exit_cancel_projection:
        input.allow_predeclared_strategy_exit_cancel_projection,
    })
    if (riskLanes.some((lane) => lane.entry_time !== input.integrated_plan.initial_allocation_time
        || (lane.exit !== null && Date.parse(lane.exit.time) <= Date.parse(input.integrated_plan.initial_allocation_time)))) {
      throw new Error("integrated Portfolio requires one initial Allocation cycle and no same-time exit or reentry")
    }
    riskResult = (input.execute_risk_slice ?? executeReplayRuntimeSharedWalletRiskSlice)({
      plan: input.risk_plan,
      authority: input.risk_reservation,
      lanes: riskLanes,
      allocation_result: allocation.result,
    })
  } catch (error) {
    return failed(input, "integrated-risk-failed", error)
  }
  let result
  try {
    result = createReplayIntegratedPortfolioResult({
      plan: input.integrated_plan, allocation_result: allocation.result, risk_result: riskResult,
    })
    const publishInput: ReplayIntegratedPortfolioArtifactPublishInput = {
      integrated_plan: input.integrated_plan,
      allocation_reservation: input.allocation_reservation,
      allocation_result: allocation.result,
      risk_plan: input.risk_plan,
      risk_reservation: input.risk_reservation,
      risk_result: riskResult,
      integrated_result: result,
      artifact_store: input.artifact_store,
    }
    const artifact = (input.publish_artifact ?? publishReplayIntegratedPortfolioArtifact)(publishInput)
    if (artifact.status !== "committed") {
      return failed(input, "integrated-artifact-failed", artifact.failure?.message ?? "integrated Artifact failed")
    }
    const body: Omit<ReplayIntegratedPortfolioOutcome, "outcome_hash"> = {
      schema_version: REPLAY_INTEGRATED_PORTFOLIO_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.integrated_plan.portfolio_id,
      integrated_plan_hash: input.integrated_plan.plan_hash,
      status: "completed",
      result,
      risk_result: riskResult,
      artifact,
      failure: null,
    }
    const outcome = { ...body, outcome_hash: replayIntegratedPortfolioOutcomeHash(body as ReplayIntegratedPortfolioOutcome) }
    assertReplayIntegratedPortfolioOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "integrated-artifact-failed", error)
  }
}

function validateInput(input: ReplayIntegratedPortfolioRunInput): void {
  assertReplayPortfolioAllocationReservationSnapshot(input.allocation_reservation)
  assertReplayRuntimeSharedWalletRiskReservationSnapshot(input.risk_reservation)
  assertReplayIntegratedPortfolioPlan(input.integrated_plan, input.allocation_plan, input.risk_plan)
  const allocation = input.allocation_reservation
  const risk = input.risk_reservation
  if (input.integrated_plan.allocation_reservation_hash !== allocation.reservation_hash
      || input.integrated_plan.risk_reservation_hash !== risk.reservation_hash
      || allocation.experiment_id !== risk.experiment_id || allocation.trial_group_id !== risk.trial_group_id
      || allocation.trial_group_hash !== risk.trial_group_hash || allocation.portfolio_id !== risk.portfolio_id
      || allocation.settlement_asset !== risk.settlement_asset
      || allocation.shared_initial_cash !== risk.shared_initial_cash
      || allocation.lanes.length !== risk.lanes.length
      || allocation.lanes.some((lane, index) => {
        const other = risk.lanes[index]
        return !other || lane.lane_id !== other.lane_id || lane.priority_rank !== other.priority_rank
          || lane.trial_id !== other.trial_id || lane.run_id !== other.run_id
          || lane.trial_reservation_ref !== other.trial_reservation_ref
          || lane.trial_reservation_hash !== other.trial_reservation_hash
      })) throw new Error("integrated Portfolio Control Plane authority closure drift")
}

function failed(
  input: ReplayIntegratedPortfolioRunInput,
  code: NonNullable<ReplayIntegratedPortfolioOutcome["failure"]>["code"],
  error: unknown,
): ReplayIntegratedPortfolioOutcome {
  const body: Omit<ReplayIntegratedPortfolioOutcome, "outcome_hash"> = {
    schema_version: REPLAY_INTEGRATED_PORTFOLIO_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id,
    integrated_plan_hash: input.integrated_plan.plan_hash,
    status: "failed",
    result: null,
    risk_result: null,
    artifact: null,
    failure: {
      code, message: error instanceof Error ? error.message : String(error), partial_result_published: false,
    },
  }
  const outcome = { ...body, outcome_hash: replayIntegratedPortfolioOutcomeHash(body as ReplayIntegratedPortfolioOutcome) }
  assertReplayIntegratedPortfolioOutcome(outcome)
  return outcome
}
