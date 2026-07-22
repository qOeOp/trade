import {
  compileExecutionContract,
  type ExecutionContract,
  type ExecutionContractInput,
} from "../../../../contracts/execution-contract/src/execution-contract"
import { readTargetAction, type ExecutableTargetAction } from "../../../../contracts/preflight-contract/src/target-action"
import { readPositionSide, readRequiredSymbol } from "../../../shared/execution-input"

type JSONRecord = Record<string, unknown>

interface PlanEvent {
  event_key: string
  chain_id: string
  kind: "order_fill"
  body_json: JSONRecord
  created_at: string
}

function buildRecordedExecutionEvent(input: JSONRecord): PlanEvent {
  const preflight = asRecord(input.preflight_result)
  if (preflight.verdict !== "armable") {
    throw new Error("record-execution requires preflight_result.verdict=armable")
  }

  const contract = compileExecutionContract(asRecord(input.execution_contract_input) as unknown as ExecutionContractInput)
  const executionResult = asRecord(input.execution_result)
  validateExecutionResultForTarget("place_entry", executionResult)
  const submitResult = asRecord(executionResult.result)
  const confirmedResult = asRecord(executionResult.confirmedResult)
  const primaryEntry = contract.entries[0]
  const body: JSONRecord = {
    sub_kind: "submit",
    lifecycle_status: "submitted",
    client_order_id: readClientOrderId(contract, executionResult, submitResult, confirmedResult),
    exchange_order_id: readExchangeOrderId(submitResult, confirmedResult),
    symbol: contract.symbol,
    side: contract.side === "long" ? "BUY" : "SELL",
    position_side: contract.position_side,
    order_type: primaryEntry?.type,
    qty: primaryEntry?.quantity,
    price: primaryEntry?.price,
    stop_price: primaryEntry?.stop_price,
    source: "trade_flow",
    source_observe_event_key: contract.source_observe_event_key,
    execution_contract_snapshot: contract,
    execution_method: stringField(executionResult.method),
    execution_result: executionResult,
  }
  removeUndefined(body)

  return {
    event_key: stringField(input.event_key) || crypto.randomUUID(),
    chain_id: contract.chain_id,
    kind: "order_fill",
    body_json: body,
    created_at: stringField(input.created_at) || new Date().toISOString(),
  }
}

function buildRecordedActionEvents(input: JSONRecord): PlanEvent[] {
  const targetAction = readTargetAction(input.target_action)
  if (targetAction === "place_entry") {
    return [buildRecordedExecutionEvent(input)]
  }
  if (targetAction === "cancel_order") {
    return [buildRecordedCancelEvent(input)]
  }
  if (targetAction === "sync_protection") {
    return buildRecordedProtectionEvents(input)
  }
  if (targetAction === "adjust_position") {
    return [buildRecordedPositionAdjustEvent(input)]
  }
  throw new Error("no_action has no recorded execution event")
}

function validateExecutionResultForTarget(
  targetAction: ExecutableTargetAction,
  executionResult: JSONRecord,
): void {
  if (targetAction === "place_entry") {
    requireExecutionMethod(targetAction, executionResult)
    requireRecordField(targetAction, executionResult, "request")
    requireRecordField(targetAction, executionResult, "result")
    return
  }
  if (targetAction === "cancel_order") {
    requireExecutionMethod(targetAction, executionResult)
    requireRecordField(targetAction, executionResult, "result")
    return
  }
  if (targetAction === "sync_protection") {
    requireExecutionMethod(targetAction, executionResult)
    const created = executionResult.created
    if (!Array.isArray(created) || created.length === 0) {
      throw new Error("sync_protection execution_result.created must contain at least one leg")
    }
    for (const [index, leg] of created.entries()) {
      if (!isPlainRecord(leg)) {
        throw new Error(`sync_protection execution_result.created[${index}] must be an object`)
      }
      requireRecordField(targetAction, leg, "request", `execution_result.created[${index}]`)
      requireRecordField(targetAction, leg, "result", `execution_result.created[${index}]`)
    }
    return
  }
  if (targetAction === "adjust_position") {
    requireExecutionMethod(targetAction, executionResult)
    requireRecordField(targetAction, executionResult, "reduced")
    if (!Object.prototype.hasOwnProperty.call(executionResult, "remainingPosition")) {
      throw new Error("adjust_position execution_result.remainingPosition is required")
    }
    return
  }
  throw new Error(`${targetAction} has no execution result contract`)
}

function unwrapToolResponse(value: unknown): JSONRecord {
  const response = asRecord(value)
  if (response.ok === false) {
    throw new Error(stringField(response.error) || "tool returned ok=false")
  }
  return asRecord(response.data ?? response)
}

function requireExecutionMethod(targetAction: ExecutableTargetAction, executionResult: JSONRecord): void {
  if (!stringField(executionResult.method)) {
    throw new Error(`${targetAction} execution_result.method is required`)
  }
}

function requireRecordField(
  targetAction: ExecutableTargetAction,
  record: unknown,
  field: string,
  path = "execution_result",
): void {
  const parent = asRecord(record)
  if (!isPlainRecord(parent[field])) {
    throw new Error(`${targetAction} ${path}.${field} must be an object`)
  }
}

function isPlainRecord(value: unknown): value is JSONRecord {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function buildRecordedCancelEvent(input: JSONRecord): PlanEvent {
  const executionResult = asRecord(input.execution_result)
  validateExecutionResultForTarget("cancel_order", executionResult)
  const request = asRecord(input.request)
  const result = asRecord(executionResult.result)
  const clientOrderId = readActionClientOrderId(
    request.orig_client_order_id,
    request.origClientOrderId,
    request.client_order_id,
    request.clientOrderId,
    request.client_algo_id,
    request.clientAlgoId,
    result.clientOrderId,
    result.clientAlgoId,
  )
  return buildActionPlanEvent(input, compactRecord({
    sub_kind: "cancel",
    lifecycle_status: "cancelled",
    client_order_id: clientOrderId || readActionExchangeOrderId(request.order_id, request.orderId, request.algo_id, request.algoId, result.orderId, result.algoId),
    exchange_order_id: readActionExchangeOrderId(request.order_id, request.orderId, request.algo_id, request.algoId, result.orderId, result.algoId),
    symbol: readRequiredSymbol(input),
    execution_method: stringField(executionResult.method),
  }))
}

function buildRecordedProtectionEvents(input: JSONRecord): PlanEvent[] {
  const executionResult = asRecord(input.execution_result)
  validateExecutionResultForTarget("sync_protection", executionResult)
  const created = Array.isArray(executionResult.created) ? executionResult.created.map(asRecord) : []
  if (created.length === 0) {
    throw new Error("sync_protection execution_result.created must contain at least one leg")
  }
  return created.map((leg, index) => {
    const request = asRecord(leg.request)
    const result = asRecord(leg.result)
    const clientOrderId = readActionClientOrderId(
      result.clientAlgoId,
      result.clientOrderId,
      request.newClientAlgoId,
      request.newClientOrderId,
    ) || `algo-${readActionExchangeOrderId(result.algoId, result.orderId)}`
    return buildActionPlanEvent(input, compactRecord({
      sub_kind: "submit",
      lifecycle_status: "submitted",
      client_order_id: clientOrderId,
      exchange_order_id: readActionExchangeOrderId(result.algoId, result.orderId),
      symbol: stringField(request.symbol) || readRequiredSymbol(input),
      side: stringField(request.side),
      position_side: stringField(request.positionSide),
      order_type: stringField(request.type),
      qty: numberOrUndefined(request.quantity),
      price: numberOrUndefined(request.price),
      stop_price: numberOrUndefined(request.triggerPrice),
      protective: true,
      protection_leg: stringField(leg.leg) || `leg_${index + 1}`,
      execution_method: stringField(executionResult.method),
    }))
  })
}

function buildRecordedPositionAdjustEvent(input: JSONRecord): PlanEvent {
  const executionResult = asRecord(input.execution_result)
  validateExecutionResultForTarget("adjust_position", executionResult)
  const reduced = asRecord(executionResult.reduced)
  const executedQty = numberOrUndefined(reduced.executedQty) ?? numberOrUndefined(asRecord(input.request).reduce_quantity)
  return buildActionPlanEvent(input, compactRecord({
    sub_kind: "fill",
    lifecycle_status: "filled",
    client_order_id: readActionClientOrderId(reduced.clientOrderId) || `order-${readActionExchangeOrderId(reduced.orderId)}`,
    exchange_order_id: readActionExchangeOrderId(reduced.orderId),
    symbol: stringField(reduced.symbol) || readRequiredSymbol(input),
    side: stringField(reduced.side),
    position_side: stringField(reduced.positionSide) || readPositionSide(input),
    order_type: stringField(reduced.type) || "MARKET",
    qty: numberOrUndefined(reduced.origQty) ?? numberOrUndefined(asRecord(input.request).reduce_quantity),
    cumulative_filled_qty: executedQty,
    fill_delta_qty: executedQty,
    filled_qty: executedQty,
    avg_fill_price: readAverageFillPrice(reduced),
    execution_method: stringField(executionResult.method),
    remaining_position: executionResult.remainingPosition ?? null,
  }))
}

function buildActionPlanEvent(input: JSONRecord, body: JSONRecord): PlanEvent {
  const targetAction = readTargetAction(input.target_action)
  const executionResult = asRecord(input.execution_result)
  const created_at = stringField(input.created_at) || new Date().toISOString()
  return {
    event_key: stringField(input.event_key) || crypto.randomUUID(),
    chain_id: readActionChainId(input),
    kind: "order_fill",
    body_json: {
      ...body,
      source: "trade_flow",
      source_observe_event_key: readActionSourceObserveEventKey(input),
      target_action: targetAction,
      execution_action_snapshot: {
        target_action: targetAction,
        request: asRecord(input.request),
      },
      execution_result: executionResult,
    },
    created_at,
  }
}

function readClientOrderId(
  contract: ExecutionContract,
  executionResult: JSONRecord,
  submitResult: JSONRecord,
  confirmedResult: JSONRecord,
): string {
  return stringField(submitResult.clientOrderId)
    || stringField(submitResult.clientAlgoId)
    || stringField(confirmedResult.clientOrderId)
    || stringField(confirmedResult.clientAlgoId)
    || stringField(executionResult.clientOrderId)
    || stringField(executionResult.clientAlgoId)
    || contract.entries[0]?.client_order_id
    || ""
}

function readExchangeOrderId(submitResult: JSONRecord, confirmedResult: JSONRecord): string {
  const candidate = submitResult.orderId ?? submitResult.algoId ?? confirmedResult.orderId ?? confirmedResult.algoId
  return candidate == null ? "" : String(candidate)
}

function readActionChainId(input: JSONRecord): string {
  const request = asRecord(input.request)
  const chainId = firstString(
    input.chain_id,
    request.chain_id,
    asRecord(input.observe).chain_id,
    asRecord(input.execution_contract_input).chain_id,
  )
  if (!chainId) {
    throw new Error("recorded action event requires chain_id")
  }
  return chainId
}

function readActionSourceObserveEventKey(input: JSONRecord): string {
  const request = asRecord(input.request)
  const key = firstString(
    input.source_observe_event_key,
    input.observe_event_key,
    request.source_observe_event_key,
    asRecord(input.execution_contract_input).source_observe_event_key,
  )
  if (!key) {
    throw new Error("recorded action event requires source_observe_event_key")
  }
  return key
}

function readId(...values: unknown[]): string {
  for (const value of values) {
    if (value == null || value === "") {
      continue
    }
    return String(value)
  }
  return ""
}

function readActionClientOrderId(...values: unknown[]): string {
  return readId(...values)
}

function readActionExchangeOrderId(...values: unknown[]): string {
  return readId(...values)
}

function readAverageFillPrice(record: JSONRecord): number | undefined {
  const direct = numberOrUndefined(record.avgPrice) ?? numberOrUndefined(record.avg_fill_price)
  if (direct != null && direct > 0) {
    return direct
  }
  const cumulativeQuote = numberOrUndefined(record.cumQuote)
  const executedQty = numberOrUndefined(record.executedQty)
  if (cumulativeQuote != null && executedQty != null && executedQty > 0) {
    return cumulativeQuote / executedQty
  }
  return numberOrUndefined(record.price)
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const candidate = stringField(value)
    if (candidate) {
      return candidate
    }
  }
  return ""
}

function compactRecord(record: JSONRecord): JSONRecord {
  const output: JSONRecord = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "") {
      output[key] = value
    }
  }
  return output
}

function removeUndefined(record: JSONRecord): void {
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === "") {
      delete record[key]
    }
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value == null || value === "") {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
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

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

export {
  buildRecordedActionEvents,
  buildRecordedExecutionEvent,
  unwrapToolResponse,
  validateExecutionResultForTarget,
  type PlanEvent,
}
