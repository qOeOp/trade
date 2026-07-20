import {
  assertReplayRuntimeSharedWalletReservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplayRuntimeSharedWalletReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_RUNTIME_SHARED_WALLET_OUTCOME_SCHEMA_VERSION,
  assertReplayRuntimeSharedWalletOutcome,
  assertReplayRuntimeSharedWalletPlan,
  replayRuntimeSharedWalletOutcomeHash,
  type ReplayRuntimeSharedWalletOutcome,
  type ReplayRuntimeSharedWalletPlan,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  executeReplayRuntimeSharedWalletEntrySlice,
  type ReplayRuntimeSharedWalletEngineLane,
} from "../../../engine/src/lib/replay-runtime-shared-wallet-engine"
import type { ReplayTrialRunInput } from "./replay-trial-runner"

export interface ReplayRuntimeSharedWalletRunInput {
  plan: ReplayRuntimeSharedWalletPlan
  runtime_shared_wallet_reservation: ReplayRuntimeSharedWalletReservationSnapshot
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
  execute_entry_slice?: typeof executeReplayRuntimeSharedWalletEntrySlice
}

export function runReplayRuntimeSharedWalletEntrySlice(
  input: ReplayRuntimeSharedWalletRunInput,
): ReplayRuntimeSharedWalletOutcome {
  let engineLanes: ReplayRuntimeSharedWalletEngineLane[]
  try {
    engineLanes = validateAndMaterialize(input)
  } catch (error) {
    return failed(input, "runtime-shared-wallet-input-invalid", error)
  }
  try {
    const result = (input.execute_entry_slice ?? executeReplayRuntimeSharedWalletEntrySlice)({
      plan: input.plan,
      authority: input.runtime_shared_wallet_reservation,
      lanes: engineLanes,
    })
    const body: Omit<ReplayRuntimeSharedWalletOutcome, "outcome_hash"> = {
      schema_version: REPLAY_RUNTIME_SHARED_WALLET_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id,
      portfolio_plan_hash: input.plan.plan_hash,
      runtime_shared_wallet_reservation_hash: input.runtime_shared_wallet_reservation.reservation_hash,
      status: "completed",
      result,
      failure: null,
    }
    const outcome = { ...body, outcome_hash: replayRuntimeSharedWalletOutcomeHash(body) }
    assertReplayRuntimeSharedWalletOutcome(outcome, input.plan, input.runtime_shared_wallet_reservation)
    return outcome
  } catch (error) {
    return failed(input, "runtime-shared-wallet-engine-failed", error)
  }
}

function validateAndMaterialize(input: ReplayRuntimeSharedWalletRunInput): ReplayRuntimeSharedWalletEngineLane[] {
  assertReplayRuntimeSharedWalletPlan(input.plan)
  const authority = input.runtime_shared_wallet_reservation
  assertReplayRuntimeSharedWalletReservationSnapshot(authority)
  if (authority.portfolio_id !== input.plan.portfolio_id
      || authority.portfolio_plan_hash !== input.plan.plan_hash
      || authority.lanes.length !== input.plan.lanes.length
      || input.lanes.length !== input.plan.lanes.length) {
    throw new Error("runtime shared wallet Reservation does not bind the Plan")
  }
  const inputByLane = new Map(input.lanes.map((lane) => [lane.lane_id, lane.trial]))
  const authorityByLane = new Map(authority.lanes.map((lane) => [lane.lane_id, lane]))
  if (inputByLane.size !== input.plan.lanes.length || authorityByLane.size !== input.plan.lanes.length) {
    throw new Error("runtime shared wallet inputs do not exactly cover the Plan")
  }
  return input.plan.lanes.map((lane) => {
    const trial = inputByLane.get(lane.lane_id)
    const laneAuthority = authorityByLane.get(lane.lane_id)
    if (!trial || !laneAuthority) throw new Error(`runtime shared wallet lane ${lane.lane_id} is missing`)
    const request = trial.request
    const reservationHash = hashTrialReservationSnapshot(trial.trial_reservation)
    const leaseHash = hashReplayAttemptLeaseSnapshot(trial.attempt_lease)
    if (request.run_id !== lane.run_id || request.symbol !== lane.symbol
        || canonicalHash(request) !== lane.request_hash
        || reservationHash !== lane.trial_reservation_hash
        || leaseHash !== lane.attempt_lease_hash
        || request.trial_id !== laneAuthority.trial_id || request.run_id !== laneAuthority.run_id
        || trial.trial_reservation.reservation_ref !== laneAuthority.trial_reservation_ref
        || reservationHash !== laneAuthority.trial_reservation_hash
        || request.trial_reservation_ref !== trial.trial_reservation.reservation_ref
        || request.trial_reservation_hash !== reservationHash
        || trial.attempt_lease.trial_id !== request.trial_id
        || trial.attempt_lease.run_id !== request.run_id
        || trial.attempt_lease.reservation_hash !== reservationHash
        || trial.attempt_lease.request_hash !== lane.request_hash
        || Date.parse(trial.observed_at) < Date.parse(authority.issued_at)
        || Date.parse(trial.observed_at) >= Date.parse(authority.expires_at)
        || Date.parse(trial.observed_at) >= Date.parse(trial.attempt_lease.lease_expires_at)) {
      throw new Error(`runtime shared wallet lane ${lane.lane_id} authority drift`)
    }
    if (request.order.entry_execution.order_type !== "market"
        || request.simulator_policy.earliest_execution !== "next_open"
        || request.margin_policy.mode !== "isolated"
        || request.margin_policy.collateral_asset !== authority.settlement_asset
        || trial.dataset_manifest.instrument.accounting.settlement_asset !== authority.settlement_asset
        || trial.dataset_manifest.symbol !== request.symbol
        || trial.dataset_manifest.data_hash !== request.dataset_hash) {
      throw new Error(`runtime shared wallet lane ${lane.lane_id} is outside the certified capability subset`)
    }
    const bar = trial.bars.find((candidate) => candidate.open_time === request.order.earliest_executable_time)
    if (!bar) throw new Error(`runtime shared wallet lane ${lane.lane_id} lacks its earliest executable bar`)
    return {
      lane_id: lane.lane_id,
      request_hash: lane.request_hash,
      symbol: request.symbol,
      side: request.order.side,
      quantity: request.order.quantity,
      earliest_executable_time: request.order.earliest_executable_time,
      isolated_collateral: request.margin_policy.isolated_collateral,
      fee_bps: request.cost_policy.fee_bps,
      slippage_bps: request.cost_policy.slippage_bps,
      price_increment: trial.dataset_manifest.instrument.accounting.price_increment,
      settlement_increment: trial.dataset_manifest.instrument.accounting.settlement_increment,
      bar,
    }
  })
}

function failed(
  input: ReplayRuntimeSharedWalletRunInput,
  code: NonNullable<ReplayRuntimeSharedWalletOutcome["failure"]>["code"],
  error: unknown,
): ReplayRuntimeSharedWalletOutcome {
  const authority = input.runtime_shared_wallet_reservation
  const body: Omit<ReplayRuntimeSharedWalletOutcome, "outcome_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    portfolio_plan_hash: input.plan.plan_hash,
    runtime_shared_wallet_reservation_hash: authority.reservation_hash,
    status: "failed",
    result: null,
    failure: {
      code,
      message: error instanceof Error ? error.message : String(error),
      partial_result_published: false,
    },
  }
  return { ...body, outcome_hash: replayRuntimeSharedWalletOutcomeHash(body) }
}
