type JSONRecord = Record<string, unknown>

interface FlowEvent {
  event_key: string
  chain_id: string
  kind: string
  body_json: JSONRecord
  created_at: string
}

interface ReconcileInput {
  chain_id: string
  local_events: FlowEvent[]
  local_state: JSONRecord
  account_snapshot: JSONRecord
  created_at?: string
}

interface ReconcileResult {
  chain_id: string
  compared_at: string
  can_reconcile: boolean
  drafts: FlowEvent[]
  unmatched: JSONRecord[]
}

function buildReconcileDrafts(input: ReconcileInput): ReconcileResult {
  const comparedAt = input.created_at || new Date().toISOString()
  const snapshot = asRecord(input.account_snapshot.data ?? input.account_snapshot)
  const known = collectKnownOrderFacts(input.local_events)
  const localOrders = collectLocalOpenOrders(input.local_state)
  const drafts: FlowEvent[] = []
  const unmatched: JSONRecord[] = []
  const proposed = new Set<string>()

  for (const order of readSnapshotOrders(snapshot, "open")) {
    const clientOrderId = readClientOrderId(order)
    if (!clientOrderId) {
      unmatched.push({ kind: "open_order_without_client_id", order })
      continue
    }
    if (!belongsToChain(clientOrderId, input.chain_id)) {
      unmatched.push({ kind: "open_order_unassigned", client_order_id: clientOrderId, order })
      continue
    }
    if (isProtectiveOrder(order)) {
      if (!localOrders.has(clientOrderId) && !known.has(factKey("submit", clientOrderId))) {
        unmatched.push({ kind: "protective_drift", client_order_id: clientOrderId, order })
      }
      continue
    }
    if (!localOrders.has(clientOrderId) && !known.has(factKey("submit", clientOrderId))) {
      pushDraft(drafts, proposed, input.chain_id, comparedAt, "submit", order)
    }
    const executedQty = numberField(order.executedQty)
    if (executedQty > 0 && !known.has(factKey("partial_fill", clientOrderId))) {
      pushDraft(drafts, proposed, input.chain_id, comparedAt, "partial_fill", order)
    }
  }

  for (const order of readSnapshotOrders(snapshot, "history")) {
    const clientOrderId = readClientOrderId(order)
    if (!clientOrderId || !belongsToChain(clientOrderId, input.chain_id)) {
      continue
    }
    const status = stringField(order.status).toUpperCase()
    if (status === "FILLED" && !known.has(factKey("fill", clientOrderId))) {
      pushDraft(drafts, proposed, input.chain_id, comparedAt, "fill", order)
    }
    if (status === "PARTIALLY_FILLED" && !known.has(factKey("partial_fill", clientOrderId))) {
      pushDraft(drafts, proposed, input.chain_id, comparedAt, "partial_fill", order)
    }
    if (status === "CANCELED" && !known.has(factKey("cancel", clientOrderId))) {
      pushDraft(drafts, proposed, input.chain_id, comparedAt, "cancel", order)
    }
  }

  appendPositionMismatches(unmatched, snapshot, input.local_state, drafts)

  return {
    chain_id: input.chain_id,
    compared_at: comparedAt,
    can_reconcile: unmatched.length === 0,
    drafts,
    unmatched,
  }
}

function pushDraft(
  drafts: FlowEvent[],
  proposed: Set<string>,
  chainId: string,
  created_at: string,
  subKind: "submit" | "partial_fill" | "fill" | "cancel",
  order: JSONRecord,
): void {
  const clientOrderId = readClientOrderId(order)
  const key = factKey(subKind, clientOrderId)
  if (proposed.has(key)) {
    return
  }
  proposed.add(key)
  drafts.push({
    event_key: `reconcile-${chainId}-${subKind}-${clientOrderId}`,
    chain_id: chainId,
    kind: "order_fill",
    created_at,
    body_json: buildReconcileBody(subKind, order),
  })
}

function buildReconcileBody(subKind: string, order: JSONRecord): JSONRecord {
  const body: JSONRecord = {
    sub_kind: subKind,
    lifecycle_status: lifecycleStatusForSubKind(subKind),
    client_order_id: readClientOrderId(order),
    exchange_order_id: readExchangeOrderId(order),
    symbol: stringField(order.symbol),
    side: stringField(order.side),
    position_side: stringField(order.positionSide) || stringField(order.position_side),
    order_type: stringField(order.type) || stringField(order.orderType),
    qty: numberField(order.origQty) || numberField(order.quantity),
    price: numberOrUndefined(order.price),
    stop_price: numberOrUndefined(order.stopPrice) ?? numberOrUndefined(order.triggerPrice),
    filled_qty: subKind === "submit" || subKind === "cancel" ? undefined : numberField(order.executedQty),
    avg_fill_price: subKind === "submit" || subKind === "cancel" ? undefined : readAverageFillPrice(order),
    source: "reconcile",
    reconcile_snapshot_source: stringField(order.source),
    reconcile_snapshot_source_type: stringField(order.sourceType),
  }
  removeUndefined(body)
  return body
}

function lifecycleStatusForSubKind(subKind: string): string {
  if (subKind === "partial_fill") return "partially_filled"
  if (subKind === "fill") return "reconciled"
  if (subKind === "cancel") return "cancelled"
  return "submitted"
}

function readSnapshotOrders(snapshot: JSONRecord, source: "open" | "history"): JSONRecord[] {
  const bucket = asRecord(source === "open" ? snapshot.openOrders : snapshot.orderHistory)
  const regular = Array.isArray(bucket.regular) ? bucket.regular.map((order) => ({ ...asRecord(order), reconcile_order_bucket: "regular" })) : []
  const protective = Array.isArray(bucket.protective) ? bucket.protective.map((order) => ({ ...asRecord(order), reconcile_order_bucket: "protective" })) : []
  return [...regular, ...protective]
}

function collectKnownOrderFacts(events: FlowEvent[]): Set<string> {
  const known = new Set<string>()
  for (const event of events) {
    if (event.kind !== "order_fill") {
      continue
    }
    const subKind = stringField(event.body_json.sub_kind)
    const clientOrderId = stringField(event.body_json.client_order_id)
    if (subKind && clientOrderId) {
      known.add(factKey(subKind, clientOrderId))
    }
  }
  return known
}

function collectLocalOpenOrders(localState: JSONRecord): Set<string> {
  const orders = Array.isArray(localState.current_orders) ? localState.current_orders.map(asRecord) : []
  return new Set(orders.map((order) => stringField(order.client_order_id)).filter(Boolean))
}

function appendPositionMismatches(unmatched: JSONRecord[], snapshot: JSONRecord, localState: JSONRecord, drafts: FlowEvent[]): void {
  const positions = Array.isArray(snapshot.positions) ? snapshot.positions.map(asRecord) : []
  const localPosition = asRecord(localState.current_position)
  const localQty = projectedLocalNetQty(numberField(localPosition.net_qty), drafts)
  const exchangeNetQty = positions.reduce((sum, position) => sum + numberField(position.positionAmt), 0)
  if (Math.abs(exchangeNetQty - localQty) > 1e-12) {
    unmatched.push({
      kind: "position_delta_requires_history",
      exchange_net_qty: exchangeNetQty,
      local_net_qty: localQty,
    })
  }
}

function projectedLocalNetQty(localQty: number, drafts: FlowEvent[]): number {
  return drafts.reduce((qty, draft) => {
    const body = draft.body_json
    const subKind = stringField(body.sub_kind)
    if (subKind !== "fill" && subKind !== "partial_fill") {
      return qty
    }
    const filledQty = numberField(body.filled_qty) || numberField(body.qty)
    if (filledQty <= 0) {
      return qty
    }
    return qty + (stringField(body.side) === "SELL" ? -filledQty : filledQty)
  }, localQty)
}

function isProtectiveOrder(order: JSONRecord): boolean {
  const bucket = stringField(order.reconcile_order_bucket)
  const sourceType = stringField(order.sourceType).toLowerCase()
  const orderType = stringField(order.type || order.orderType).toUpperCase()
  return bucket === "protective"
    || sourceType === "protective"
    || sourceType === "algo"
    || (orderType.includes("STOP") && stringField(order.reduceOnly).toLowerCase() === "true")
}

function readClientOrderId(order: JSONRecord): string {
  return stringField(order.clientOrderId) || stringField(order.clientAlgoId) || stringField(order.client_order_id)
}

function readExchangeOrderId(order: JSONRecord): string {
  const value = order.orderId ?? order.algoId ?? order.actualOrderId ?? order.exchange_order_id
  return value == null ? "" : String(value)
}

function readAverageFillPrice(order: JSONRecord): number | undefined {
  const avgPrice = numberOrUndefined(order.avgPrice)
  if (avgPrice && avgPrice > 0) {
    return avgPrice
  }
  const executedQty = numberField(order.executedQty)
  const cumQuote = numberField(order.cumQuote)
  if (executedQty > 0 && cumQuote > 0) {
    return cumQuote / executedQty
  }
  return numberOrUndefined(order.price)
}

function factKey(subKind: string, clientOrderId: string): string {
  return `${subKind}:${clientOrderId}`
}

function belongsToChain(clientOrderId: string, chainId: string): boolean {
  return clientOrderId === chainId || clientOrderId.startsWith(`${chainId}-`)
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

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function removeUndefined(record: JSONRecord): void {
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === "") {
      delete record[key]
    }
  }
}

export {
  buildReconcileDrafts,
  type FlowEvent,
  type ReconcileInput,
  type ReconcileResult,
}
