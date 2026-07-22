import {
  assertReplayPortfolioReallocationReservationSnapshot,
  assertReplayRuntimeSharedWalletRiskReservationSnapshot,
  type ReplayPortfolioReallocationReservationSnapshot,
  type ReplayRuntimeSharedWalletRiskReservationSnapshot,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayIntegratedPortfolioOutcome } from "../../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import type { ReplayPortfolioAllocationAuthorityBinding, ReplayPortfolioAllocationPlan } from "../../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import {
  assertReplayPortfolioReallocationPlan,
  assertReplayPortfolioReallocationResult,
  assertReplayPortfolioReallocationPredecessor,
  type ReplayPortfolioReallocationOutcome,
  type ReplayPortfolioReallocationPlan,
} from "../../../../contracts/src/lib/replay-portfolio-reallocation-contracts"
import type { ReplayRuntimeSharedWalletRiskPlan } from "../../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  REPLAY_TWO_CYCLE_PORTFOLIO_OUTCOME_SCHEMA_VERSION,
  assertReplayTwoCyclePortfolioOutcome,
  assertReplayTwoCyclePortfolioPlan,
  createReplayTwoCyclePortfolioResult,
  replayTwoCyclePortfolioOutcomeHash,
  type ReplayTwoCyclePortfolioOutcome,
  type ReplayTwoCyclePortfolioPlan,
} from "../../../../contracts/src/lib/replay-two-cycle-portfolio-contracts"
import { executeReplayRuntimeSharedWalletRiskSlice } from "../../../../engine/src/lib/replay-runtime-shared-wallet-risk-engine"
import type { ReplayArtifactStore } from "../../../../runner/src/lib/replay-artifact-store"
import { materializeReplayRuntimeSharedWalletRiskLanes } from "../../../../runner/src/lib/replay-runtime-shared-wallet-risk-runner"
import {
  publishReplayTwoCyclePortfolioArtifact,
} from "./replay-two-cycle-portfolio-artifact-publisher"
import type { ReplayTrialRunInput } from "../../../../runner/src/lib/replay-trial-runner"

export interface ReplayTwoCyclePortfolioRunInput {
  plan: ReplayTwoCyclePortfolioPlan
  cycle_1: ReplayIntegratedPortfolioOutcome
  cycle_2_reallocation_plan: ReplayPortfolioReallocationPlan
  cycle_2_reallocation_reservation: ReplayPortfolioReallocationReservationSnapshot
  cycle_2_reallocation: ReplayPortfolioReallocationOutcome
  cycle_2_allocation_plan: ReplayPortfolioAllocationPlan
  cycle_2_risk_plan: ReplayRuntimeSharedWalletRiskPlan
  cycle_2_risk_reservation: ReplayRuntimeSharedWalletRiskReservationSnapshot
  cycle_2_lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
  artifact_store: ReplayArtifactStore
  execute_risk_slice?: typeof executeReplayRuntimeSharedWalletRiskSlice
  publish_artifact?: typeof publishReplayTwoCyclePortfolioArtifact
}

export function runReplayTwoCyclePortfolio(
  input: ReplayTwoCyclePortfolioRunInput,
): ReplayTwoCyclePortfolioOutcome {
  let allocationAuthority: ReplayPortfolioAllocationAuthorityBinding
  let riskLanes
  try {
    assertReplayTwoCyclePortfolioPlan(input.plan)
    assertReplayPortfolioReallocationReservationSnapshot(input.cycle_2_reallocation_reservation)
    assertReplayRuntimeSharedWalletRiskReservationSnapshot(input.cycle_2_risk_reservation)
    assertReplayPortfolioReallocationPlan(input.cycle_2_reallocation_plan, input.cycle_2_allocation_plan)
    const release = assertReplayPortfolioReallocationPredecessor(
      input.cycle_1, input.cycle_2_reallocation_reservation,
    )
    const reallocation = input.cycle_2_reallocation
    if (reallocation.status !== "completed" || !reallocation.result || !reallocation.allocation_result
        || !reallocation.artifact_manifest) throw new Error("cycle-2 Reallocation evidence is incomplete")
    allocationAuthority = {
      reservation_hash: input.cycle_2_reallocation_reservation.reservation_hash,
      portfolio_id: input.cycle_2_reallocation_reservation.portfolio_id,
      portfolio_plan_hash: input.cycle_2_reallocation_reservation.portfolio_plan_hash,
      settlement_asset: input.cycle_2_reallocation_reservation.settlement_asset,
      shared_initial_cash: release.opening_cash,
      max_gross_exposure_amount: input.cycle_2_reallocation_reservation.max_gross_exposure_amount,
      max_abs_net_exposure_amount: input.cycle_2_reallocation_reservation.max_abs_net_exposure_amount,
      max_portfolio_risk_amount: input.cycle_2_reallocation_reservation.max_portfolio_risk_amount,
      lanes: input.cycle_2_reallocation_reservation.lanes.map(
        ({ lane_id, priority_rank, max_lane_risk_amount }) => ({ lane_id, priority_rank, max_lane_risk_amount }),
      ),
    }
    assertReplayPortfolioReallocationResult(
      reallocation.result, input.cycle_2_reallocation_plan, input.cycle_2_reallocation_reservation,
      input.cycle_1, reallocation.allocation_result,
    )
    const risk = input.cycle_2_risk_reservation
    const allocationLanes = input.cycle_2_reallocation_reservation.lanes
    if (input.plan.cycle_1_integrated_result_hash !== input.cycle_1.result?.result_hash
        || input.plan.cycle_1_artifact_manifest_hash !== input.cycle_1.artifact?.artifact_manifest?.manifest_hash
        || input.plan.cycle_2_reallocation_result_hash !== reallocation.result.result_hash
        || input.plan.cycle_2_reallocation_manifest_hash !== reallocation.artifact_manifest.manifest_hash
        || input.plan.cycle_2_allocation_plan_hash !== input.cycle_2_allocation_plan.plan_hash
        || input.plan.cycle_2_allocation_result_hash !== reallocation.allocation_result.result_hash
        || input.plan.cycle_2_risk_plan_hash !== input.cycle_2_risk_plan.plan_hash
        || input.plan.cycle_2_risk_reservation_hash !== risk.reservation_hash
        || risk.portfolio_id !== input.plan.portfolio_id || risk.portfolio_plan_hash !== input.cycle_2_risk_plan.plan_hash
        || risk.experiment_id !== input.cycle_2_reallocation_reservation.experiment_id
        || risk.trial_group_id !== input.cycle_2_reallocation_reservation.trial_group_id
        || risk.trial_group_hash !== input.cycle_2_reallocation_reservation.trial_group_hash
        || risk.settlement_asset !== input.cycle_2_reallocation_reservation.settlement_asset
        || risk.shared_initial_cash !== release.opening_cash || risk.lanes.length !== allocationLanes.length
        || risk.lanes.some((lane, index) => {
          const other = allocationLanes[index]
          return !other || lane.lane_id !== other.lane_id || lane.priority_rank !== other.priority_rank
            || lane.trial_id !== other.trial_id || lane.run_id !== other.run_id
            || lane.trial_reservation_ref !== other.trial_reservation_ref
            || lane.trial_reservation_hash !== other.trial_reservation_hash
        })) throw new Error("two-cycle Control Plane authority closure drift")
    riskLanes = materializeReplayRuntimeSharedWalletRiskLanes({
      plan: input.cycle_2_risk_plan,
      risk_reservation: input.cycle_2_risk_reservation,
      lanes: input.cycle_2_lanes,
    })
    if (riskLanes.some((lane) => lane.entry_time !== reallocation.result!.cycle_2_event_time
        || (lane.exit !== null && Date.parse(lane.exit.time) <= Date.parse(lane.entry_time)))) {
      throw new Error("cycle-2 lifecycle requires one Allocation time and only later exits")
    }
  } catch (error) {
    return failed(input, "two-cycle-input-invalid", error)
  }
  let riskResult
  try {
    riskResult = (input.execute_risk_slice ?? executeReplayRuntimeSharedWalletRiskSlice)({
      plan: input.cycle_2_risk_plan,
      authority: input.cycle_2_risk_reservation,
      lanes: riskLanes,
      allocation_result: input.cycle_2_reallocation.allocation_result!,
    })
  } catch (error) {
    return failed(input, "cycle-2-risk-failed", error)
  }
  try {
    const result = createReplayTwoCyclePortfolioResult({
      plan: input.plan,
      cycle_1: input.cycle_1,
      cycle_2_reallocation: input.cycle_2_reallocation,
      cycle_2_allocation_plan: input.cycle_2_allocation_plan,
      cycle_2_risk_plan: input.cycle_2_risk_plan,
      cycle_2_risk_authority: input.cycle_2_risk_reservation,
      cycle_2_allocation_authority: allocationAuthority,
      cycle_2_risk_result: riskResult,
    })
    const published = (input.publish_artifact ?? publishReplayTwoCyclePortfolioArtifact)({
      plan: input.plan,
      cycle_1: input.cycle_1,
      cycle_2_reallocation: input.cycle_2_reallocation,
      cycle_2_allocation_plan: input.cycle_2_allocation_plan,
      cycle_2_risk_plan: input.cycle_2_risk_plan,
      cycle_2_risk_reservation: input.cycle_2_risk_reservation,
      cycle_2_risk_result: riskResult,
      result,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayTwoCyclePortfolioOutcome, "outcome_hash"> = {
      schema_version: REPLAY_TWO_CYCLE_PORTFOLIO_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id,
      two_cycle_plan_hash: input.plan.plan_hash,
      status: "completed",
      result,
      cycle_2_risk_result: riskResult,
      artifact_manifest: published.manifest,
      idempotent_replay: published.idempotent_replay,
      failure: null,
    }
    const outcome = { ...body, outcome_hash: replayTwoCyclePortfolioOutcomeHash(body as ReplayTwoCyclePortfolioOutcome) }
    assertReplayTwoCyclePortfolioOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "two-cycle-artifact-failed", error)
  }
}

function failed(
  input: ReplayTwoCyclePortfolioRunInput,
  code: NonNullable<ReplayTwoCyclePortfolioOutcome["failure"]>["code"],
  error: unknown,
): ReplayTwoCyclePortfolioOutcome {
  const body: Omit<ReplayTwoCyclePortfolioOutcome, "outcome_hash"> = {
    schema_version: REPLAY_TWO_CYCLE_PORTFOLIO_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    two_cycle_plan_hash: input.plan.plan_hash,
    status: "failed",
    result: null,
    cycle_2_risk_result: null,
    artifact_manifest: null,
    idempotent_replay: false,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  const outcome = { ...body, outcome_hash: replayTwoCyclePortfolioOutcomeHash(body as ReplayTwoCyclePortfolioOutcome) }
  assertReplayTwoCyclePortfolioOutcome(outcome)
  return outcome
}
