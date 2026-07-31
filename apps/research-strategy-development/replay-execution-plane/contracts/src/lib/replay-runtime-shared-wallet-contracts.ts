import { canonicalHash } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"

export const REPLAY_RUNTIME_SHARED_WALLET_PLAN_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-plan.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_RESULT_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-result.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-outcome.v1" as const

export interface ReplayRuntimeSharedWalletAuthorityBinding {
  reservation_hash: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  lanes: Array<{ lane_id: string; priority_rank: number }>
}

export interface ReplayRuntimeSharedWalletPlan {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_PLAN_SCHEMA_VERSION
  portfolio_id: string
  execution_mode: "runtime_shared_wallet_entry_v1"
  capital_semantics: "single_runtime_wallet_no_static_lane_allocation"
  matching_scope: "market_next_open_full_fill"
  margin_scope: "isolated_positions_shared_admission_cash"
  failure_policy: "engine_failure_no_partial_portfolio_result"
  lanes: Array<{
    lane_id: string
    symbol: string
    run_id: string
    request_hash: string
    trial_reservation_hash: string
    attempt_lease_hash: string
  }>
  plan_hash: string
}

export interface ReplayRuntimeSharedWalletGlobalEvent {
  event_hash: string
  queue_ordinal: number
  event_time: string
  boundary_phase: 20
  source_kind: "bar_open"
  lane_id: string
  symbol: string
  priority_rank: number
  request_hash: string
  bar_hash: string
  wallet_before: ReplayRuntimeSharedWalletSnapshot
  execution_price: number
  position_side: "long" | "short"
  quantity: number
  isolated_collateral: number
  entry_fee: number
  required_available_cash: number
  admission: "filled" | "rejected"
  admission_reason: "cash_reserved_and_fill_committed" | "insufficient_available_cash"
  fill_hash: string | null
  wallet_after: ReplayRuntimeSharedWalletSnapshot
}

export interface ReplayRuntimeSharedWalletSnapshot {
  settled_cash: number
  reserved_isolated_collateral: number
  available_cash: number
}

export interface ReplayRuntimeSharedWalletResult {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_RESULT_SCHEMA_VERSION
  portfolio_id: string
  portfolio_plan_hash: string
  runtime_shared_wallet_reservation_hash: string
  execution_mode: "runtime_shared_wallet_entry_v1"
  capital_semantics: "single_runtime_wallet_fill_fee_then_next_admission"
  settlement_asset: string
  shared_initial_cash: number
  global_source_event_queue: ReplayRuntimeSharedWalletGlobalEvent[]
  open_positions: Array<{
    lane_id: string
    symbol: string
    side: "long" | "short"
    quantity: number
    entry_price: number
    isolated_collateral: number
    fill_hash: string
  }>
  rejected_lane_ids: string[]
  total_entry_fees: number
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  portfolio_nav_at_entry_marks: number
  limitations: [
    "entry_admission_slice_not_full_lifecycle_portfolio",
    "market_next_open_full_fill_only",
    "no_exit_funding_liquidation_cash_release_or_cross_margin",
  ]
  result_hash: string
}

export interface ReplayRuntimeSharedWalletOutcome {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  portfolio_plan_hash: string
  runtime_shared_wallet_reservation_hash: string
  status: "completed" | "failed"
  result: ReplayRuntimeSharedWalletResult | null
  failure: {
    code: "runtime-shared-wallet-input-invalid" | "runtime-shared-wallet-engine-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayRuntimeSharedWalletPlanHash(
  value: Omit<ReplayRuntimeSharedWalletPlan, "plan_hash"> | ReplayRuntimeSharedWalletPlan,
): string {
  const { plan_hash: _planHash, ...body } = value as ReplayRuntimeSharedWalletPlan
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletEventHash(
  value: Omit<ReplayRuntimeSharedWalletGlobalEvent, "event_hash"> | ReplayRuntimeSharedWalletGlobalEvent,
): string {
  const { event_hash: _eventHash, ...body } = value as ReplayRuntimeSharedWalletGlobalEvent
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletResultHash(
  value: Omit<ReplayRuntimeSharedWalletResult, "result_hash"> | ReplayRuntimeSharedWalletResult,
): string {
  const { result_hash: _resultHash, ...body } = value as ReplayRuntimeSharedWalletResult
  return canonicalHash(body)
}

export function replayRuntimeSharedWalletOutcomeHash(
  value: Omit<ReplayRuntimeSharedWalletOutcome, "outcome_hash"> | ReplayRuntimeSharedWalletOutcome,
): string {
  const { outcome_hash: _outcomeHash, ...body } = value as ReplayRuntimeSharedWalletOutcome
  return canonicalHash(body)
}

export function assertReplayRuntimeSharedWalletPlan(value: ReplayRuntimeSharedWalletPlan): void {
  exactFields(value, [
    "schema_version", "portfolio_id", "execution_mode", "capital_semantics", "matching_scope",
    "margin_scope", "failure_policy", "lanes", "plan_hash",
  ], "Plan")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_PLAN_SCHEMA_VERSION
      || value.execution_mode !== "runtime_shared_wallet_entry_v1"
      || value.capital_semantics !== "single_runtime_wallet_no_static_lane_allocation"
      || value.matching_scope !== "market_next_open_full_fill"
      || value.margin_scope !== "isolated_positions_shared_admission_cash"
      || value.failure_policy !== "engine_failure_no_partial_portfolio_result") {
    throw new Error("runtime shared wallet Plan policy is unsupported")
  }
  text(value.portfolio_id, "portfolio_id")
  if (!Array.isArray(value.lanes) || value.lanes.length < 2) {
    throw new Error("runtime shared wallet Plan requires at least two lanes")
  }
  const laneIds = new Set<string>()
  const symbols = new Set<string>()
  const runIds = new Set<string>()
  let previous = ""
  for (const lane of value.lanes) {
    exactFields(lane, [
      "lane_id", "symbol", "run_id", "request_hash", "trial_reservation_hash", "attempt_lease_hash",
    ], "Plan lane")
    text(lane.lane_id, "lane_id")
    text(lane.symbol, "symbol")
    text(lane.run_id, "run_id")
    hash(lane.request_hash, "request_hash")
    hash(lane.trial_reservation_hash, "trial_reservation_hash")
    hash(lane.attempt_lease_hash, "attempt_lease_hash")
    if (lane.lane_id <= previous || laneIds.has(lane.lane_id) || symbols.has(lane.symbol) || runIds.has(lane.run_id)) {
      throw new Error("runtime shared wallet Plan lanes require canonical unique lane, symbol and run identities")
    }
    previous = lane.lane_id
    laneIds.add(lane.lane_id)
    symbols.add(lane.symbol)
    runIds.add(lane.run_id)
  }
  hash(value.plan_hash, "plan_hash")
  if (value.plan_hash !== replayRuntimeSharedWalletPlanHash(value)) {
    throw new Error("runtime shared wallet Plan hash mismatch")
  }
}

export function assertReplayRuntimeSharedWalletResult(
  value: ReplayRuntimeSharedWalletResult,
  plan: ReplayRuntimeSharedWalletPlan,
  authority: ReplayRuntimeSharedWalletAuthorityBinding,
): void {
  assertReplayRuntimeSharedWalletPlan(plan)
  exactFields(value, [
    "schema_version", "portfolio_id", "portfolio_plan_hash", "runtime_shared_wallet_reservation_hash",
    "execution_mode", "capital_semantics", "settlement_asset", "shared_initial_cash",
    "global_source_event_queue", "open_positions", "rejected_lane_ids", "total_entry_fees",
    "ending_settled_cash", "ending_reserved_isolated_collateral", "ending_available_cash",
    "portfolio_nav_at_entry_marks", "limitations", "result_hash",
  ], "Result")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_RESULT_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.portfolio_id !== authority.portfolio_id
      || value.portfolio_plan_hash !== plan.plan_hash || value.portfolio_plan_hash !== authority.portfolio_plan_hash
      || value.runtime_shared_wallet_reservation_hash !== authority.reservation_hash
      || value.execution_mode !== "runtime_shared_wallet_entry_v1"
      || value.capital_semantics !== "single_runtime_wallet_fill_fee_then_next_admission"
      || value.settlement_asset !== authority.settlement_asset
      || value.shared_initial_cash !== authority.shared_initial_cash) {
    throw new Error("runtime shared wallet Result authority binding is invalid")
  }
  if (value.global_source_event_queue.length !== plan.lanes.length) {
    throw new Error("runtime shared wallet Result must consume one entry SourceEvent per lane")
  }
  const authorityRank = new Map(authority.lanes.map((lane) => [lane.lane_id, lane.priority_rank]))
  const seen = new Set<string>()
  const filledEvents: ReplayRuntimeSharedWalletGlobalEvent[] = []
  let previousTime = ""
  let previousRank = 0
  for (const [index, event] of value.global_source_event_queue.entries()) {
    assertEvent(event)
    const lane = plan.lanes.find((item) => item.lane_id === event.lane_id)
    if (!lane || event.queue_ordinal !== index + 1 || event.symbol !== lane.symbol
        || event.request_hash !== lane.request_hash || event.priority_rank !== authorityRank.get(event.lane_id)
        || seen.has(event.lane_id)) {
      throw new Error("runtime shared wallet global event does not bind one unique Plan lane")
    }
    if (previousTime !== "" && (event.event_time < previousTime
        || (event.event_time === previousTime && event.priority_rank <= previousRank))) {
      throw new Error("runtime shared wallet global queue order drift")
    }
    if (index > 0 && event.wallet_before.available_cash
        !== value.global_source_event_queue[index - 1]!.wallet_after.available_cash) {
      throw new Error("runtime shared wallet event cash chain is discontinuous")
    }
    previousTime = event.event_time
    previousRank = event.priority_rank
    seen.add(event.lane_id)
    if (event.admission === "filled") filledEvents.push(event)
  }
  if (filledEvents.length !== value.open_positions.length) {
    throw new Error("runtime shared wallet open Positions must exactly cover admitted Fills")
  }
  for (const [index, position] of value.open_positions.entries()) {
    exactFields(position, [
      "lane_id", "symbol", "side", "quantity", "entry_price", "isolated_collateral", "fill_hash",
    ], "open Position")
    const event = filledEvents[index]!
    if (position.lane_id !== event.lane_id || position.symbol !== event.symbol
        || position.side !== event.position_side || position.quantity !== event.quantity
        || position.entry_price !== event.execution_price
        || position.isolated_collateral !== event.isolated_collateral
        || position.fill_hash !== event.fill_hash) {
      throw new Error("runtime shared wallet open Position does not bind its admitted Fill")
    }
    const expectedFillHash = canonicalHash({
      portfolio_id: value.portfolio_id,
      lane_id: event.lane_id,
      request_hash: event.request_hash,
      event_time: event.event_time,
      side: event.position_side === "long" ? "buy" : "sell",
      quantity: event.quantity,
      price: event.execution_price,
      fee: event.entry_fee,
      reduce_only: false,
    })
    if (event.fill_hash !== expectedFillHash) {
      throw new Error("runtime shared wallet admitted Fill hash mismatch")
    }
  }
  const last = value.global_source_event_queue.at(-1)!.wallet_after
  const fees = sum(value.global_source_event_queue
    .filter((event) => event.admission === "filled")
    .map((event) => event.entry_fee))
  const collateral = sum(value.open_positions.map((position) => position.isolated_collateral))
  const rejected = value.global_source_event_queue
    .filter((event) => event.admission === "rejected")
    .map((event) => event.lane_id)
  if (value.total_entry_fees !== fees
      || value.ending_settled_cash !== addReplayDecimalValues(value.shared_initial_cash, -fees)
      || value.ending_reserved_isolated_collateral !== collateral
      || value.ending_available_cash !== addReplayDecimalValues(value.ending_settled_cash, -collateral)
      || value.portfolio_nav_at_entry_marks !== value.ending_settled_cash
      || last.settled_cash !== value.ending_settled_cash
      || last.reserved_isolated_collateral !== value.ending_reserved_isolated_collateral
      || last.available_cash !== value.ending_available_cash
      || JSON.stringify(value.rejected_lane_ids) !== JSON.stringify(rejected)) {
    throw new Error("runtime shared wallet Result capital conservation failed")
  }
  const expectedLimitations: ReplayRuntimeSharedWalletResult["limitations"] = [
    "entry_admission_slice_not_full_lifecycle_portfolio",
    "market_next_open_full_fill_only",
    "no_exit_funding_liquidation_cash_release_or_cross_margin",
  ]
  if (JSON.stringify(value.limitations) !== JSON.stringify(expectedLimitations)) {
    throw new Error("runtime shared wallet Result limitations were weakened")
  }
  hash(value.result_hash, "result_hash")
  if (value.result_hash !== replayRuntimeSharedWalletResultHash(value)) {
    throw new Error("runtime shared wallet Result hash mismatch")
  }
}

export function assertReplayRuntimeSharedWalletOutcome(
  value: ReplayRuntimeSharedWalletOutcome,
  plan: ReplayRuntimeSharedWalletPlan,
  authority: ReplayRuntimeSharedWalletAuthorityBinding,
): void {
  exactFields(value, [
    "schema_version", "portfolio_id", "portfolio_plan_hash", "runtime_shared_wallet_reservation_hash",
    "status", "result", "failure", "outcome_hash",
  ], "Outcome")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_OUTCOME_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.portfolio_plan_hash !== plan.plan_hash
      || value.runtime_shared_wallet_reservation_hash !== authority.reservation_hash) {
    throw new Error("runtime shared wallet Outcome authority binding is invalid")
  }
  if (value.status === "completed") {
    if (!value.result || value.failure !== null) throw new Error("completed runtime shared wallet Outcome requires Result")
    assertReplayRuntimeSharedWalletResult(value.result, plan, authority)
  } else {
    if (value.result !== null || !value.failure || value.failure.partial_result_published !== false) {
      throw new Error("failed runtime shared wallet Outcome cannot publish partial Result")
    }
    exactFields(value.failure, ["code", "message", "partial_result_published"], "Outcome failure")
    if (value.failure.code !== "runtime-shared-wallet-input-invalid"
        && value.failure.code !== "runtime-shared-wallet-engine-failed") {
      throw new Error("runtime shared wallet Outcome failure code is invalid")
    }
    text(value.failure.message, "failure.message")
  }
  hash(value.outcome_hash, "outcome_hash")
  if (value.outcome_hash !== replayRuntimeSharedWalletOutcomeHash(value)) {
    throw new Error("runtime shared wallet Outcome hash mismatch")
  }
}

function assertEvent(event: ReplayRuntimeSharedWalletGlobalEvent): void {
  exactFields(event, [
    "event_hash", "queue_ordinal", "event_time", "boundary_phase", "source_kind", "lane_id", "symbol",
    "priority_rank", "request_hash", "bar_hash", "wallet_before", "execution_price", "position_side", "quantity",
    "isolated_collateral", "entry_fee", "required_available_cash", "admission", "admission_reason",
    "fill_hash", "wallet_after",
  ], "global event")
  hash(event.event_hash, "event_hash")
  hash(event.request_hash, "event.request_hash")
  hash(event.bar_hash, "event.bar_hash")
  if (event.fill_hash !== null) hash(event.fill_hash, "event.fill_hash")
  text(event.event_time, "event_time")
  text(event.lane_id, "event.lane_id")
  text(event.symbol, "event.symbol")
  finite(event.execution_price, "execution_price", true)
  finite(event.quantity, "quantity", true)
  finite(event.isolated_collateral, "isolated_collateral", true)
  finite(event.entry_fee, "entry_fee")
  finite(event.required_available_cash, "required_available_cash", true)
  assertWallet(event.wallet_before)
  assertWallet(event.wallet_after)
  if (event.boundary_phase !== 20 || event.source_kind !== "bar_open"
      || (event.position_side !== "long" && event.position_side !== "short")
      || event.queue_ordinal < 1 || event.priority_rank < 1
      || event.required_available_cash !== addReplayDecimalValues(event.isolated_collateral, event.entry_fee)) {
    throw new Error("runtime shared wallet global event semantics are invalid")
  }
  if (event.admission === "filled") {
    if (event.admission_reason !== "cash_reserved_and_fill_committed" || event.fill_hash === null
        || event.wallet_before.available_cash < event.required_available_cash
        || event.wallet_after.settled_cash !== addReplayDecimalValues(event.wallet_before.settled_cash, -event.entry_fee)
        || event.wallet_after.reserved_isolated_collateral
          !== addReplayDecimalValues(event.wallet_before.reserved_isolated_collateral, event.isolated_collateral)
        || event.wallet_after.available_cash
          !== addReplayDecimalValues(event.wallet_before.available_cash, -event.required_available_cash)) {
      throw new Error("runtime shared wallet filled event cash commit is invalid")
    }
  } else if (event.admission_reason !== "insufficient_available_cash" || event.fill_hash !== null
      || event.wallet_before.available_cash >= event.required_available_cash
      || JSON.stringify(event.wallet_after) !== JSON.stringify(event.wallet_before)) {
    throw new Error("runtime shared wallet rejected event must not mutate cash")
  }
  if (event.event_hash !== replayRuntimeSharedWalletEventHash(event)) {
    throw new Error("runtime shared wallet global event hash mismatch")
  }
}

function assertWallet(wallet: ReplayRuntimeSharedWalletSnapshot): void {
  exactFields(wallet, ["settled_cash", "reserved_isolated_collateral", "available_cash"], "wallet")
  finite(wallet.settled_cash, "wallet.settled_cash")
  finite(wallet.reserved_isolated_collateral, "wallet.reserved_isolated_collateral")
  finite(wallet.available_cash, "wallet.available_cash")
  if (wallet.settled_cash < 0 || wallet.reserved_isolated_collateral < 0 || wallet.available_cash < 0
      || wallet.available_cash !== addReplayDecimalValues(wallet.settled_cash, -wallet.reserved_isolated_collateral)) {
    throw new Error("runtime shared wallet snapshot does not reconcile")
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => addReplayDecimalValues(total, value), 0)
}

function exactFields(value: object, fields: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    throw new Error(`runtime shared wallet ${label} fields are not exact`)
  }
}

function text(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`runtime shared wallet ${field} is required`)
}

function hash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`runtime shared wallet ${field} must be a canonical hash`)
}

function finite(value: number, field: string, positive = false): void {
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    throw new Error(`runtime shared wallet ${field} must be ${positive ? "positive" : "non-negative"}`)
  }
}
