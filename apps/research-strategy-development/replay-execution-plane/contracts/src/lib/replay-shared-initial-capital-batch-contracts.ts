import {
  assertReplayIndependentLaneBatchOutcome,
  type ReplayIndependentLaneBatchOutcome,
} from "./replay-independent-lane-batch-contracts"
import { canonicalHash } from "./replay-contracts"

export const REPLAY_SHARED_INITIAL_CAPITAL_BATCH_RESULT_SCHEMA_VERSION =
  "trade.rd-replay-shared-initial-capital-batch-result.v1" as const
export const REPLAY_SHARED_INITIAL_CAPITAL_BATCH_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-shared-initial-capital-batch-outcome.v1" as const

export interface ReplaySharedInitialCapitalAuthorityBinding {
  reservation_hash: string
  batch_id: string
  batch_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  lanes: Array<{ lane_id: string; priority_rank: number }>
}

export interface ReplaySharedInitialCapitalBatchResult {
  schema_version: typeof REPLAY_SHARED_INITIAL_CAPITAL_BATCH_RESULT_SCHEMA_VERSION
  batch_id: string
  batch_plan_hash: string
  shared_capital_reservation_hash: string
  execution_mode: "shared_initial_capital_static_preallocation"
  capital_semantics: "single_pool_fully_reserved_before_execution"
  settlement_asset: string
  shared_initial_cash: number
  aggregate_ending_equity: number
  aggregate_net_pnl: number
  execution_priority: Array<{ lane_id: string; priority_rank: number }>
  independent_lane_result_hash: string
  limitations: [
    "static_preallocation_not_runtime_shared_wallet",
    "no_cash_release_reuse_or_rebalancing",
    "no_cross_lane_margin_liquidation_or_concurrent_matching",
  ]
  result_hash: string
}

export interface ReplaySharedInitialCapitalBatchOutcome {
  schema_version: typeof REPLAY_SHARED_INITIAL_CAPITAL_BATCH_OUTCOME_SCHEMA_VERSION
  batch_id: string
  batch_plan_hash: string
  shared_capital_reservation_hash: string
  status: "completed" | "failed"
  result: ReplaySharedInitialCapitalBatchResult | null
  independent_lane_outcome: ReplayIndependentLaneBatchOutcome
  outcome_hash: string
}

export function replaySharedInitialCapitalBatchResultHash(
  value: Omit<ReplaySharedInitialCapitalBatchResult, "result_hash"> | ReplaySharedInitialCapitalBatchResult,
): string {
  const { result_hash: _resultHash, ...body } = value as ReplaySharedInitialCapitalBatchResult
  return canonicalHash(body)
}

export function replaySharedInitialCapitalBatchOutcomeHash(
  value: Omit<ReplaySharedInitialCapitalBatchOutcome, "outcome_hash"> | ReplaySharedInitialCapitalBatchOutcome,
): string {
  const { outcome_hash: _outcomeHash, ...body } = value as ReplaySharedInitialCapitalBatchOutcome
  return canonicalHash(body)
}

export function assertReplaySharedInitialCapitalBatchOutcome(
  value: ReplaySharedInitialCapitalBatchOutcome,
  reservation: ReplaySharedInitialCapitalAuthorityBinding,
): void {
  exactFields(value, [
    "schema_version", "batch_id", "batch_plan_hash", "shared_capital_reservation_hash", "status",
    "result", "independent_lane_outcome", "outcome_hash",
  ], "Outcome")
  assertReplayIndependentLaneBatchOutcome(value.independent_lane_outcome)
  if (value.schema_version !== REPLAY_SHARED_INITIAL_CAPITAL_BATCH_OUTCOME_SCHEMA_VERSION
      || value.batch_id !== reservation.batch_id
      || value.batch_plan_hash !== reservation.batch_plan_hash
      || value.shared_capital_reservation_hash !== reservation.reservation_hash
      || value.status !== value.independent_lane_outcome.status) {
    throw new Error("shared initial capital Outcome authority binding is invalid")
  }
  if (value.status === "completed") {
    if (!value.result || !value.independent_lane_outcome.result) {
      throw new Error("completed shared initial capital Outcome requires both Results")
    }
    assertReplaySharedInitialCapitalBatchResult(value.result, reservation, value.independent_lane_outcome)
  } else if (value.result !== null || value.independent_lane_outcome.result !== null) {
    throw new Error("failed shared initial capital Outcome cannot publish a Result")
  }
  hash(value.outcome_hash, "outcome_hash")
  if (value.outcome_hash !== replaySharedInitialCapitalBatchOutcomeHash(value)) {
    throw new Error("shared initial capital Outcome hash mismatch")
  }
}

export function assertReplaySharedInitialCapitalBatchResult(
  value: ReplaySharedInitialCapitalBatchResult,
  reservation: ReplaySharedInitialCapitalAuthorityBinding,
  independentOutcome: ReplayIndependentLaneBatchOutcome,
): void {
  exactFields(value, [
    "schema_version", "batch_id", "batch_plan_hash", "shared_capital_reservation_hash",
    "execution_mode", "capital_semantics", "settlement_asset", "shared_initial_cash",
    "aggregate_ending_equity", "aggregate_net_pnl", "execution_priority",
    "independent_lane_result_hash", "limitations", "result_hash",
  ], "Result")
  const childResult = independentOutcome.result
  if (!childResult || value.schema_version !== REPLAY_SHARED_INITIAL_CAPITAL_BATCH_RESULT_SCHEMA_VERSION
      || value.batch_id !== reservation.batch_id || value.batch_plan_hash !== reservation.batch_plan_hash
      || value.shared_capital_reservation_hash !== reservation.reservation_hash
      || value.execution_mode !== "shared_initial_capital_static_preallocation"
      || value.capital_semantics !== "single_pool_fully_reserved_before_execution"
      || value.settlement_asset !== reservation.settlement_asset
      || value.shared_initial_cash !== reservation.shared_initial_cash
      || value.shared_initial_cash !== childResult.aggregate_initial_cash
      || value.aggregate_ending_equity !== childResult.aggregate_ending_equity
      || value.aggregate_net_pnl !== childResult.aggregate_net_pnl
      || value.independent_lane_result_hash !== childResult.result_hash) {
    throw new Error("shared initial capital Result does not bind authority and child evidence")
  }
  const expectedPriority = reservation.lanes.map((lane) => ({
    lane_id: lane.lane_id,
    priority_rank: lane.priority_rank,
  }))
  if (JSON.stringify(value.execution_priority) !== JSON.stringify(expectedPriority)) {
    throw new Error("shared initial capital execution priority drift")
  }
  const expectedLimitations: ReplaySharedInitialCapitalBatchResult["limitations"] = [
    "static_preallocation_not_runtime_shared_wallet",
    "no_cash_release_reuse_or_rebalancing",
    "no_cross_lane_margin_liquidation_or_concurrent_matching",
  ]
  if (JSON.stringify(value.limitations) !== JSON.stringify(expectedLimitations)) {
    throw new Error("shared initial capital Result limitations were weakened")
  }
  hash(value.result_hash, "result_hash")
  if (value.result_hash !== replaySharedInitialCapitalBatchResultHash(value)) {
    throw new Error("shared initial capital Result hash mismatch")
  }
}

function exactFields(value: object, expected: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`shared initial capital ${label} fields are not exact`)
  }
}

function hash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`shared initial capital ${field} must be a canonical hash`)
}
