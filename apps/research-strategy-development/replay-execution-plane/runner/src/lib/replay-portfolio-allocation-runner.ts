import {
  assertReplayPortfolioAllocationReservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplayPortfolioAllocationReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_PORTFOLIO_ALLOCATION_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioAllocationOutcome,
  assertReplayPortfolioAllocationPlan,
  replayPortfolioAllocationOutcomeHash,
  type ReplayPortfolioAllocationOutcome,
  type ReplayPortfolioAllocationPlan,
} from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  executeReplayPortfolioAllocationSlice,
  type ReplayPortfolioAllocationEngineLane,
} from "../../../engine/src/lib/replay-portfolio-allocation-engine"
import type { ReplayTrialRunInput } from "./replay-trial-runner"

export interface ReplayPortfolioAllocationRunInput {
  plan: ReplayPortfolioAllocationPlan
  allocation_reservation: ReplayPortfolioAllocationReservationSnapshot
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
  execute_allocation_slice?: typeof executeReplayPortfolioAllocationSlice
}

export function runReplayPortfolioAllocationSlice(
  input: ReplayPortfolioAllocationRunInput,
): ReplayPortfolioAllocationOutcome {
  let lanes: ReplayPortfolioAllocationEngineLane[]
  try {
    assertReplayPortfolioAllocationPlan(input.plan)
    assertReplayPortfolioAllocationReservationSnapshot(input.allocation_reservation)
    lanes = materializeReplayPortfolioAllocationLanes({
      plan: input.plan, authority: input.allocation_reservation, lanes: input.lanes,
    })
  } catch (error) {
    return failed(input, "portfolio-allocation-input-invalid", error)
  }
  try {
    const result = (input.execute_allocation_slice ?? executeReplayPortfolioAllocationSlice)({
      plan: input.plan,
      authority: input.allocation_reservation,
      lanes,
    })
    const body: Omit<ReplayPortfolioAllocationOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_ALLOCATION_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id,
      portfolio_plan_hash: input.plan.plan_hash,
      portfolio_allocation_reservation_hash: input.allocation_reservation.reservation_hash,
      status: "completed",
      result,
      failure: null,
    }
    const outcome = { ...body, outcome_hash: replayPortfolioAllocationOutcomeHash(body as ReplayPortfolioAllocationOutcome) }
    assertReplayPortfolioAllocationOutcome(outcome, input.plan, input.allocation_reservation)
    return outcome
  } catch (error) {
    return failed(input, "portfolio-allocation-engine-failed", error)
  }
}

export interface ReplayPortfolioAllocationMaterializationAuthority {
  issued_at: string
  expires_at: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_id: string
    run_id: string
    trial_reservation_ref: string
    trial_reservation_hash: string
  }>
}

export interface ReplayPortfolioAllocationMaterializeInput {
  plan: ReplayPortfolioAllocationPlan
  authority: ReplayPortfolioAllocationMaterializationAuthority
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
}

export function materializeReplayPortfolioAllocationLanes(
  input: ReplayPortfolioAllocationMaterializeInput,
): ReplayPortfolioAllocationEngineLane[] {
  assertReplayPortfolioAllocationPlan(input.plan)
  const authority = input.authority
  if (authority.portfolio_id !== input.plan.portfolio_id || authority.portfolio_plan_hash !== input.plan.plan_hash
      || authority.lanes.length !== input.plan.lanes.length || input.lanes.length !== input.plan.lanes.length) {
    throw new Error("Portfolio Allocation Reservation does not bind the Plan")
  }
  const trialByLane = new Map(input.lanes.map((lane) => [lane.lane_id, lane.trial]))
  const authorityByLane = new Map(authority.lanes.map((lane) => [lane.lane_id, lane]))
  if (trialByLane.size !== input.plan.lanes.length || authorityByLane.size !== input.plan.lanes.length) {
    throw new Error("Portfolio Allocation inputs do not exactly cover the Plan")
  }
  return input.plan.lanes.map((lane) => {
    const trial = trialByLane.get(lane.lane_id)
    const laneAuthority = authorityByLane.get(lane.lane_id)
    if (!trial || !laneAuthority) throw new Error(`Portfolio Allocation lane ${lane.lane_id} is missing`)
    const request = trial.request
    const manifest = trial.dataset_manifest
    const reservationHash = hashTrialReservationSnapshot(trial.trial_reservation)
    const leaseHash = hashReplayAttemptLeaseSnapshot(trial.attempt_lease)
    const accounting = manifest.instrument.accounting
    if (request.run_id !== lane.run_id || request.symbol !== lane.symbol || canonicalHash(request) !== lane.request_hash
        || reservationHash !== lane.trial_reservation_hash || leaseHash !== lane.attempt_lease_hash
        || request.trial_id !== laneAuthority.trial_id || request.run_id !== laneAuthority.run_id
        || trial.trial_reservation.reservation_ref !== laneAuthority.trial_reservation_ref
        || reservationHash !== laneAuthority.trial_reservation_hash
        || request.trial_reservation_ref !== trial.trial_reservation.reservation_ref
        || request.trial_reservation_hash !== reservationHash
        || trial.attempt_lease.trial_id !== request.trial_id || trial.attempt_lease.run_id !== request.run_id
        || trial.attempt_lease.reservation_hash !== reservationHash
        || trial.attempt_lease.request_hash !== lane.request_hash
        || Date.parse(trial.observed_at) < Date.parse(authority.issued_at)
        || Date.parse(trial.observed_at) >= Date.parse(authority.expires_at)
        || Date.parse(trial.observed_at) >= Date.parse(trial.attempt_lease.lease_expires_at)) {
      throw new Error(`Portfolio Allocation lane ${lane.lane_id} authority drift`)
    }
    if (request.order.entry_execution.order_type !== "market"
        || request.simulator_policy.earliest_execution !== "next_open" || request.margin_policy.mode !== "isolated"
        || request.margin_policy.collateral_asset !== authority.settlement_asset
        || accounting.settlement_asset !== authority.settlement_asset || accounting.contract_multiplier !== "1"
        || manifest.symbol !== request.symbol || manifest.data_hash !== request.dataset_hash
        || request.order.side !== lane.side || request.order.quantity !== lane.quantity
        || request.order.earliest_executable_time !== lane.earliest_executable_time
        || request.order.stop_price !== lane.stop_price
        || request.margin_policy.isolated_collateral !== lane.isolated_collateral
        || request.cost_policy.fee_bps !== lane.fee_bps || request.cost_policy.slippage_bps !== lane.slippage_bps
        || accounting.price_increment !== lane.price_increment
        || accounting.settlement_increment !== lane.settlement_increment) {
      throw new Error(`Portfolio Allocation lane ${lane.lane_id} is outside the certified capability subset`)
    }
    const bar = trial.bars.find((candidate) => candidate.open_time === lane.earliest_executable_time)
    if (!bar) throw new Error(`Portfolio Allocation lane ${lane.lane_id} lacks its earliest executable bar`)
    return {
      lane_id: lane.lane_id,
      request_hash: lane.request_hash,
      symbol: lane.symbol,
      side: lane.side,
      quantity: lane.quantity,
      earliest_executable_time: lane.earliest_executable_time,
      stop_price: lane.stop_price,
      isolated_collateral: lane.isolated_collateral,
      fee_bps: lane.fee_bps,
      slippage_bps: lane.slippage_bps,
      price_increment: lane.price_increment,
      settlement_increment: lane.settlement_increment,
      bar,
    }
  })
}

function failed(
  input: ReplayPortfolioAllocationRunInput,
  code: NonNullable<ReplayPortfolioAllocationOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioAllocationOutcome {
  const body: Omit<ReplayPortfolioAllocationOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_ALLOCATION_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    portfolio_plan_hash: input.plan.plan_hash,
    portfolio_allocation_reservation_hash: input.allocation_reservation.reservation_hash,
    status: "failed",
    result: null,
    failure: {
      code,
      message: error instanceof Error ? error.message : String(error),
      partial_result_published: false,
    },
  }
  return { ...body, outcome_hash: replayPortfolioAllocationOutcomeHash(body as ReplayPortfolioAllocationOutcome) }
}
