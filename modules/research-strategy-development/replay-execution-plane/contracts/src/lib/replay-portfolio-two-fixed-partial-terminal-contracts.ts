import {
  canonicalHash,
  compareReplayEventKeys,
  type ReplayEventKey,
} from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"

export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-two-fixed-partial-terminal-evidence.v1" as const
export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_POLICY_VERSION =
  "certified-lane-result-two-fixed-partial-terminal-risk-v1" as const

export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_LIMITATIONS = [
  "exactly_two_predeclared_fixed_quantity_partial_reduces_per_opened_lane",
  "each_partial_order_full_fills_and_leaves_a_nonzero_position",
  "generation_two_then_three_preserves_initial_stop_and_target_triggers",
  "exact_funding_and_mark_margin_snapshots_use_event_key_t_minus_position",
  "original_isolated_collateral_reserved_until_full_flat",
  "current_generation_terminal_preempts_each_partial_execution_boundary",
  "no_dynamic_sizing_third_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioTwoFixedPartialTerminalOwner =
  | "initial_protective_stop"
  | "initial_take_profit"
  | "generation_two_protective_stop"
  | "generation_two_take_profit"
  | "generation_three_protective_stop"
  | "generation_three_take_profit"
  | "exact_liquidation"
  | "strategy_exit"
  | "generation_three_open_at_data_end"

export type ReplayPortfolioTwoFixedPartialStatus =
  | "terminal_before_first"
  | "first_filled_terminal_before_second"
  | "both_filled_then_terminal"
  | "both_filled_open_at_data_end"

export interface ReplayPortfolioTwoFixedPartialStep {
  partial_sequence: 1 | 2
  protection_generation: 2 | 3
  intent_hash: string
  fill_hash: string
  event_key: ReplayEventKey
  timestamp: string
  filled_quantity: number
  fill_price: number
  realized_pnl_delta: number
  trading_fee: number
  remaining_quantity: number
  settled_cash_after: number
  reserved_isolated_collateral_after: number
  mark_exposure_at_fill: number
  active_stop_bounded_risk_after: number
  step_hash: string
}

export interface ReplayPortfolioTwoFixedPartialExactRiskObservation {
  observation_sequence: number
  snapshot_hash: string
  source_event_hash: string
  source_event_id: string
  event_key: ReplayEventKey
  source_kind: "funding" | "mark"
  protection_generation: 1 | 2 | 3
  signed_quantity: number
  absolute_quantity: number
  mark_price: number
  notional: number
  isolated_collateral: number
  attributed_settled_cashflow: number
  unrealized_pnl: number
  margin_balance: number
  initial_margin_requirement: number
  maintenance_margin_requirement: number
  maintenance_margin_headroom: number
  margin_ratio: number | null
  state: "healthy" | "maintenance_breached" | "nonpositive_balance"
  maintenance_breach_observed: boolean
  liquidation_evaluated: boolean
  funding_cashflow: number | null
  observation_hash: string
}

export interface ReplayPortfolioTwoFixedPartialTerminalRecord {
  lane_id: string
  symbol: string
  request_hash: string
  source_terminal_record_hash: string
  lane_result_hash: string
  lane_artifact_manifest_hash: string
  side: "long" | "short"
  entry_price: number
  initial_quantity: number
  isolated_collateral: number
  stop_price: number
  target_price: number
  partial_status: ReplayPortfolioTwoFixedPartialStatus
  partial_intent_hashes: [string, string]
  partial_execution_statuses: [
    "filled" | "preempted_by_current_generation_terminal",
    "filled" | "preempted_by_current_generation_terminal" | "not_reached_prior_terminal",
  ]
  partial_steps: ReplayPortfolioTwoFixedPartialStep[]
  exact_risk_observations: ReplayPortfolioTwoFixedPartialExactRiskObservation[]
  exact_risk_observations_hash: string
  owner: ReplayPortfolioTwoFixedPartialTerminalOwner
  terminal_fill_hash: string | null
  liquidation_execution_hash: string | null
  terminal_time: string | null
  ending_open: boolean
  ending_quantity: number
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_mark_price: number | null
  ending_mark_exposure: number
  ending_unrealized_pnl: number
  admission_frozen_stop_risk_amount: number
  ending_active_stop_bounded_risk_amount: number
  risk_budget_release_amount: number
  record_hash: string
}

export interface ReplayPortfolioTwoFixedPartialTerminalEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_POLICY_VERSION
  portfolio_id: string
  settlement_asset: string
  source_terminal_evidence_hash: string
  source_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  lane_records: ReplayPortfolioTwoFixedPartialTerminalRecord[]
  lane_records_hash: string
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  ending_gross_mark_exposure: number
  ending_net_mark_exposure: number
  ending_active_stop_bounded_risk: number
  total_risk_budget_released: number
  exact_risk_observation_count: number
  exact_risk_observations_hash: string
  terminal_owner_counts: Record<ReplayPortfolioTwoFixedPartialTerminalOwner, number>
  limitations: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_LIMITATIONS
  fingerprint_hash: string
  evidence_hash: string
}

export const replayPortfolioTwoFixedPartialStepHash = (
  value: ReplayPortfolioTwoFixedPartialStep | Omit<ReplayPortfolioTwoFixedPartialStep, "step_hash">,
): string => strip(value, "step_hash")
export const replayPortfolioTwoFixedPartialExactRiskObservationHash = (
  value: ReplayPortfolioTwoFixedPartialExactRiskObservation
    | Omit<ReplayPortfolioTwoFixedPartialExactRiskObservation, "observation_hash">,
): string => strip(value, "observation_hash")
export const replayPortfolioTwoFixedPartialTerminalRecordHash = (
  value: ReplayPortfolioTwoFixedPartialTerminalRecord | Omit<ReplayPortfolioTwoFixedPartialTerminalRecord, "record_hash">,
): string => strip(value, "record_hash")
export const replayPortfolioTwoFixedPartialTerminalEvidenceHash = (
  value: ReplayPortfolioTwoFixedPartialTerminalEvidence | Omit<ReplayPortfolioTwoFixedPartialTerminalEvidence, "evidence_hash">,
): string => strip(value, "evidence_hash")

export function assertReplayPortfolioTwoFixedPartialTerminalEvidence(
  value: ReplayPortfolioTwoFixedPartialTerminalEvidence,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_POLICY_VERSION
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_TERMINAL_LIMITATIONS)
      || value.lane_records.length === 0
      || value.lane_records_hash !== canonicalHash(value.lane_records)) fail("header")
  const ids = value.lane_records.map((record) => record.lane_id)
  if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify([...ids].sort())) fail("lane order")
  for (const record of value.lane_records) {
    const count = record.partial_steps.length
    const expectedStatus = count === 0 ? "terminal_before_first"
      : count === 1 ? "first_filled_terminal_before_second"
      : record.ending_open ? "both_filled_open_at_data_end" : "both_filled_then_terminal"
    const expectedExecution = count === 0
      ? ["preempted_by_current_generation_terminal", "not_reached_prior_terminal"]
      : count === 1 ? ["filled", "preempted_by_current_generation_terminal"] : ["filled", "filled"]
    if (count > 2 || record.partial_status !== expectedStatus
        || JSON.stringify(record.partial_execution_statuses) !== JSON.stringify(expectedExecution)
        || record.partial_intent_hashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))
        || record.ending_open && count !== 2
        || !record.ending_open && record.ending_quantity !== 0
        || record.ending_reserved_isolated_collateral !== (record.ending_open ? record.isolated_collateral : 0)
        || record.ending_active_stop_bounded_risk_amount !== (record.ending_open
          ? record.partial_steps[1]!.active_stop_bounded_risk_after : 0)
        || record.risk_budget_release_amount !== (record.ending_open ? 0 : record.admission_frozen_stop_risk_amount)
        || record.owner === "generation_three_open_at_data_end" !== record.ending_open
        || record.terminal_fill_hash === null !== record.ending_open
        || record.terminal_time === null !== record.ending_open
        || record.liquidation_execution_hash === null !== (record.owner !== "exact_liquidation")
        || record.exact_risk_observations_hash !== canonicalHash(record.exact_risk_observations)
        || !ownerMatchesGeneration(record.owner, count, record.ending_open)
        || record.record_hash !== replayPortfolioTwoFixedPartialTerminalRecordHash(record)) fail("record semantics")
    let previous = record.initial_quantity
    for (let index = 0; index < count; index += 1) {
      const step = record.partial_steps[index]!
      if (step.partial_sequence !== index + 1 || step.protection_generation !== index + 2
          || step.intent_hash !== record.partial_intent_hashes[index]
          || step.step_hash !== replayPortfolioTwoFixedPartialStepHash(step)
          || step.filled_quantity <= 0
          || step.remaining_quantity !== addReplayDecimalValues(previous, -step.filled_quantity)
          || step.remaining_quantity <= 0
          || index > 0 && record.partial_steps[index - 1]!.timestamp >= step.timestamp
          || step.reserved_isolated_collateral_after !== record.isolated_collateral) fail("partial step semantics")
      previous = step.remaining_quantity
    }
    if (record.ending_open && record.ending_quantity !== previous) fail("open quantity")
    let priorRiskKey: ReplayEventKey | null = null
    for (let index = 0; index < record.exact_risk_observations.length; index += 1) {
      const observation = record.exact_risk_observations[index]!
      if (observation.observation_sequence !== index + 1
          || observation.observation_hash !== replayPortfolioTwoFixedPartialExactRiskObservationHash(observation)
          || observation.absolute_quantity !== Math.abs(observation.signed_quantity)
          || observation.absolute_quantity <= 0
          || observation.protection_generation < 1 || observation.protection_generation > 3
          || observation.source_kind === "funding" !== (observation.funding_cashflow !== null)
          || priorRiskKey && compareReplayEventKeys(priorRiskKey, observation.event_key) >= 0) fail("exact risk observation")
      priorRiskKey = observation.event_key
    }
  }
  const summary = summarize(value.lane_records)
  if (Object.entries(summary).some(([key, item]) => value[key as keyof typeof value] !== item)
      || canonicalHash(value.terminal_owner_counts) !== canonicalHash(ownerCounts(value.lane_records))
      || value.fingerprint_hash !== canonicalHash({
        source_terminal_evidence_hash: value.source_terminal_evidence_hash,
        source_terminal_artifact_manifest_hash: value.source_terminal_artifact_manifest_hash,
        risk_result_hash: value.risk_result_hash,
        lane_records_hash: value.lane_records_hash,
        exact_risk_observations_hash: value.exact_risk_observations_hash,
        terminal_owner_counts: value.terminal_owner_counts,
        limitations: value.limitations,
      })
      || value.evidence_hash !== replayPortfolioTwoFixedPartialTerminalEvidenceHash(value)) fail("aggregate")
}
function ownerMatchesGeneration(owner: ReplayPortfolioTwoFixedPartialTerminalOwner,
  completedPartials: number, open: boolean): boolean {
  if (open) return owner === "generation_three_open_at_data_end" && completedPartials === 2
  if (owner === "initial_protective_stop" || owner === "initial_take_profit") return completedPartials === 0
  if (owner === "generation_two_protective_stop" || owner === "generation_two_take_profit") {
    return completedPartials === 1
  }
  if (owner === "generation_three_protective_stop" || owner === "generation_three_take_profit") {
    return completedPartials === 2
  }
  return owner === "exact_liquidation" || owner === "strategy_exit"
}
function ownerCounts(records: ReplayPortfolioTwoFixedPartialTerminalRecord[]) {
  const owners: ReplayPortfolioTwoFixedPartialTerminalOwner[] = [
    "initial_protective_stop", "initial_take_profit", "generation_two_protective_stop",
    "generation_two_take_profit", "generation_three_protective_stop", "generation_three_take_profit",
    "exact_liquidation", "strategy_exit", "generation_three_open_at_data_end",
  ]
  return Object.fromEntries(owners.map((owner) => [owner,
    records.filter((record) => record.owner === owner).length])) as
    Record<ReplayPortfolioTwoFixedPartialTerminalOwner, number>
}

export function summarizeReplayPortfolioTwoFixedPartialTerminalRecords(
  records: ReplayPortfolioTwoFixedPartialTerminalRecord[],
) { return summarize(records) }

function summarize(records: ReplayPortfolioTwoFixedPartialTerminalRecord[]) {
  const settled = addReplayDecimalValues(...records.map((record) => record.ending_settled_cash))
  const reserved = addReplayDecimalValues(...records.map((record) => record.ending_reserved_isolated_collateral))
  const unrealized = addReplayDecimalValues(...records.map((record) => record.ending_unrealized_pnl))
  return {
    ending_settled_cash: settled,
    ending_reserved_isolated_collateral: reserved,
    ending_available_cash: addReplayDecimalValues(settled, -reserved),
    ending_unrealized_pnl: unrealized,
    ending_portfolio_nav: addReplayDecimalValues(settled, unrealized),
    ending_gross_mark_exposure: addReplayDecimalValues(...records.map((record) => record.ending_mark_exposure)),
    ending_net_mark_exposure: addReplayDecimalValues(...records.map((record) => record.side === "long"
      ? record.ending_mark_exposure : -record.ending_mark_exposure)),
    ending_active_stop_bounded_risk: addReplayDecimalValues(...records.map((record) =>
      record.ending_active_stop_bounded_risk_amount)),
    total_risk_budget_released: addReplayDecimalValues(...records.map((record) => record.risk_budget_release_amount)),
    exact_risk_observation_count: records.reduce((sum, record) => sum + record.exact_risk_observations.length, 0),
    exact_risk_observations_hash: canonicalHash(records.map((record) => ({
      lane_id: record.lane_id, observations_hash: record.exact_risk_observations_hash,
    }))),
  }
}
function strip(value: unknown, key: string): string {
  const body = { ...(value as Record<string, unknown>) }; delete body[key]; return canonicalHash(body)
}
function fail(area: string): never { throw new Error(`Portfolio two-fixed-partial terminal ${area} drift`) }
