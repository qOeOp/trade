import {
  assertReplayPortfolioReallocationReservationSnapshot,
  type ReplayPortfolioReallocationReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayIntegratedPortfolioOutcome } from "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import type {
  ReplayPortfolioAllocationAuthorityBinding,
  ReplayPortfolioAllocationPlan,
} from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import {
  REPLAY_PORTFOLIO_REALLOCATION_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioReallocationOutcome,
  assertReplayPortfolioReallocationPlan,
  assertReplayPortfolioReallocationPredecessor,
  createReplayPortfolioReallocationResult,
  replayPortfolioReallocationOutcomeHash,
  type ReplayPortfolioReallocationOutcome,
  type ReplayPortfolioReallocationPlan,
} from "../../../contracts/src/lib/replay-portfolio-reallocation-contracts"
import { executeReplayPortfolioAllocationSlice } from "../../../engine/src/lib/replay-portfolio-allocation-engine"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import {
  materializeReplayPortfolioAllocationLanes,
} from "./replay-portfolio-allocation-runner"
import {
  publishReplayPortfolioReallocationArtifact,
} from "./replay-portfolio-reallocation-artifact-publisher"
import type { ReplayTrialRunInput } from "./replay-trial-runner"

export interface ReplayPortfolioReallocationRunInput {
  plan: ReplayPortfolioReallocationPlan
  reservation: ReplayPortfolioReallocationReservationSnapshot
  predecessor: ReplayIntegratedPortfolioOutcome
  allocation_plan: ReplayPortfolioAllocationPlan
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
  artifact_store: ReplayArtifactStore
  execute_allocation_slice?: typeof executeReplayPortfolioAllocationSlice
  publish_artifact?: typeof publishReplayPortfolioReallocationArtifact
}

export function runReplayPortfolioReallocation(
  input: ReplayPortfolioReallocationRunInput,
): ReplayPortfolioReallocationOutcome {
  let authority: ReplayPortfolioAllocationAuthorityBinding
  let lanes
  try {
    assertReplayPortfolioReallocationReservationSnapshot(input.reservation)
    assertReplayPortfolioReallocationPlan(input.plan, input.allocation_plan)
    const release = assertReplayPortfolioReallocationPredecessor(input.predecessor, input.reservation)
    if (input.plan.reallocation_reservation_hash !== input.reservation.reservation_hash
        || input.plan.predecessor_integrated_result_hash !== input.reservation.predecessor_integrated_result_hash
        || input.plan.predecessor_artifact_manifest_hash !== input.reservation.predecessor_artifact_manifest_hash
        || input.reservation.portfolio_id !== input.plan.portfolio_id
        || input.reservation.portfolio_plan_hash !== input.allocation_plan.plan_hash
        || Date.parse(input.plan.cycle_2_event_time) < Date.parse(input.reservation.earliest_reallocation_time)
        || Date.parse(input.plan.cycle_2_event_time) <= Date.parse(release.event_time)) {
      throw new Error("reallocation authority, predecessor, or event-time closure drift")
    }
    authority = {
      reservation_hash: input.reservation.reservation_hash,
      portfolio_id: input.reservation.portfolio_id,
      portfolio_plan_hash: input.reservation.portfolio_plan_hash,
      settlement_asset: input.reservation.settlement_asset,
      shared_initial_cash: release.opening_cash,
      max_gross_exposure_amount: input.reservation.max_gross_exposure_amount,
      max_abs_net_exposure_amount: input.reservation.max_abs_net_exposure_amount,
      max_portfolio_risk_amount: input.reservation.max_portfolio_risk_amount,
      lanes: input.reservation.lanes.map(({ lane_id, priority_rank, max_lane_risk_amount }) => ({
        lane_id, priority_rank, max_lane_risk_amount,
      })),
    }
    lanes = materializeReplayPortfolioAllocationLanes({
      plan: input.allocation_plan, authority: input.reservation, lanes: input.lanes,
    })
  } catch (error) {
    return failed(input, "reallocation-input-invalid", error)
  }
  let allocationResult
  try {
    allocationResult = (input.execute_allocation_slice ?? executeReplayPortfolioAllocationSlice)({
      plan: input.allocation_plan, authority, lanes,
    })
  } catch (error) {
    return failed(input, "reallocation-allocation-failed", error)
  }
  try {
    const result = createReplayPortfolioReallocationResult({
      plan: input.plan, reservation: input.reservation, predecessor: input.predecessor,
      allocation_plan: input.allocation_plan, allocation_result: allocationResult, authority_binding: authority,
    })
    const published = (input.publish_artifact ?? publishReplayPortfolioReallocationArtifact)({
      plan: input.plan, reservation: input.reservation, predecessor: input.predecessor,
      allocation_plan: input.allocation_plan, allocation_result: allocationResult, result,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioReallocationOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_REALLOCATION_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id,
      reallocation_plan_hash: input.plan.plan_hash,
      status: "completed",
      result,
      allocation_result: allocationResult,
      artifact_manifest: published.manifest,
      idempotent_replay: published.idempotent_replay,
      failure: null,
    }
    const outcome = { ...body, outcome_hash: replayPortfolioReallocationOutcomeHash(body as ReplayPortfolioReallocationOutcome) }
    assertReplayPortfolioReallocationOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "reallocation-artifact-failed", error)
  }
}

function failed(
  input: ReplayPortfolioReallocationRunInput,
  code: NonNullable<ReplayPortfolioReallocationOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioReallocationOutcome {
  const body: Omit<ReplayPortfolioReallocationOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_REALLOCATION_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    reallocation_plan_hash: input.plan.plan_hash,
    status: "failed",
    result: null,
    allocation_result: null,
    artifact_manifest: null,
    idempotent_replay: false,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  const outcome = { ...body, outcome_hash: replayPortfolioReallocationOutcomeHash(body as ReplayPortfolioReallocationOutcome) }
  assertReplayPortfolioReallocationOutcome(outcome)
  return outcome
}
