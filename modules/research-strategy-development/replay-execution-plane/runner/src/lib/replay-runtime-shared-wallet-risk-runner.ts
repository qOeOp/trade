import {
  assertReplayRuntimeSharedWalletRiskReservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplayRuntimeSharedWalletRiskReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_RUNTIME_SHARED_WALLET_RISK_OUTCOME_SCHEMA_VERSION,
  assertReplayRuntimeSharedWalletRiskOutcome,
  assertReplayRuntimeSharedWalletRiskPlan,
  replayRuntimeSharedWalletRiskOutcomeHash,
  type ReplayRuntimeSharedWalletRiskOutcome,
  type ReplayRuntimeSharedWalletRiskPlan,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash, replayDatasetHash } from "../../../contracts/src/lib/replay-contracts"
import { isReplayIncrementAligned } from "../../../contracts/src/lib/replay-decimal"
import {
  executeReplayRuntimeSharedWalletRiskSlice,
  type ReplayRuntimeSharedWalletRiskEngineLane,
} from "../../../engine/src/lib/replay-runtime-shared-wallet-risk-engine"
import type { ReplayTrialRunInput } from "./replay-trial-runner"

export interface ReplayRuntimeSharedWalletRiskRunInput {
  plan: ReplayRuntimeSharedWalletRiskPlan
  risk_reservation: ReplayRuntimeSharedWalletRiskReservationSnapshot
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
  execute_risk_slice?: typeof executeReplayRuntimeSharedWalletRiskSlice
  allow_predeclared_protective_stop_replacement_projection?: true
  allow_predeclared_take_profit_replacement_projection?: true
  allow_predeclared_take_profit_cancel_projection?: true
  allow_predeclared_protective_stop_cancel_projection?: true
  allow_predeclared_strategy_exit_cancel_projection?: true
  allow_predeclared_fixed_partial_reduce_projection?: true
}

export interface ReplayRuntimeSharedWalletRiskMaterializationAuthority {
  reservation_hash: string
  issued_at: string
  expires_at: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_id: string
    run_id: string
    trial_reservation_ref: string
    trial_reservation_hash: string
  }>
}

export interface ReplayRuntimeSharedWalletRiskMaterializeInput {
  plan: ReplayRuntimeSharedWalletRiskPlan
  risk_reservation: ReplayRuntimeSharedWalletRiskMaterializationAuthority
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
  allow_predeclared_protective_stop_replacement_projection?: true
  allow_predeclared_take_profit_replacement_projection?: true
  allow_predeclared_take_profit_cancel_projection?: true
  allow_predeclared_protective_stop_cancel_projection?: true
  allow_predeclared_strategy_exit_cancel_projection?: true
  allow_predeclared_fixed_partial_reduce_projection?: true
}

export function runReplayRuntimeSharedWalletRiskSlice(
  input: ReplayRuntimeSharedWalletRiskRunInput,
): ReplayRuntimeSharedWalletRiskOutcome {
  let lanes: ReplayRuntimeSharedWalletRiskEngineLane[]
  try {
    assertReplayRuntimeSharedWalletRiskReservationSnapshot(input.risk_reservation)
    lanes = materializeReplayRuntimeSharedWalletRiskLanes(input)
  } catch (error) {
    return failed(input, "runtime-shared-wallet-risk-input-invalid", error)
  }
  try {
    const result = (input.execute_risk_slice ?? executeReplayRuntimeSharedWalletRiskSlice)({
      plan: input.plan,
      authority: input.risk_reservation,
      lanes,
    })
    const body: Omit<ReplayRuntimeSharedWalletRiskOutcome, "outcome_hash"> = {
      schema_version: REPLAY_RUNTIME_SHARED_WALLET_RISK_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id,
      portfolio_plan_hash: input.plan.plan_hash,
      risk_reservation_hash: input.risk_reservation.reservation_hash,
      status: "completed",
      result,
      failure: null,
    }
    const outcome = { ...body, outcome_hash: replayRuntimeSharedWalletRiskOutcomeHash(body) }
    assertReplayRuntimeSharedWalletRiskOutcome(outcome, input.plan, input.risk_reservation)
    return outcome
  } catch (error) {
    return failed(input, "runtime-shared-wallet-risk-engine-failed", error)
  }
}

export function materializeReplayRuntimeSharedWalletRiskLanes(
  input: ReplayRuntimeSharedWalletRiskMaterializeInput,
): ReplayRuntimeSharedWalletRiskEngineLane[] {
  assertReplayRuntimeSharedWalletRiskPlan(input.plan)
  const authority = input.risk_reservation
  if (authority.portfolio_id !== input.plan.portfolio_id || authority.portfolio_plan_hash !== input.plan.plan_hash
      || authority.lanes.length !== input.plan.lanes.length || input.lanes.length !== input.plan.lanes.length) {
    throw new Error("runtime shared wallet risk Reservation does not bind the Plan")
  }
  const inputByLane = new Map(input.lanes.map((lane) => [lane.lane_id, lane.trial]))
  const authorityByLane = new Map(authority.lanes.map((lane) => [lane.lane_id, lane]))
  if (inputByLane.size !== input.plan.lanes.length || authorityByLane.size !== input.plan.lanes.length) {
    throw new Error("runtime shared wallet risk inputs do not exactly cover the Plan")
  }
  return input.plan.lanes.map((lane) => {
    const trial = inputByLane.get(lane.lane_id)
    const laneAuthority = authorityByLane.get(lane.lane_id)
    if (!trial || !laneAuthority) throw new Error(`runtime shared wallet risk lane ${lane.lane_id} is missing`)
    const request = trial.request
    const manifest = trial.dataset_manifest
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
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} authority drift`)
    }
    const entries = request.decision_schedule?.entries ?? []
    const exits = entries.filter((entry) => entry.expected_effect === "authorized_reduce_only_exit")
    const replacements = entries.filter((entry) => entry.expected_effect === "authorized_protective_stop_replace")
    const targetReplacements = entries.filter((entry) => entry.expected_effect === "authorized_take_profit_replace")
    const targetCancels = entries.filter((entry) => entry.expected_effect === "authorized_take_profit_cancel")
    const protectiveStopCancels = entries.filter(
      (entry) => entry.expected_effect === "authorized_protective_stop_cancel",
    )
    const strategyExitCancels = entries.filter((entry) => entry.expected_effect === "authorized_strategy_exit_cancel")
    const partialReduces = entries.filter((entry) => entry.expected_effect === "authorized_partial_reduce")
    const allowedEffects = ["authorized_initial_order", "authorized_reduce_only_exit", "no_action"]
    if (input.allow_predeclared_protective_stop_replacement_projection) {
      allowedEffects.push("authorized_protective_stop_replace")
    }
    if (input.allow_predeclared_take_profit_replacement_projection) {
      allowedEffects.push("authorized_take_profit_replace")
    }
    if (input.allow_predeclared_take_profit_cancel_projection) {
      allowedEffects.push("authorized_take_profit_cancel")
    }
    if (input.allow_predeclared_protective_stop_cancel_projection) {
      allowedEffects.push("authorized_protective_stop_cancel")
    }
    if (input.allow_predeclared_strategy_exit_cancel_projection) {
      allowedEffects.push("authorized_strategy_exit_cancel")
    }
    if (input.allow_predeclared_fixed_partial_reduce_projection) {
      allowedEffects.push("authorized_partial_reduce")
    }
    const mutationCount = replacements.length + targetReplacements.length + targetCancels.length
      + protectiveStopCancels.length
    if (exits.length > 1 || replacements.length > 1 || targetReplacements.length > 1 || targetCancels.length > 1
        || protectiveStopCancels.length > 1
        || strategyExitCancels.length > 1
        || partialReduces.length > 1
        || mutationCount > 1
        || replacements.length > 0 && !input.allow_predeclared_protective_stop_replacement_projection
        || targetReplacements.length > 0 && !input.allow_predeclared_take_profit_replacement_projection
        || targetCancels.length > 0 && !input.allow_predeclared_take_profit_cancel_projection
        || protectiveStopCancels.length > 0 && !input.allow_predeclared_protective_stop_cancel_projection
        || strategyExitCancels.length > 0 && !input.allow_predeclared_strategy_exit_cancel_projection
        || partialReduces.length > 0 && !input.allow_predeclared_fixed_partial_reduce_projection
        || entries.some((entry) => !allowedEffects.includes(entry.expected_effect))) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} has unsupported decision mutations`)
    }
    const replacementIntent = replacements[0]?.authorized_protective_stop_replace ?? null
    if (replacements[0] && (!replacementIntent
        || replacements[0].authorized_order_hash !== canonicalHash(replacementIntent)
        || replacementIntent.order_type !== "stop_market" || replacementIntent.reduce_only !== true
        || replacementIntent.quantity_policy !== "full_open_position"
        || replacementIntent.replace_policy !== "tighten_only_cancel_then_submit"
        || replacementIntent.previous_stop_price !== request.order.stop_price
        || replacementIntent.side !== (request.order.side === "long" ? "sell" : "buy")
        || request.order.side === "long" && !(request.order.stop_price < replacementIntent.new_stop_price
          && replacementIntent.new_stop_price < request.order.target_price)
        || request.order.side === "short" && !(request.order.target_price < replacementIntent.new_stop_price
          && replacementIntent.new_stop_price < request.order.stop_price))) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} replacement projection drift`)
    }
    const targetReplacementIntent = targetReplacements[0]?.authorized_take_profit_replace ?? null
    if (targetReplacements[0] && (!targetReplacementIntent
        || targetReplacements[0].authorized_order_hash !== canonicalHash(targetReplacementIntent)
        || targetReplacementIntent.order_type !== "take_profit_market"
        || targetReplacementIntent.reduce_only !== true
        || targetReplacementIntent.quantity_policy !== "full_open_position"
        || targetReplacementIntent.replace_policy !== "cancel_then_submit_not_already_triggered"
        || targetReplacementIntent.stop_preservation_policy !== "require_active_full_position_stop"
        || targetReplacementIntent.schedule_combination_policy
          !== "initial_bracket_only_no_other_position_mutation"
        || targetReplacementIntent.reason_code !== "take_profit_repriced"
        || targetReplacementIntent.previous_target_price !== request.order.target_price
        || targetReplacementIntent.new_target_price === request.order.target_price
        || targetReplacementIntent.side !== (request.order.side === "long" ? "sell" : "buy")
        || request.order.side === "long" && !(targetReplacementIntent.new_target_price
          > request.order.stop_price)
        || request.order.side === "short" && !(targetReplacementIntent.new_target_price
          < request.order.stop_price))) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} target replacement projection drift`)
    }
    const targetCancelIntent = targetCancels[0]?.authorized_take_profit_cancel ?? null
    if (targetCancels[0] && (!targetCancelIntent
        || targetCancels[0].authorized_order_hash !== canonicalHash(targetCancelIntent)
        || targetCancelIntent.target_order_role !== "target"
        || targetCancelIntent.target_order_type !== "take_profit_market"
        || targetCancelIntent.target_order_id !== `${request.run_id}:order:target`
        || targetCancelIntent.cancel_policy !== "cancel_active_target_preserve_stop"
        || targetCancelIntent.stop_preservation_policy !== "require_active_full_position_stop"
        || targetCancelIntent.schedule_combination_policy
          !== "initial_bracket_only_no_other_position_mutation"
        || targetCancelIntent.reason_code !== "take_profit_condition_revoked")) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} target cancel projection drift`)
    }
    const protectiveStopCancelIntent = protectiveStopCancels[0]?.authorized_protective_stop_cancel ?? null
    if (protectiveStopCancels[0] && (!protectiveStopCancelIntent || exits.length > 0
        || protectiveStopCancels[0].authorized_order_hash !== canonicalHash(protectiveStopCancelIntent)
        || protectiveStopCancelIntent.target_order_role !== "stop"
        || protectiveStopCancelIntent.target_order_type !== "stop_market"
        || protectiveStopCancelIntent.target_order_id !== `${request.run_id}:order:stop`
        || protectiveStopCancelIntent.cancel_policy !== "cancel_active_stop_preserve_target"
        || protectiveStopCancelIntent.target_preservation_policy !== "require_active_full_position_target"
        || protectiveStopCancelIntent.schedule_combination_policy
          !== "initial_bracket_only_no_other_position_mutation"
        || protectiveStopCancelIntent.reason_code !== "protective_stop_condition_revoked"
        || protectiveStopCancelIntent.effective_at !== protectiveStopCancels[0].decision_time
        || Date.parse(protectiveStopCancelIntent.effective_at)
          <= Date.parse(request.order.earliest_executable_time))) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} protective stop cancel projection drift`)
    }
    const strategyExitCancelIntent = strategyExitCancels[0]?.authorized_strategy_exit_cancel ?? null
    if (strategyExitCancels[0] && (!strategyExitCancelIntent || !exits[0]
        || strategyExitCancels[0].authorized_order_hash !== canonicalHash(strategyExitCancelIntent)
        || strategyExitCancelIntent.target_order_role !== "strategy_exit"
        || strategyExitCancelIntent.target_exit_decision_sequence !== exits[0].decision_sequence
        || strategyExitCancelIntent.cancel_policy !== "cancel_submitted_before_earliest_executable_time"
        || strategyExitCancelIntent.reason_code !== "strategy_exit_condition_revoked"
        || strategyExitCancelIntent.effective_at !== strategyExitCancels[0].decision_time
        || !exits[0].authorized_reduce_only_exit
        || Date.parse(strategyExitCancelIntent.effective_at)
          <= Date.parse(exits[0].authorized_reduce_only_exit.signal_time)
        || Date.parse(strategyExitCancelIntent.effective_at)
          >= Date.parse(exits[0].authorized_reduce_only_exit.earliest_executable_time))) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} strategy exit cancel projection drift`)
    }
    const partialIntent = partialReduces[0]?.authorized_partial_reduce ?? null
    if (partialReduces[0] && (!partialIntent
        || partialReduces[0].authorized_order_hash !== canonicalHash(partialIntent)
        || partialIntent.order_type !== "market" || partialIntent.reduce_only !== true
        || partialIntent.quantity_policy !== "fixed_quantity" || partialIntent.quantity <= 0
        || partialIntent.quantity >= request.order.quantity
        || partialIntent.post_fill_position_policy !== "must_remain_open"
        || partialIntent.protection_resize_policy
          !== "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary"
        || partialIntent.replacement_trigger_policy !== "preserve_current_stop_and_target_prices"
        || partialIntent.remaining_quantity_authority !== "absolute_post_fill_position"
        || partialIntent.schedule_combination_policy
          !== "one_partial_reduce_then_optional_final_full_exit_no_stop_replace"
        || partialIntent.side !== (request.order.side === "long" ? "sell" : "buy")
        || partialIntent.earliest_executable_time !== partialReduces[0].decision_time)) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} partial-reduce projection drift`)
    }
    const exitIntent = exits[0]?.authorized_reduce_only_exit ?? null
    const expectedExitHash = exitIntent ? canonicalHash(exitIntent) : null
    if ((lane.scheduled_exit_time !== exitIntent?.earliest_executable_time
          && !(lane.scheduled_exit_time === null && exitIntent === null))
        || lane.exit_intent_hash !== expectedExitHash) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} exit authority drift`)
    }
    if (exitIntent && (exitIntent.order_type !== "market" || exitIntent.reduce_only !== true
        || exitIntent.quantity_policy !== "full_open_position"
        || exitIntent.side !== (request.order.side === "long" ? "sell" : "buy"))) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} exit is outside the certified subset`)
    }
    const fundingEvents = trial.funding_events ?? []
    let priorFundingTime = Number.NEGATIVE_INFINITY
    const fundingEventsValid = fundingEvents.every((event) => {
      const time = Date.parse(event.timestamp)
      const valid = utc(event.timestamp) && time > priorFundingTime && Number.isFinite(event.rate)
        && Number.isFinite(event.mark_price) && event.mark_price > 0
      priorFundingTime = time
      return valid
    })
    const markEvents = trial.mark_events ?? []
    let priorMarkTime = Number.NEGATIVE_INFINITY
    let priorSourceSequence = -1
    const markEventsValid = markEvents.every((event) => {
      const time = Date.parse(event.timestamp)
      const valid = utc(event.timestamp) && event.available_at === event.timestamp && time > priorMarkTime
        && Number.isSafeInteger(event.source_sequence) && event.source_sequence > priorSourceSequence
        && Number.isFinite(event.mark_price) && event.mark_price > 0
        && isReplayIncrementAligned(event.mark_price, manifest.instrument.accounting.price_increment)
      priorMarkTime = time
      priorSourceSequence = event.source_sequence
      return valid
    })
    const expectedMarkCount = manifest.mark_interval_ms === null ? -1
      : (Date.parse(manifest.last_close_time) - Date.parse(manifest.first_open_time)) / manifest.mark_interval_ms + 1
    const markGridValid = Number.isSafeInteger(expectedMarkCount) && expectedMarkCount === markEvents.length
      && markEvents.every((event, index) => Date.parse(event.timestamp)
        === Date.parse(manifest.first_open_time) + index * manifest.mark_interval_ms!)
    if (lane.funding_event_count !== fundingEvents.length || lane.funding_events_hash !== canonicalHash(fundingEvents)
        || lane.mark_event_count !== markEvents.length || lane.mark_events_hash !== canonicalHash(markEvents)
        || lane.price_increment !== manifest.instrument.accounting.price_increment
        || lane.settlement_increment !== manifest.instrument.accounting.settlement_increment
        || lane.contract_multiplier !== manifest.instrument.accounting.contract_multiplier
        || lane.fee_bps !== request.cost_policy.fee_bps || lane.slippage_bps !== request.cost_policy.slippage_bps
        || lane.venue_risk_policy_epochs_hash !== canonicalHash(manifest.venue_risk_policy_epochs)
        || JSON.stringify(lane.venue_risk_policy_epochs) !== JSON.stringify(manifest.venue_risk_policy_epochs)
        || lane.instrument_status_epochs_hash !== canonicalHash(manifest.instrument.status_epochs)
        || JSON.stringify(lane.instrument_status_epochs) !== JSON.stringify(manifest.instrument.status_epochs)
        || !fundingEventsValid || !markEventsValid || !markGridValid) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} source authority drift`)
    }
    const entryRisk = resolveRisk(manifest.venue_risk_policy_epochs, request.order.earliest_executable_time)
    if (request.margin_policy.initial_margin_rate !== entryRisk.initial_margin_rate
        || canonicalHash(request.margin_policy.maintenance_tier) !== canonicalHash(entryRisk.maintenance_tier)
        || manifest.venue_risk_policy_epochs.some(
          (snapshot) => snapshot.liquidation_fee_bps !== request.cost_policy.liquidation_fee_bps,
        )) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} risk and cost policy drift`)
    }
    const supplementalFacts = trial.supplemental_facts ?? []
    if (request.order.entry_execution.order_type !== "market"
        || request.simulator_policy.earliest_execution !== "next_open" || request.margin_policy.mode !== "isolated"
        || request.margin_policy.collateral_asset !== authority.settlement_asset
        || manifest.instrument.accounting.settlement_asset !== authority.settlement_asset
        || manifest.instrument.accounting.contract_multiplier !== "1"
        || manifest.funding_availability !== "event_time" || manifest.mark_availability !== "event_time"
        || manifest.mark_coverage !== "complete_grid" || manifest.mark_event_count !== markEvents.length
        || manifest.instrument.status_history !== "complete"
        || manifest.symbol !== request.symbol || manifest.data_hash !== request.dataset_hash
        || replayDatasetHash(trial.bars, fundingEvents, markEvents, supplementalFacts) !== manifest.data_hash) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} is outside the certified capability subset`)
    }
    const entryBar = trial.bars.find((bar) => bar.open_time === request.order.earliest_executable_time)
    const exitBar = exitIntent
      ? trial.bars.find((bar) => bar.open_time === exitIntent.earliest_executable_time)
      : undefined
    if (!entryBar || (exitIntent && !exitBar)
        || Date.parse(markEvents.at(-1)!.timestamp) <= Date.parse(request.order.earliest_executable_time)) {
      throw new Error(`runtime shared wallet risk lane ${lane.lane_id} lacks a frozen executable or terminal mark boundary`)
    }
    return {
      lane_id: lane.lane_id,
      request_hash: requestHash,
      symbol: request.symbol,
      side: request.order.side,
      quantity: request.order.quantity,
      entry_time: request.order.earliest_executable_time,
      entry_bar: entryBar,
      exit: exitIntent && !strategyExitCancelIntent
        ? { time: exitIntent.earliest_executable_time, intent_hash: expectedExitHash!, bar: exitBar! }
        : null,
      cancelled_exit: exitIntent && strategyExitCancelIntent ? {
        time: exitIntent.earliest_executable_time,
        intent_hash: expectedExitHash!,
        cancel_time: strategyExitCancelIntent.effective_at,
        cancel_intent_hash: canonicalHash(strategyExitCancelIntent),
      } : null,
      funding_events: structuredClone(fundingEvents),
      mark_events: structuredClone(markEvents),
      venue_risk_policy_epochs: structuredClone(manifest.venue_risk_policy_epochs),
      instrument_status_epochs: structuredClone(manifest.instrument.status_epochs),
      isolated_collateral: request.margin_policy.isolated_collateral,
      fee_bps: request.cost_policy.fee_bps,
      slippage_bps: request.cost_policy.slippage_bps,
      price_increment: manifest.instrument.accounting.price_increment,
      settlement_increment: manifest.instrument.accounting.settlement_increment,
    }
  })
}

function failed(
  input: ReplayRuntimeSharedWalletRiskRunInput,
  code: NonNullable<ReplayRuntimeSharedWalletRiskOutcome["failure"]>["code"],
  error: unknown,
): ReplayRuntimeSharedWalletRiskOutcome {
  const body: Omit<ReplayRuntimeSharedWalletRiskOutcome, "outcome_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RISK_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    portfolio_plan_hash: input.plan.plan_hash,
    risk_reservation_hash: input.risk_reservation.reservation_hash,
    status: "failed",
    result: null,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  return { ...body, outcome_hash: replayRuntimeSharedWalletRiskOutcomeHash(body) }
}

function resolveRisk(
  schedule: ReplayRuntimeSharedWalletRiskPlan["lanes"][number]["venue_risk_policy_epochs"],
  time: string,
) {
  const at = Date.parse(time)
  const snapshot = schedule.find((candidate) => Date.parse(candidate.effective_at) <= at
    && (candidate.valid_until === null || at < Date.parse(candidate.valid_until)))
  if (!snapshot) throw new Error(`runtime shared wallet risk schedule has no epoch at ${time}`)
  return snapshot
}

function utc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
}
