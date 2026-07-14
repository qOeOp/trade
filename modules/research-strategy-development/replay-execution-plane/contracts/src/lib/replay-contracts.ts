import { createHash } from "node:crypto"

export const REPLAY_REQUEST_SCHEMA_VERSION = "trade.rd-replay-execution-request.v1" as const
export const REPLAY_RESULT_SCHEMA_VERSION = "trade.rd-replay-result.v1" as const
export const REPLAY_ARTIFACT_SCHEMA_VERSION = "trade.rd-replay-artifact-manifest.v1" as const
export const REPLAY_SIMULATOR_POLICY_VERSION = "rd-replay-simulator-v1" as const

export interface ReplayExecutionRequest {
  schema_version: typeof REPLAY_REQUEST_SCHEMA_VERSION
  run_id: string
  idempotency_key: string
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  trial_id: string
  candidate_id: string
  candidate_hash: string
  identity_hash_policy_version: string
  experiment_contract_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  harness_hash: string
  assumptions_hash: string
  strategy_policy_hash?: string
  symbol: string
  timeframe: string
  initial_cash: number
  order: {
    side: "long" | "short"
    quantity: number
    signal_time: string
    earliest_executable_time: string
    stop_price: number
    target_price: number
  }
  cost_policy: {
    policy_id: string
    version: string
    fee_bps: number
    slippage_bps: number
  }
  simulator_policy: {
    version: typeof REPLAY_SIMULATOR_POLICY_VERSION
    signal_visibility: "closed_candle"
    earliest_execution: "next_open"
    same_bar_policy: "stop_first"
    gap_fill_policy: "worse_open"
    position_accounting: "average_cost"
    funding_timing: "exact_event"
  }
  random_seed: number
}

export interface ReplayMarketBar {
  open_time: string
  close_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  closed: true
}

export interface ReplayFundingEvent {
  timestamp: string
  rate: number
  mark_price: number
}

export interface ReplayFill {
  fill_id: string
  order_role: "entry" | "stop" | "target" | "end_of_data"
  timestamp: string
  side: "buy" | "sell"
  quantity: number
  price: number
  fee: number
  reduce_only: boolean
}

export interface ReplayLedgerEntry {
  entry_id: string
  timestamp: string
  kind: "initial_cash" | "trade_cash" | "fee" | "funding" | "realized_pnl" | "ending_equity"
  amount: number
  balance_after: number
  ref: string
}

export interface ReplayEvidenceFingerprint {
  experiment_contract_hash: string
  trial_group_hash: string
  candidate_hash: string
  identity_hash_policy_version: string
  dataset_hash: string
  harness_hash: string
  assumptions_hash: string
  cost_policy_hash: string
  simulator_policy_version: string
  request_hash: string
  result_hash: string
  random_seed: number
}

export interface ReplayResult {
  schema_version: typeof REPLAY_RESULT_SCHEMA_VERSION
  run_id: string
  status: "completed" | "failed" | "cancelled"
  started_at: string
  completed_at: string
  fills: ReplayFill[]
  ledger: ReplayLedgerEntry[]
  metrics: {
    initial_cash: number
    ending_equity: number
    net_pnl: number
    return_fraction: number
    realized_pnl: number
    total_fees: number
    total_funding: number
    trade_count: number
  }
  limitations: Array<{
    code: string
    severity: "info" | "resolution_limited" | "unsupported"
    detail: string
  }>
  fingerprint: ReplayEvidenceFingerprint
}

export interface ReplayArtifactManifest {
  schema_version: typeof REPLAY_ARTIFACT_SCHEMA_VERSION
  artifact_id: string
  run_id: string
  result_hash: string
  files: Array<{ role: string; ref: string; sha256: string }>
  created_at: string
}

export function assertReplayExecutionRequest(value: ReplayExecutionRequest): void {
  if (value.schema_version !== REPLAY_REQUEST_SCHEMA_VERSION) fail("unsupported Replay request schema")
  for (const field of [
    "run_id", "idempotency_key", "experiment_id", "trial_group_id", "trial_id", "candidate_id",
    "identity_hash_policy_version", "dataset_manifest_ref", "symbol", "timeframe",
  ] as const) requireText(value[field], field)
  for (const field of [
    "trial_group_hash", "candidate_hash", "experiment_contract_hash", "dataset_hash", "harness_hash", "assumptions_hash",
  ] as const) requireHash(value[field], field)
  if (value.strategy_policy_hash) requireHash(value.strategy_policy_hash, "strategy_policy_hash")
  requirePositive(value.initial_cash, "initial_cash")
  requirePositive(value.order.quantity, "order.quantity")
  requirePositive(value.order.stop_price, "order.stop_price")
  requirePositive(value.order.target_price, "order.target_price")
  requireTimestamp(value.order.signal_time, "order.signal_time")
  requireTimestamp(value.order.earliest_executable_time, "order.earliest_executable_time")
  if (Date.parse(value.order.earliest_executable_time) <= Date.parse(value.order.signal_time)) {
    fail("earliest executable time must be after signal time")
  }
  if (value.order.side === "long" && value.order.stop_price >= value.order.target_price) fail("long stop must be below target")
  if (value.order.side === "short" && value.order.stop_price <= value.order.target_price) fail("short stop must be above target")
  requireNonNegative(value.cost_policy.fee_bps, "cost_policy.fee_bps")
  requireNonNegative(value.cost_policy.slippage_bps, "cost_policy.slippage_bps")
  requireText(value.cost_policy.policy_id, "cost_policy.policy_id")
  requireText(value.cost_policy.version, "cost_policy.version")
  const policy = value.simulator_policy
  if (policy.version !== REPLAY_SIMULATOR_POLICY_VERSION
      || policy.signal_visibility !== "closed_candle"
      || policy.earliest_execution !== "next_open"
      || policy.same_bar_policy !== "stop_first"
      || policy.gap_fill_policy !== "worse_open"
      || policy.position_accounting !== "average_cost"
      || policy.funding_timing !== "exact_event") fail("unsupported simulator policy")
  if (!Number.isSafeInteger(value.random_seed) || value.random_seed < 0) fail("random_seed must be a non-negative safe integer")
}

export function assertReplayMarketBars(bars: ReplayMarketBar[]): void {
  let priorClose = Number.NEGATIVE_INFINITY
  for (const [index, bar] of bars.entries()) {
    requireTimestamp(bar.open_time, `bars[${index}].open_time`)
    requireTimestamp(bar.close_time, `bars[${index}].close_time`)
    const open = Date.parse(bar.open_time)
    const close = Date.parse(bar.close_time)
    if (open >= close || open < priorClose) fail("bars must be non-overlapping and chronologically ordered")
    priorClose = close
    for (const [field, item] of Object.entries({ open: bar.open, high: bar.high, low: bar.low, close: bar.close })) {
      requirePositive(item, `bars[${index}].${field}`)
    }
    requireNonNegative(bar.volume, `bars[${index}].volume`)
    if (bar.closed !== true) fail("Replay only accepts closed bars")
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low > bar.high) {
      fail("invalid OHLC envelope")
    }
  }
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical JSON rejects non-finite numbers")
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  fail("canonical JSON rejects unsupported values")
}

function requireHash(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) fail(`${field} must be a lowercase sha256 hex digest`)
}

function requireTimestamp(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!Number.isFinite(Date.parse(text))) fail(`${field} must be an ISO timestamp`)
}

function requirePositive(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${field} must be positive`)
}

function requireNonNegative(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${field} must be non-negative`)
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${field} is required`)
  return value.trim()
}

function fail(message: string): never {
  throw new Error(message)
}
