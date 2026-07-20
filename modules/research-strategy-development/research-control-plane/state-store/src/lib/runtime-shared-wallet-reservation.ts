import type { Database } from "bun:sqlite"
import {
  REPLAY_RUNTIME_SHARED_WALLET_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_RISK_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_ALLOCATION_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_REALLOCATION_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
  assertTrialReservationSnapshot,
  createReplayRuntimeSharedWalletReservationSnapshot,
  createReplayRuntimeSharedWalletLifecycleReservationSnapshot,
  createReplayRuntimeSharedWalletFundingReservationSnapshot,
  createReplayRuntimeSharedWalletRiskReservationSnapshot,
  createReplayPortfolioAllocationReservationSnapshot,
  createReplayPortfolioReallocationReservationSnapshot,
  createReplayPortfolioCycleSequenceReservationSnapshot,
  hashTrialReservationSnapshot,
  type ReplayRuntimeSharedWalletReservationSnapshot,
  type ReplayRuntimeSharedWalletLifecycleReservationSnapshot,
  type ReplayRuntimeSharedWalletFundingReservationSnapshot,
  type ReplayRuntimeSharedWalletRiskReservationSnapshot,
  type ReplayPortfolioAllocationReservationSnapshot,
  type ReplayPortfolioReallocationReservationSnapshot,
  type ReplayPortfolioCycleSequenceReservationSnapshot,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"

export interface IssueReplayRuntimeSharedWalletReservationInput {
  reservation_id: string
  reservation_ref: string
  issued_at: string
  expires_at: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_reservation: TrialReservationSnapshot
  }>
}

export interface IssueReplayRuntimeSharedWalletLifecycleReservationInput {
  reservation_id: string
  reservation_ref: string
  issued_at: string
  expires_at: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_reservation: TrialReservationSnapshot
  }>
}

export interface IssueReplayRuntimeSharedWalletFundingReservationInput
  extends IssueReplayRuntimeSharedWalletLifecycleReservationInput {}

export interface IssueReplayRuntimeSharedWalletRiskReservationInput
  extends IssueReplayRuntimeSharedWalletLifecycleReservationInput {}

export interface IssueReplayPortfolioAllocationReservationInput
  extends Omit<IssueReplayRuntimeSharedWalletLifecycleReservationInput, "lanes"> {
  max_gross_exposure_amount: number
  max_abs_net_exposure_amount: number
  max_portfolio_risk_amount: number
  lanes: Array<{
    lane_id: string
    priority_rank: number
    max_lane_risk_amount: number
    trial_reservation: TrialReservationSnapshot
  }>
}

export interface IssueReplayPortfolioReallocationReservationInput
  extends Omit<IssueReplayPortfolioAllocationReservationInput, "shared_initial_cash"> {
  portfolio_initial_cash: number
  predecessor_integrated_result_hash: string
  predecessor_artifact_manifest_hash: string
  earliest_reallocation_time: string
}

export interface IssueReplayPortfolioCycleSequenceReservationInput {
  reservation_id: string
  reservation_ref: string
  issued_at: string
  expires_at: string
  portfolio_id: string
  settlement_asset: string
  initial_cash: number
  cycles: Array<{
    allocation_plan_hash: string
    risk_plan_hash: string
    earliest_cycle_time: string
    max_gross_exposure_amount: number
    max_abs_net_exposure_amount: number
    max_portfolio_risk_amount: number
    lanes: Array<{
      lane_id: string
      priority_rank: number
      max_lane_risk_amount: number
      trial_reservation: TrialReservationSnapshot
    }>
  }>
}

interface TrialAuthorityRow {
  trial_id: string
  experiment_id: string
  trial_group_id: string
  group_hash: string
  run_id: string
  status: string
}

export function issueReplayRuntimeSharedWalletReservation(
  db: Database,
  input: IssueReplayRuntimeSharedWalletReservationInput,
): ReplayRuntimeSharedWalletReservationSnapshot {
  if (input.lanes.length < 2) throw new Error("runtime shared wallet authority requires at least two Trial Reservations")
  const first = input.lanes[0]!.trial_reservation
  const lanes = input.lanes.map((lane) => {
    assertTrialReservationSnapshot(lane.trial_reservation)
    const reservation = lane.trial_reservation
    const row = db.query(`
      SELECT
        t.trial_id, t.experiment_id, t.trial_group_id, t.run_id, t.status,
        g.group_hash
      FROM rd_trial t
      JOIN rd_trial_group g ON g.trial_group_id = t.trial_group_id
      WHERE t.trial_id = $trial_id
    `).get({ $trial_id: reservation.identity.trial_id }) as TrialAuthorityRow | null
    if (!row || row.status !== "reserved" || row.trial_id !== reservation.identity.trial_id
        || row.experiment_id !== reservation.identity.experiment_id
        || row.trial_group_id !== reservation.identity.trial_group_id
        || row.group_hash !== reservation.identity.trial_group_hash
        || row.run_id !== reservation.run_id) {
      throw new Error(`runtime shared wallet lane ${lane.lane_id} is not backed by a current reserved Trial`)
    }
    if (reservation.identity.experiment_id !== first.identity.experiment_id
        || reservation.identity.trial_group_id !== first.identity.trial_group_id
        || reservation.identity.trial_group_hash !== first.identity.trial_group_hash) {
      throw new Error("runtime shared wallet lanes must belong to one frozen Experiment and Trial Group")
    }
    if (Date.parse(input.issued_at) < Date.parse(reservation.issued_at)
        || Date.parse(input.expires_at) > Date.parse(reservation.expires_at)) {
      throw new Error("runtime shared wallet authority window must be contained by every child Trial Reservation")
    }
    return {
      lane_id: lane.lane_id,
      priority_rank: lane.priority_rank,
      trial_id: reservation.identity.trial_id,
      run_id: reservation.run_id,
      trial_reservation_ref: reservation.reservation_ref,
      trial_reservation_hash: hashTrialReservationSnapshot(reservation),
    }
  })
  return createReplayRuntimeSharedWalletReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RESERVATION_SCHEMA_VERSION,
    reservation_id: input.reservation_id,
    reservation_ref: input.reservation_ref,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: first.identity.experiment_id,
    trial_group_id: first.identity.trial_group_id,
    trial_group_hash: first.identity.trial_group_hash,
    portfolio_id: input.portfolio_id,
    portfolio_plan_hash: input.portfolio_plan_hash,
    settlement_asset: input.settlement_asset,
    shared_initial_cash: input.shared_initial_cash,
    capital_policy_version: "rd-runtime-shared-wallet-isolated-entry-v1",
    simultaneous_order_policy: "event_time_then_control_plane_priority",
    lanes,
    limitations: [
      "market_next_open_entry_only",
      "isolated_margin_no_cross_margin",
      "no_exit_funding_liquidation_or_cash_release",
    ],
  })
}

export function issueReplayRuntimeSharedWalletLifecycleReservation(
  db: Database,
  input: IssueReplayRuntimeSharedWalletLifecycleReservationInput,
): ReplayRuntimeSharedWalletLifecycleReservationSnapshot {
  if (input.lanes.length < 2) throw new Error("runtime shared wallet lifecycle authority requires at least two Trial Reservations")
  const first = input.lanes[0]!.trial_reservation
  const lanes = input.lanes.map((lane) => {
    assertTrialReservationSnapshot(lane.trial_reservation)
    const reservation = lane.trial_reservation
    const row = db.query(`
      SELECT
        t.trial_id, t.experiment_id, t.trial_group_id, t.run_id, t.status,
        g.group_hash
      FROM rd_trial t
      JOIN rd_trial_group g ON g.trial_group_id = t.trial_group_id
      WHERE t.trial_id = $trial_id
    `).get({ $trial_id: reservation.identity.trial_id }) as TrialAuthorityRow | null
    if (!row || row.status !== "reserved" || row.trial_id !== reservation.identity.trial_id
        || row.experiment_id !== reservation.identity.experiment_id
        || row.trial_group_id !== reservation.identity.trial_group_id
        || row.group_hash !== reservation.identity.trial_group_hash
        || row.run_id !== reservation.run_id) {
      throw new Error(`runtime shared wallet lifecycle lane ${lane.lane_id} is not backed by a current reserved Trial`)
    }
    if (reservation.identity.experiment_id !== first.identity.experiment_id
        || reservation.identity.trial_group_id !== first.identity.trial_group_id
        || reservation.identity.trial_group_hash !== first.identity.trial_group_hash) {
      throw new Error("runtime shared wallet lifecycle lanes must belong to one frozen Experiment and Trial Group")
    }
    if (Date.parse(input.issued_at) < Date.parse(reservation.issued_at)
        || Date.parse(input.expires_at) > Date.parse(reservation.expires_at)) {
      throw new Error("runtime shared wallet lifecycle authority window must be contained by every child Trial Reservation")
    }
    return {
      lane_id: lane.lane_id,
      priority_rank: lane.priority_rank,
      trial_id: reservation.identity.trial_id,
      run_id: reservation.run_id,
      trial_reservation_ref: reservation.reservation_ref,
      trial_reservation_hash: hashTrialReservationSnapshot(reservation),
    }
  })
  return createReplayRuntimeSharedWalletLifecycleReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESERVATION_SCHEMA_VERSION,
    reservation_id: input.reservation_id,
    reservation_ref: input.reservation_ref,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: first.identity.experiment_id,
    trial_group_id: first.identity.trial_group_id,
    trial_group_hash: first.identity.trial_group_hash,
    portfolio_id: input.portfolio_id,
    portfolio_plan_hash: input.portfolio_plan_hash,
    settlement_asset: input.settlement_asset,
    shared_initial_cash: input.shared_initial_cash,
    capital_policy_version: "rd-runtime-shared-wallet-entry-exit-release-v1",
    same_time_cash_policy: "exit_release_before_entry_admission_then_control_plane_priority",
    lanes,
    limitations: [
      "market_next_open_entry_and_full_exit_only",
      "isolated_margin_no_cross_margin",
      "no_funding_liquidation_or_partial_position",
    ],
  })
}

export function issueReplayRuntimeSharedWalletFundingReservation(
  db: Database,
  input: IssueReplayRuntimeSharedWalletFundingReservationInput,
): ReplayRuntimeSharedWalletFundingReservationSnapshot {
  if (input.lanes.length < 2) throw new Error("runtime shared wallet funding authority requires at least two Trial Reservations")
  const first = input.lanes[0]!.trial_reservation
  const lanes = input.lanes.map((lane) => {
    assertTrialReservationSnapshot(lane.trial_reservation)
    const reservation = lane.trial_reservation
    const row = db.query(`
      SELECT
        t.trial_id, t.experiment_id, t.trial_group_id, t.run_id, t.status,
        g.group_hash
      FROM rd_trial t
      JOIN rd_trial_group g ON g.trial_group_id = t.trial_group_id
      WHERE t.trial_id = $trial_id
    `).get({ $trial_id: reservation.identity.trial_id }) as TrialAuthorityRow | null
    if (!row || row.status !== "reserved" || row.trial_id !== reservation.identity.trial_id
        || row.experiment_id !== reservation.identity.experiment_id
        || row.trial_group_id !== reservation.identity.trial_group_id
        || row.group_hash !== reservation.identity.trial_group_hash || row.run_id !== reservation.run_id) {
      throw new Error(`runtime shared wallet funding lane ${lane.lane_id} is not backed by a current reserved Trial`)
    }
    if (reservation.identity.experiment_id !== first.identity.experiment_id
        || reservation.identity.trial_group_id !== first.identity.trial_group_id
        || reservation.identity.trial_group_hash !== first.identity.trial_group_hash) {
      throw new Error("runtime shared wallet funding lanes must belong to one frozen Experiment and Trial Group")
    }
    if (Date.parse(input.issued_at) < Date.parse(reservation.issued_at)
        || Date.parse(input.expires_at) > Date.parse(reservation.expires_at)) {
      throw new Error("runtime shared wallet funding authority window must be contained by every child Trial Reservation")
    }
    return {
      lane_id: lane.lane_id,
      priority_rank: lane.priority_rank,
      trial_id: reservation.identity.trial_id,
      run_id: reservation.run_id,
      trial_reservation_ref: reservation.reservation_ref,
      trial_reservation_hash: hashTrialReservationSnapshot(reservation),
    }
  })
  return createReplayRuntimeSharedWalletFundingReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESERVATION_SCHEMA_VERSION,
    reservation_id: input.reservation_id,
    reservation_ref: input.reservation_ref,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: first.identity.experiment_id,
    trial_group_id: first.identity.trial_group_id,
    trial_group_hash: first.identity.trial_group_hash,
    portfolio_id: input.portfolio_id,
    portfolio_plan_hash: input.portfolio_plan_hash,
    settlement_asset: input.settlement_asset,
    shared_initial_cash: input.shared_initial_cash,
    capital_policy_version: "rd-runtime-shared-wallet-exact-funding-v1",
    funding_policy_version: "exact-event-time-t-minus-position-v1",
    same_time_cash_policy: "funding_before_exit_before_entry_then_control_plane_priority",
    lanes,
    limitations: [
      "market_next_open_entry_full_exit_and_exact_funding_only",
      "isolated_margin_no_cross_margin",
      "no_liquidation_partial_position_or_borrow",
    ],
  })
}

export function issueReplayRuntimeSharedWalletRiskReservation(
  db: Database,
  input: IssueReplayRuntimeSharedWalletRiskReservationInput,
): ReplayRuntimeSharedWalletRiskReservationSnapshot {
  const fundingAuthority = issueReplayRuntimeSharedWalletFundingReservation(db, input)
  return createReplayRuntimeSharedWalletRiskReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RISK_RESERVATION_SCHEMA_VERSION,
    reservation_id: input.reservation_id,
    reservation_ref: input.reservation_ref,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: fundingAuthority.experiment_id,
    trial_group_id: fundingAuthority.trial_group_id,
    trial_group_hash: fundingAuthority.trial_group_hash,
    portfolio_id: input.portfolio_id,
    portfolio_plan_hash: input.portfolio_plan_hash,
    settlement_asset: input.settlement_asset,
    shared_initial_cash: input.shared_initial_cash,
    capital_policy_version: "rd-runtime-shared-wallet-exact-risk-v1",
    funding_policy_version: "exact-event-time-t-minus-position-v1",
    risk_policy_version: "complete-exact-mark-isolated-maintenance-full-liquidation-v1",
    same_time_cash_policy: "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority",
    lanes: structuredClone(fundingAuthority.lanes),
    limitations: [
      "market_next_open_entry_full_exit_exact_funding_and_mark_risk_only",
      "isolated_margin_full_liquidation_no_cross_margin",
      "no_partial_liquidation_borrow_insurance_or_adl",
    ],
  })
}

export function issueReplayPortfolioAllocationReservation(
  db: Database,
  input: IssueReplayPortfolioAllocationReservationInput,
): ReplayPortfolioAllocationReservationSnapshot {
  const riskAuthority = issueReplayRuntimeSharedWalletRiskReservation(db, {
    reservation_id: input.reservation_id,
    reservation_ref: input.reservation_ref,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    portfolio_id: input.portfolio_id,
    portfolio_plan_hash: input.portfolio_plan_hash,
    settlement_asset: input.settlement_asset,
    shared_initial_cash: input.shared_initial_cash,
    lanes: input.lanes.map(({ max_lane_risk_amount: _risk, ...lane }) => lane),
  })
  const riskByLane = new Map(input.lanes.map((lane) => [lane.lane_id, lane.max_lane_risk_amount]))
  return createReplayPortfolioAllocationReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_ALLOCATION_RESERVATION_SCHEMA_VERSION,
    reservation_id: input.reservation_id,
    reservation_ref: input.reservation_ref,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: riskAuthority.experiment_id,
    trial_group_id: riskAuthority.trial_group_id,
    trial_group_hash: riskAuthority.trial_group_hash,
    portfolio_id: input.portfolio_id,
    portfolio_plan_hash: input.portfolio_plan_hash,
    settlement_asset: input.settlement_asset,
    shared_initial_cash: input.shared_initial_cash,
    allocation_policy_version: "simultaneous-entry-greedy-priority-no-resize-v1",
    exposure_policy_version: "entry-execution-notional-gross-and-absolute-net-v1",
    risk_budget_policy_version: "entry-to-frozen-stop-adverse-execution-plus-round-trip-fees-v1",
    rejection_precedence: "lane_risk_then_cash_then_gross_then_absolute_net_then_portfolio_risk",
    max_gross_exposure_amount: input.max_gross_exposure_amount,
    max_abs_net_exposure_amount: input.max_abs_net_exposure_amount,
    max_portfolio_risk_amount: input.max_portfolio_risk_amount,
    lanes: riskAuthority.lanes.map((lane) => ({
      ...lane,
      max_lane_risk_amount: riskByLane.get(lane.lane_id)!,
    })),
    limitations: [
      "market_next_open_full_fill_or_reject_no_resize_entry_slice_only",
      "entry_notional_exposure_and_frozen_stop_loss_budget_not_dynamic_var",
      "no_exit_funding_liquidation_cross_margin_partial_fill_or_borrow",
    ],
  })
}

export function issueReplayPortfolioReallocationReservation(
  db: Database,
  input: IssueReplayPortfolioReallocationReservationInput,
): ReplayPortfolioReallocationReservationSnapshot {
  const riskAuthority = issueReplayRuntimeSharedWalletRiskReservation(db, {
    reservation_id: input.reservation_id,
    reservation_ref: input.reservation_ref,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    portfolio_id: input.portfolio_id,
    portfolio_plan_hash: input.portfolio_plan_hash,
    settlement_asset: input.settlement_asset,
    shared_initial_cash: input.portfolio_initial_cash,
    lanes: input.lanes.map(({ max_lane_risk_amount: _risk, ...lane }) => lane),
  })
  const riskByLane = new Map(input.lanes.map((lane) => [lane.lane_id, lane.max_lane_risk_amount]))
  return createReplayPortfolioReallocationReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_REALLOCATION_RESERVATION_SCHEMA_VERSION,
    reservation_id: input.reservation_id,
    reservation_ref: input.reservation_ref,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: riskAuthority.experiment_id,
    trial_group_id: riskAuthority.trial_group_id,
    trial_group_hash: riskAuthority.trial_group_hash,
    portfolio_id: input.portfolio_id,
    portfolio_plan_hash: input.portfolio_plan_hash,
    settlement_asset: input.settlement_asset,
    portfolio_initial_cash: input.portfolio_initial_cash,
    predecessor_integrated_result_hash: input.predecessor_integrated_result_hash,
    predecessor_artifact_manifest_hash: input.predecessor_artifact_manifest_hash,
    reallocation_cycle: 2,
    earliest_reallocation_time: input.earliest_reallocation_time,
    opening_cash_policy: "predecessor_ending_available_cash_after_full_flat_release",
    eligibility_policy: "all_predecessor_positions_closed_and_exposure_risk_zero",
    allocation_policy_version: "simultaneous-entry-greedy-priority-no-resize-v1",
    max_gross_exposure_amount: input.max_gross_exposure_amount,
    max_abs_net_exposure_amount: input.max_abs_net_exposure_amount,
    max_portfolio_risk_amount: input.max_portfolio_risk_amount,
    lanes: riskAuthority.lanes.map((lane) => ({
      ...lane,
      max_lane_risk_amount: riskByLane.get(lane.lane_id)!,
    })),
    limitations: [
      "second_cycle_only_after_authoritative_full_flat_release",
      "opening_cash_derived_from_predecessor_result_not_control_plane_estimate",
      "no_third_cycle_partial_cross_margin_borrow_or_fast",
    ],
  })
}

export function issueReplayPortfolioCycleSequenceReservation(
  db: Database,
  input: IssueReplayPortfolioCycleSequenceReservationInput,
): ReplayPortfolioCycleSequenceReservationSnapshot {
  if (input.cycles.length < 1 || input.cycles.length > REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES) {
    throw new Error("portfolio cycle sequence requires one to eight predeclared cycles")
  }
  const allLanes = input.cycles.flatMap((cycle) => cycle.lanes)
  const first = allLanes[0]?.trial_reservation
  if (!first) throw new Error("portfolio cycle sequence requires at least two lanes per cycle")
  const seenTrials = new Set<string>()
  const cycles = input.cycles.map((cycle, cycleOffset) => ({
    cycle_index: cycleOffset + 1,
    allocation_plan_hash: cycle.allocation_plan_hash,
    risk_plan_hash: cycle.risk_plan_hash,
    earliest_cycle_time: cycle.earliest_cycle_time,
    max_gross_exposure_amount: cycle.max_gross_exposure_amount,
    max_abs_net_exposure_amount: cycle.max_abs_net_exposure_amount,
    max_portfolio_risk_amount: cycle.max_portfolio_risk_amount,
    lanes: cycle.lanes.map((lane) => {
      assertTrialReservationSnapshot(lane.trial_reservation)
      const reservation = lane.trial_reservation
      const row = db.query(`
        SELECT
          t.trial_id, t.experiment_id, t.trial_group_id, t.run_id, t.status,
          g.group_hash
        FROM rd_trial t
        JOIN rd_trial_group g ON g.trial_group_id = t.trial_group_id
        WHERE t.trial_id = $trial_id
      `).get({ $trial_id: reservation.identity.trial_id }) as TrialAuthorityRow | null
      if (!row || row.status !== "reserved" || row.trial_id !== reservation.identity.trial_id
          || row.experiment_id !== reservation.identity.experiment_id
          || row.trial_group_id !== reservation.identity.trial_group_id
          || row.group_hash !== reservation.identity.trial_group_hash || row.run_id !== reservation.run_id) {
        throw new Error(`portfolio cycle sequence lane ${lane.lane_id} is not backed by a current reserved Trial`)
      }
      if (reservation.identity.experiment_id !== first.identity.experiment_id
          || reservation.identity.trial_group_id !== first.identity.trial_group_id
          || reservation.identity.trial_group_hash !== first.identity.trial_group_hash) {
        throw new Error("portfolio cycle sequence lanes must belong to one frozen Experiment and Trial Group")
      }
      if (Date.parse(input.issued_at) < Date.parse(reservation.issued_at)
          || Date.parse(input.expires_at) > Date.parse(reservation.expires_at)
          || seenTrials.has(reservation.identity.trial_id)) {
        throw new Error("portfolio cycle sequence authority window or Trial uniqueness drift")
      }
      seenTrials.add(reservation.identity.trial_id)
      return {
        lane_id: lane.lane_id,
        priority_rank: lane.priority_rank,
        trial_id: reservation.identity.trial_id,
        run_id: reservation.run_id,
        trial_reservation_ref: reservation.reservation_ref,
        trial_reservation_hash: hashTrialReservationSnapshot(reservation),
        max_lane_risk_amount: lane.max_lane_risk_amount,
      }
    }),
  }))
  return createReplayPortfolioCycleSequenceReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
    reservation_id: input.reservation_id,
    reservation_ref: input.reservation_ref,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: first.identity.experiment_id,
    trial_group_id: first.identity.trial_group_id,
    trial_group_hash: first.identity.trial_group_hash,
    portfolio_id: input.portfolio_id,
    settlement_asset: input.settlement_asset,
    initial_cash: input.initial_cash,
    cycle_count: cycles.length,
    max_cycle_count: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
    opening_cash_policy: "first_cycle_initial_then_predecessor_ending_available",
    successor_eligibility_policy: "predecessor_full_flat_exposure_and_risk_zero",
    expansion_policy: "exact_predeclared_cycles_no_runtime_append_or_search_expansion",
    cycles,
    limitations: [
      "one_to_eight_predeclared_full_flat_cycles_only",
      "cycle_opening_cash_is_runtime_predecessor_evidence_not_control_plane_estimate",
      "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
    ],
  })
}
