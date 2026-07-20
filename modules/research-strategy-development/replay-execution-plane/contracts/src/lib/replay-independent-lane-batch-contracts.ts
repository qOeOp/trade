import { canonicalHash } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"

export const REPLAY_INDEPENDENT_LANE_BATCH_PLAN_SCHEMA_VERSION = "trade.rd-replay-independent-lane-batch-plan.v1" as const
export const REPLAY_INDEPENDENT_LANE_BATCH_RESULT_SCHEMA_VERSION = "trade.rd-replay-independent-lane-batch-result.v1" as const
export const REPLAY_INDEPENDENT_LANE_BATCH_OUTCOME_SCHEMA_VERSION = "trade.rd-replay-independent-lane-batch-outcome.v1" as const

export interface ReplayIndependentLanePlanEntry {
  lane_id: string
  symbol: string
  run_id: string
  request_hash: string
  trial_reservation_hash: string
  attempt_lease_hash: string
  allocated_initial_cash: number
}

export interface ReplayIndependentLaneBatchPlan {
  schema_version: typeof REPLAY_INDEPENDENT_LANE_BATCH_PLAN_SCHEMA_VERSION
  batch_id: string
  execution_mode: "independent_capital_lanes"
  allocation_policy: "strict_preallocated_no_rebalancing"
  aggregation_policy: "evidence_only_sum_no_cross_lane_netting"
  failure_policy: "all_children_complete_or_no_batch_result"
  lanes: ReplayIndependentLanePlanEntry[]
  plan_hash: string
}

export interface ReplayIndependentLaneBatchResult {
  schema_version: typeof REPLAY_INDEPENDENT_LANE_BATCH_RESULT_SCHEMA_VERSION
  batch_id: string
  plan_hash: string
  execution_mode: "independent_capital_lanes"
  capital_semantics: "isolated_child_cash_not_spendable_portfolio_nav"
  child_results: Array<{
    lane_id: string
    symbol: string
    run_id: string
    result_hash: string
    artifact_manifest_hash: string
    initial_cash: number
    ending_equity: number
    net_pnl: number
  }>
  aggregate_initial_cash: number
  aggregate_ending_equity: number
  aggregate_net_pnl: number
  limitations: [
    "no_shared_cash_or_rebalancing",
    "no_cross_margin_or_cross_lane_liquidation",
    "no_global_order_priority_or_concurrent_matching",
  ]
  result_hash: string
}

export interface ReplayIndependentLaneBatchOutcome {
  schema_version: typeof REPLAY_INDEPENDENT_LANE_BATCH_OUTCOME_SCHEMA_VERSION
  batch_id: string
  plan_hash: string
  status: "completed" | "failed"
  result: ReplayIndependentLaneBatchResult | null
  child_statuses: Array<{
    lane_id: string
    run_id: string
    status: "completed" | "cancelled" | "failed"
    result_hash: string | null
    artifact_manifest_hash: string | null
    failure_code: string | null
  }>
  failure: null | {
    code: "independent-lane-child-not-complete" | "independent-lane-child-evidence-incomplete"
    failed_lane_id: string
    partial_result_published: false
  }
  outcome_hash: string
}

export function replayIndependentLaneBatchPlanHash(
  value: Omit<ReplayIndependentLaneBatchPlan, "plan_hash"> | ReplayIndependentLaneBatchPlan,
): string {
  const { plan_hash: _planHash, ...body } = value as ReplayIndependentLaneBatchPlan
  return canonicalHash(body)
}

export function replayIndependentLaneBatchResultHash(
  value: Omit<ReplayIndependentLaneBatchResult, "result_hash"> | ReplayIndependentLaneBatchResult,
): string {
  const { result_hash: _resultHash, ...body } = value as ReplayIndependentLaneBatchResult
  return canonicalHash(body)
}

export function replayIndependentLaneBatchOutcomeHash(
  value: Omit<ReplayIndependentLaneBatchOutcome, "outcome_hash"> | ReplayIndependentLaneBatchOutcome,
): string {
  const { outcome_hash: _outcomeHash, ...body } = value as ReplayIndependentLaneBatchOutcome
  return canonicalHash(body)
}

export function assertReplayIndependentLaneBatchPlan(value: ReplayIndependentLaneBatchPlan): void {
  requireExactFields(value, [
    "schema_version", "batch_id", "execution_mode", "allocation_policy", "aggregation_policy",
    "failure_policy", "lanes", "plan_hash",
  ], "Plan")
  if (value.schema_version !== REPLAY_INDEPENDENT_LANE_BATCH_PLAN_SCHEMA_VERSION
      || value.execution_mode !== "independent_capital_lanes"
      || value.allocation_policy !== "strict_preallocated_no_rebalancing"
      || value.aggregation_policy !== "evidence_only_sum_no_cross_lane_netting"
      || value.failure_policy !== "all_children_complete_or_no_batch_result") {
    throw new Error("unsupported Replay independent-lane batch Plan")
  }
  requireText(value.batch_id, "batch_id")
  if (!Array.isArray(value.lanes) || value.lanes.length < 2) {
    throw new Error("independent-lane batch requires at least two lanes")
  }
  const laneIds = new Set<string>()
  const runIds = new Set<string>()
  const symbols = new Set<string>()
  let previousLaneId = ""
  for (const lane of value.lanes) {
    requireExactFields(lane, [
      "lane_id", "symbol", "run_id", "request_hash", "trial_reservation_hash",
      "attempt_lease_hash", "allocated_initial_cash",
    ], "Plan lane")
    requireText(lane.lane_id, "lane_id")
    requireText(lane.symbol, "symbol")
    requireText(lane.run_id, "run_id")
    requireHash(lane.request_hash, "request_hash")
    requireHash(lane.trial_reservation_hash, "trial_reservation_hash")
    requireHash(lane.attempt_lease_hash, "attempt_lease_hash")
    if (!Number.isFinite(lane.allocated_initial_cash) || lane.allocated_initial_cash <= 0) {
      throw new Error("independent-lane allocation must be positive")
    }
    if (lane.lane_id <= previousLaneId || laneIds.has(lane.lane_id)) {
      throw new Error("independent-lane Plan lanes must be unique and sorted by lane_id")
    }
    if (runIds.has(lane.run_id) || symbols.has(lane.symbol)) {
      throw new Error("independent-lane Plan requires unique run and symbol identities")
    }
    previousLaneId = lane.lane_id
    laneIds.add(lane.lane_id)
    runIds.add(lane.run_id)
    symbols.add(lane.symbol)
  }
  requireHash(value.plan_hash, "plan_hash")
  if (value.plan_hash !== replayIndependentLaneBatchPlanHash(value)) {
    throw new Error("independent-lane batch Plan hash mismatch")
  }
}

export function assertReplayIndependentLaneBatchResult(value: ReplayIndependentLaneBatchResult): void {
  requireExactFields(value, [
    "schema_version", "batch_id", "plan_hash", "execution_mode", "capital_semantics",
    "child_results", "aggregate_initial_cash", "aggregate_ending_equity", "aggregate_net_pnl",
    "limitations", "result_hash",
  ], "Result")
  if (value.schema_version !== REPLAY_INDEPENDENT_LANE_BATCH_RESULT_SCHEMA_VERSION
      || value.execution_mode !== "independent_capital_lanes"
      || value.capital_semantics !== "isolated_child_cash_not_spendable_portfolio_nav") {
    throw new Error("unsupported Replay independent-lane batch Result")
  }
  requireText(value.batch_id, "batch_id")
  requireHash(value.plan_hash, "plan_hash")
  if (!Array.isArray(value.child_results) || value.child_results.length < 2) {
    throw new Error("independent-lane batch Result requires at least two child Results")
  }
  let previousLaneId = ""
  const laneIds = new Set<string>()
  const runIds = new Set<string>()
  const symbols = new Set<string>()
  for (const child of value.child_results) {
    requireExactFields(child, [
      "lane_id", "symbol", "run_id", "result_hash", "artifact_manifest_hash", "initial_cash",
      "ending_equity", "net_pnl",
    ], "Result child")
    requireText(child.lane_id, "child_result.lane_id")
    requireText(child.symbol, "child_result.symbol")
    requireText(child.run_id, "child_result.run_id")
    requireHash(child.result_hash, "child_result.result_hash")
    requireHash(child.artifact_manifest_hash, "child_result.artifact_manifest_hash")
    requireFinite(child.initial_cash, "child_result.initial_cash", true)
    requireFinite(child.ending_equity, "child_result.ending_equity")
    requireFinite(child.net_pnl, "child_result.net_pnl")
    if (addReplayDecimalValues(child.initial_cash, child.net_pnl) !== child.ending_equity) {
      throw new Error("independent-lane child Result violates capital conservation")
    }
    if (child.lane_id <= previousLaneId || laneIds.has(child.lane_id)
        || runIds.has(child.run_id) || symbols.has(child.symbol)) {
      throw new Error("independent-lane child Results must preserve unique canonical Plan order")
    }
    previousLaneId = child.lane_id
    laneIds.add(child.lane_id)
    runIds.add(child.run_id)
    symbols.add(child.symbol)
  }
  const expectedLimitations: ReplayIndependentLaneBatchResult["limitations"] = [
    "no_shared_cash_or_rebalancing",
    "no_cross_margin_or_cross_lane_liquidation",
    "no_global_order_priority_or_concurrent_matching",
  ]
  if (JSON.stringify(value.limitations) !== JSON.stringify(expectedLimitations)) {
    throw new Error("independent-lane Result limitations were weakened")
  }
  const sum = (field: "initial_cash" | "ending_equity" | "net_pnl") => value.child_results
    .reduce((total, child) => addReplayDecimalValues(total, child[field]), 0)
  if (value.aggregate_initial_cash !== sum("initial_cash")
      || value.aggregate_ending_equity !== sum("ending_equity")
      || value.aggregate_net_pnl !== sum("net_pnl")) {
    throw new Error("independent-lane Result aggregate does not match child evidence")
  }
  requireHash(value.result_hash, "result_hash")
  if (value.result_hash !== replayIndependentLaneBatchResultHash(value)) {
    throw new Error("independent-lane batch Result hash mismatch")
  }
}

export function assertReplayIndependentLaneBatchOutcome(value: ReplayIndependentLaneBatchOutcome): void {
  requireExactFields(value, [
    "schema_version", "batch_id", "plan_hash", "status", "result", "child_statuses", "failure",
    "outcome_hash",
  ], "Outcome")
  if (value.schema_version !== REPLAY_INDEPENDENT_LANE_BATCH_OUTCOME_SCHEMA_VERSION
      || (value.status !== "completed" && value.status !== "failed")) {
    throw new Error("unsupported Replay independent-lane batch Outcome")
  }
  requireText(value.batch_id, "batch_id")
  requireHash(value.plan_hash, "plan_hash")
  if (!Array.isArray(value.child_statuses) || value.child_statuses.length < 2) {
    throw new Error("independent-lane Outcome requires at least two child statuses")
  }
  let previousLaneId = ""
  const laneIds = new Set<string>()
  const runIds = new Set<string>()
  for (const child of value.child_statuses) {
    requireExactFields(child, [
      "lane_id", "run_id", "status", "result_hash", "artifact_manifest_hash", "failure_code",
    ], "Outcome child status")
    requireText(child.lane_id, "child_status.lane_id")
    requireText(child.run_id, "child_status.run_id")
    if (child.status !== "completed" && child.status !== "cancelled" && child.status !== "failed") {
      throw new Error("independent-lane child status is unsupported")
    }
    if (child.result_hash !== null) requireHash(child.result_hash, "child_status.result_hash")
    if (child.artifact_manifest_hash !== null) requireHash(child.artifact_manifest_hash, "child_status.artifact_manifest_hash")
    if (child.failure_code !== null) requireText(child.failure_code, "child_status.failure_code")
    if (child.lane_id <= previousLaneId || laneIds.has(child.lane_id) || runIds.has(child.run_id)) {
      throw new Error("independent-lane child statuses must preserve unique canonical Plan order")
    }
    previousLaneId = child.lane_id
    laneIds.add(child.lane_id)
    runIds.add(child.run_id)
  }
  if (value.status === "completed") {
    if (!value.result || value.failure !== null) throw new Error("completed independent-lane Outcome must publish one Result")
    assertReplayIndependentLaneBatchResult(value.result)
    if (value.result.batch_id !== value.batch_id || value.result.plan_hash !== value.plan_hash
        || value.result.child_results.length !== value.child_statuses.length) {
      throw new Error("independent-lane Outcome does not bind its Result")
    }
    for (let index = 0; index < value.child_statuses.length; index += 1) {
      const status = value.child_statuses[index]!
      const result = value.result.child_results[index]!
      if (status.status !== "completed" || status.lane_id !== result.lane_id || status.run_id !== result.run_id
          || status.result_hash !== result.result_hash
          || status.artifact_manifest_hash !== result.artifact_manifest_hash || status.failure_code !== null) {
        throw new Error("completed independent-lane Outcome child evidence mismatch")
      }
    }
  } else {
    if (value.result !== null || !value.failure) throw new Error("failed independent-lane Outcome must not publish a Result")
    requireExactFields(value.failure, ["code", "failed_lane_id", "partial_result_published"], "Outcome failure")
    if ((value.failure.code !== "independent-lane-child-not-complete"
          && value.failure.code !== "independent-lane-child-evidence-incomplete")
        || value.failure.partial_result_published !== false
        || !laneIds.has(value.failure.failed_lane_id)) {
      throw new Error("independent-lane Outcome failure evidence is invalid")
    }
    const failed = value.child_statuses.find((child) => child.lane_id === value.failure!.failed_lane_id)!
    if (value.failure.code === "independent-lane-child-not-complete" && failed.status === "completed") {
      throw new Error("independent-lane non-complete failure points to a completed child")
    }
    if (value.failure.code === "independent-lane-child-evidence-incomplete"
        && failed.status === "completed" && failed.result_hash !== null && failed.artifact_manifest_hash !== null) {
      throw new Error("independent-lane evidence-incomplete failure points to complete evidence")
    }
  }
  requireHash(value.outcome_hash, "outcome_hash")
  if (value.outcome_hash !== replayIndependentLaneBatchOutcomeHash(value)) {
    throw new Error("independent-lane batch Outcome hash mismatch")
  }
}

function requireText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`independent-lane ${field} is required`)
}

function requireHash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`independent-lane ${field} must be a canonical hash`)
}

function requireFinite(value: number, field: string, positive = false): void {
  if (!Number.isFinite(value) || (positive && value <= 0)) {
    throw new Error(`independent-lane ${field} must be ${positive ? "positive" : "finite"}`)
  }
}

function requireExactFields(value: object, fields: string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`independent-lane ${label} fields are not exact`)
  }
}
