import {
  assertReplayRuntimeSharedWalletFundingReservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplayRuntimeSharedWalletFundingReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_RUNTIME_SHARED_WALLET_FUNDING_OUTCOME_SCHEMA_VERSION,
  assertReplayRuntimeSharedWalletFundingOutcome,
  assertReplayRuntimeSharedWalletFundingPlan,
  replayRuntimeSharedWalletFundingOutcomeHash,
  type ReplayRuntimeSharedWalletFundingOutcome,
  type ReplayRuntimeSharedWalletFundingPlan,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-funding-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  executeReplayRuntimeSharedWalletFundingSlice,
  type ReplayRuntimeSharedWalletFundingEngineLane,
} from "../../../engine/src/lib/replay-runtime-shared-wallet-funding-engine"
import type { ReplayTrialRunInput } from "./replay-trial-runner"

export interface ReplayRuntimeSharedWalletFundingRunInput {
  plan: ReplayRuntimeSharedWalletFundingPlan
  funding_reservation: ReplayRuntimeSharedWalletFundingReservationSnapshot
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
  execute_funding_slice?: typeof executeReplayRuntimeSharedWalletFundingSlice
}

export function runReplayRuntimeSharedWalletFundingSlice(
  input: ReplayRuntimeSharedWalletFundingRunInput,
): ReplayRuntimeSharedWalletFundingOutcome {
  let lanes: ReplayRuntimeSharedWalletFundingEngineLane[]
  try {
    lanes = materialize(input)
  } catch (error) {
    return failed(input, "runtime-shared-wallet-funding-input-invalid", error)
  }
  try {
    const result = (input.execute_funding_slice ?? executeReplayRuntimeSharedWalletFundingSlice)({
      plan: input.plan,
      authority: input.funding_reservation,
      lanes,
    })
    const body: Omit<ReplayRuntimeSharedWalletFundingOutcome, "outcome_hash"> = {
      schema_version: REPLAY_RUNTIME_SHARED_WALLET_FUNDING_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id,
      portfolio_plan_hash: input.plan.plan_hash,
      funding_reservation_hash: input.funding_reservation.reservation_hash,
      status: "completed",
      result,
      failure: null,
    }
    const outcome = { ...body, outcome_hash: replayRuntimeSharedWalletFundingOutcomeHash(body) }
    assertReplayRuntimeSharedWalletFundingOutcome(outcome, input.plan, input.funding_reservation)
    return outcome
  } catch (error) {
    return failed(input, "runtime-shared-wallet-funding-engine-failed", error)
  }
}

function materialize(input: ReplayRuntimeSharedWalletFundingRunInput): ReplayRuntimeSharedWalletFundingEngineLane[] {
  assertReplayRuntimeSharedWalletFundingPlan(input.plan)
  const authority = input.funding_reservation
  assertReplayRuntimeSharedWalletFundingReservationSnapshot(authority)
  if (authority.portfolio_id !== input.plan.portfolio_id || authority.portfolio_plan_hash !== input.plan.plan_hash
      || authority.lanes.length !== input.plan.lanes.length || input.lanes.length !== input.plan.lanes.length) {
    throw new Error("runtime shared wallet funding Reservation does not bind the Plan")
  }
  const inputByLane = new Map(input.lanes.map((lane) => [lane.lane_id, lane.trial]))
  const authorityByLane = new Map(authority.lanes.map((lane) => [lane.lane_id, lane]))
  if (inputByLane.size !== input.plan.lanes.length || authorityByLane.size !== input.plan.lanes.length) {
    throw new Error("runtime shared wallet funding inputs do not exactly cover the Plan")
  }
  return input.plan.lanes.map((lane) => {
    const trial = inputByLane.get(lane.lane_id)
    const laneAuthority = authorityByLane.get(lane.lane_id)
    if (!trial || !laneAuthority) throw new Error(`runtime shared wallet funding lane ${lane.lane_id} is missing`)
    const request = trial.request
    const reservationHash = hashTrialReservationSnapshot(trial.trial_reservation)
    const requestHash = canonicalHash(request)
    if (requestHash !== lane.request_hash || reservationHash !== lane.trial_reservation_hash
        || hashReplayAttemptLeaseSnapshot(trial.attempt_lease) !== lane.attempt_lease_hash
        || request.run_id !== lane.run_id || request.symbol !== lane.symbol
        || request.trial_id !== laneAuthority.trial_id || request.run_id !== laneAuthority.run_id
        || trial.trial_reservation.reservation_ref !== laneAuthority.trial_reservation_ref
        || reservationHash !== laneAuthority.trial_reservation_hash
        || request.trial_reservation_ref !== trial.trial_reservation.reservation_ref
        || request.trial_reservation_hash !== reservationHash
        || trial.attempt_lease.trial_id !== request.trial_id || trial.attempt_lease.run_id !== request.run_id
        || trial.attempt_lease.reservation_hash !== reservationHash || trial.attempt_lease.request_hash !== requestHash
        || Date.parse(trial.observed_at) < Date.parse(authority.issued_at)
        || Date.parse(trial.observed_at) >= Date.parse(authority.expires_at)
        || Date.parse(trial.observed_at) >= Date.parse(trial.attempt_lease.lease_expires_at)) {
      throw new Error(`runtime shared wallet funding lane ${lane.lane_id} authority drift`)
    }
    const entries = request.decision_schedule?.entries ?? []
    const exits = entries.filter((entry) => entry.expected_effect === "authorized_reduce_only_exit")
    if (exits.length > 1 || entries.some((entry) => ![
      "authorized_initial_order", "authorized_reduce_only_exit", "no_action",
    ].includes(entry.expected_effect))) {
      throw new Error(`runtime shared wallet funding lane ${lane.lane_id} has unsupported decision mutations`)
    }
    const exitIntent = exits[0]?.authorized_reduce_only_exit ?? null
    const expectedExitHash = exitIntent ? canonicalHash(exitIntent) : null
    if ((lane.scheduled_exit_time !== exitIntent?.earliest_executable_time
          && !(lane.scheduled_exit_time === null && exitIntent === null))
        || lane.exit_intent_hash !== expectedExitHash) {
      throw new Error(`runtime shared wallet funding lane ${lane.lane_id} exit authority drift`)
    }
    if (exitIntent && (exitIntent.order_type !== "market" || exitIntent.reduce_only !== true
        || exitIntent.quantity_policy !== "full_open_position"
        || exitIntent.side !== (request.order.side === "long" ? "sell" : "buy"))) {
      throw new Error(`runtime shared wallet funding lane ${lane.lane_id} exit is outside the certified subset`)
    }
    const fundingEvents = trial.funding_events ?? []
    let priorFundingTime = Number.NEGATIVE_INFINITY
    const fundingEventsValid = fundingEvents.every((event) => {
      const time = Date.parse(event.timestamp)
      const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(event.timestamp)
        && Number.isFinite(time) && time > priorFundingTime && Number.isFinite(event.rate)
        && Number.isFinite(event.mark_price) && event.mark_price > 0
      priorFundingTime = time
      return valid
    })
    if (lane.funding_event_count !== fundingEvents.length || lane.funding_events_hash !== canonicalHash(fundingEvents)
        || lane.settlement_increment !== trial.dataset_manifest.instrument.accounting.settlement_increment
        || !fundingEventsValid) {
      throw new Error(`runtime shared wallet funding lane ${lane.lane_id} funding authority drift`)
    }
    if (request.order.entry_execution.order_type !== "market"
        || request.simulator_policy.earliest_execution !== "next_open" || request.margin_policy.mode !== "isolated"
        || request.margin_policy.collateral_asset !== authority.settlement_asset
        || trial.dataset_manifest.instrument.accounting.settlement_asset !== authority.settlement_asset
        || trial.dataset_manifest.funding_availability !== "event_time"
        || trial.dataset_manifest.symbol !== request.symbol || trial.dataset_manifest.data_hash !== request.dataset_hash
        || (trial.mark_events?.length ?? 0) !== 0) {
      throw new Error(`runtime shared wallet funding lane ${lane.lane_id} is outside the certified capability subset`)
    }
    const entryBar = trial.bars.find((bar) => bar.open_time === request.order.earliest_executable_time)
    const exitBar = exitIntent
      ? trial.bars.find((bar) => bar.open_time === exitIntent.earliest_executable_time)
      : undefined
    if (!entryBar || (exitIntent && !exitBar)) {
      throw new Error(`runtime shared wallet funding lane ${lane.lane_id} lacks a frozen executable bar`)
    }
    return {
      lane_id: lane.lane_id,
      request_hash: requestHash,
      symbol: request.symbol,
      side: request.order.side,
      quantity: request.order.quantity,
      entry_time: request.order.earliest_executable_time,
      entry_bar: entryBar,
      exit: exitIntent ? { time: exitIntent.earliest_executable_time, intent_hash: expectedExitHash!, bar: exitBar! } : null,
      funding_events: structuredClone(fundingEvents),
      isolated_collateral: request.margin_policy.isolated_collateral,
      fee_bps: request.cost_policy.fee_bps,
      slippage_bps: request.cost_policy.slippage_bps,
      price_increment: trial.dataset_manifest.instrument.accounting.price_increment,
      settlement_increment: trial.dataset_manifest.instrument.accounting.settlement_increment,
    }
  })
}

function failed(
  input: ReplayRuntimeSharedWalletFundingRunInput,
  code: NonNullable<ReplayRuntimeSharedWalletFundingOutcome["failure"]>["code"],
  error: unknown,
): ReplayRuntimeSharedWalletFundingOutcome {
  const body: Omit<ReplayRuntimeSharedWalletFundingOutcome, "outcome_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_FUNDING_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    portfolio_plan_hash: input.plan.plan_hash,
    funding_reservation_hash: input.funding_reservation.reservation_hash,
    status: "failed",
    result: null,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  return { ...body, outcome_hash: replayRuntimeSharedWalletFundingOutcomeHash(body) }
}
