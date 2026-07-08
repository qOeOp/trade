type JSONRecord = Record<string, unknown>

const OBSERVE_SIDES = ["long", "short"] as const
type ObserveSide = typeof OBSERVE_SIDES[number]

interface ObserveInput {
  chain_id: string
  symbol: string
  side: ObserveSide
  strategy_ref: string
  setup_id?: string
  account_snapshot: JSONRecord
  market_snapshot?: JSONRecord
  market_refs?: string[]
  plan_seed?: JSONRecord
  created_at?: string
}

interface ObserveEvent {
  event_key: string
  chain_id: string
  kind: "observe"
  body_json: JSONRecord
  created_at: string
}

function buildObserveEvent(input: ObserveInput): ObserveEvent {
  const createdAt = input.created_at || new Date().toISOString()
  const account = buildAccountProjection(input.account_snapshot, input.symbol)
  const body: JSONRecord = {
    symbol: input.symbol.toUpperCase(),
    side: input.side,
    strategy_ref: input.strategy_ref,
    setup_id: input.setup_id,
    direction_state: input.plan_seed?.direction_state ?? "中性",
    execution_verdict: input.plan_seed?.execution_verdict ?? "放弃",
    thesis: input.plan_seed?.thesis ?? "observe only",
    entry_intent: input.plan_seed?.entry_intent ?? "no entry intent",
    exit_intent: input.plan_seed?.exit_intent ?? "no exit intent",
    invalidation: input.plan_seed?.invalidation ?? "not set",
    expected_rr_net: input.plan_seed?.expected_rr_net ?? 0,
    stop_price: input.plan_seed?.stop_price,
    risk_budget_usdt: input.plan_seed?.risk_budget_usdt,
    action_intent: input.plan_seed?.action_intent ?? {
      target_action: "no_action",
    },
    account,
    microstructure: {
      notes: buildMarketNotes(input.market_snapshot),
      refs: input.market_refs ?? [],
    },
    preflight_result: {
      verdict: "abstain",
      blocked_by: [],
      warnings: [],
    },
    decision_summary: "observe snapshot built from account and market projections",
    created_at: createdAt,
  }
  removeUndefined(body)

  return {
    event_key: crypto.randomUUID(),
    chain_id: input.chain_id,
    kind: "observe",
    body_json: body,
    created_at: createdAt,
  }
}

function buildAccountProjection(snapshot: JSONRecord, symbol: string): JSONRecord {
  const data = asRecord(snapshot.data ?? snapshot)
  const account = asRecord(data.account)
  const positions = Array.isArray(data.positions) ? data.positions.map(asRecord) : []
  const openOrders = asRecord(data.openOrders)
  const regular = Array.isArray(openOrders.regular) ? openOrders.regular.map(asRecord) : []
  const protective = Array.isArray(openOrders.protective) ? openOrders.protective.map(asRecord) : []
  const upperSymbol = symbol.toUpperCase()
  const symbolPositions = positions.filter((item) => stringField(item.symbol).toUpperCase() === upperSymbol)
  const symbolRegular = regular.filter((item) => stringField(item.symbol).toUpperCase() === upperSymbol)
  const symbolProtective = protective.filter((item) => stringField(item.symbol).toUpperCase() === upperSymbol)

  return {
    equity_usdt: numberField(account.totalMarginBalance) || numberField(account.totalWalletBalance),
    available_balance_usdt: numberField(account.availableBalance),
    position_state: symbolPositions.length > 0 ? summarizePositions(symbolPositions) : "flat",
    order_state: summarizeOrders(symbolRegular, symbolProtective),
    snapshot_ref: stringField(snapshot.snapshot_ref) || stringField(data.snapshot_ref),
  }
}

function summarizePositions(positions: JSONRecord[]): string {
  return positions
    .map((item) => `${stringField(item.positionSide) || "BOTH"} ${stringField(item.positionAmt)} @ ${stringField(item.entryPrice)}`)
    .join("; ")
}

function summarizeOrders(regular: JSONRecord[], protective: JSONRecord[]): string {
  if (regular.length === 0 && protective.length === 0) {
    return "none"
  }
  return `regular=${regular.length}; protective=${protective.length}`
}

function buildMarketNotes(snapshot: JSONRecord | undefined): string {
  if (!snapshot) {
    return "market snapshot unavailable"
  }
  const data = asRecord(snapshot.data ?? snapshot)
  const parts = [
    stringField(data.symbol),
    fieldWithValue("mark", data.markPrice),
    fieldWithValue("last", data.lastPrice),
    fieldWithValue("funding", data.lastFundingRate),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" ") : "market snapshot available"
}

function fieldWithValue(label: string, value: unknown): string {
  const text = stringField(value)
  return text ? `${label}=${text}` : ""
}

function removeUndefined(record: JSONRecord): void {
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === "") {
      delete record[key]
    }
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  if (typeof value === "string") {
    return value.trim()
  }
  if (typeof value === "number") {
    return String(value)
  }
  return ""
}

function numberField(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export {
  OBSERVE_SIDES,
  buildAccountProjection,
  buildObserveEvent,
  type ObserveEvent,
  type ObserveInput,
  type ObserveSide,
}
