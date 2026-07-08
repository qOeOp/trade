import { Database } from "bun:sqlite"
import {
  compileExecutionContract,
  type ExecutionContract,
  type ExecutionContractInput,
} from "../../../binance-order-preview/scripts/execution-contract"
import { evaluatePreflight } from "../../../plan-preflight/scripts/main"
import { asRecord, removeUndefined, stringField, type JSONRecord } from "./json"
import { reduceFlowState } from "./flow-state"
import { appendPlanEvent, readFlowEvents, readLatestOrderFill, type PlanEvent } from "./plan-events"
import type { RunMode } from "./run-mode"

export type TargetAction = "no_action" | "place_entry" | "cancel_order" | "sync_protection" | "adjust_position"
export type ExecutionGateResult =
  | { status: "ready" }
  | { status: "skipped"; reason: string; evidence?: JSONRecord }

export function buildRecordedExecutionEvent(input: JSONRecord): PlanEvent {
  const preflight = asRecord(input.preflight_result)
  if (preflight.verdict !== "armable") {
    throw new Error("record-execution requires preflight_result.verdict=armable")
  }

  const contract = compileExecutionContract(asRecord(input.execution_contract_input) as unknown as ExecutionContractInput)
  const executionResult = asRecord(input.execution_result)
  const submitResult = asRecord(executionResult.result)
  const confirmedResult = asRecord(executionResult.confirmedResult)
  const primaryEntry = contract.entries[0]
  const body: JSONRecord = {
    sub_kind: "submit",
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

export function runOneFlowStep(db: Database, input: JSONRecord, mode: RunMode): JSONRecord {
  if (mode !== "dry-run" && mode !== "shadow") {
    throw new Error(`unsupported run mode: ${mode}`)
  }

  const preflightResult = evaluatePreflight({
    plan: asRecord(input.plan),
    observe: asRecord(input.observe),
    strategy: asRecord(input.strategy),
    account_config: asRecord(input.account_config),
    target_action: readTargetAction(input.target_action),
    request: asRecord(input.request),
    aggregate_view: asRecord(input.aggregate_view),
    runtime_health: asRecord(input.runtime_health),
    now: stringField(input.now) || undefined,
  })

  if (preflightResult.verdict !== "armable") {
    return {
      mode,
      preflight_result: preflightResult,
      execution_gate: { status: "skipped", reason: "preflight_not_armable" },
      recorded: false,
    }
  }

  const triggerGate = evaluateTriggerCondition(input)
  if (triggerGate.status === "skipped") {
    return {
      mode,
      preflight_result: preflightResult,
      execution_gate: triggerGate,
      recorded: false,
    }
  }

  const contract = compileExecutionContract(asRecord(input.execution_contract_input) as unknown as ExecutionContractInput)
  const idempotencyGate = evaluateIdempotency(db, contract)
  if (idempotencyGate.status === "skipped") {
    return {
      mode,
      preflight_result: preflightResult,
      execution_gate: idempotencyGate,
      execution_contract: contract,
      latest_order_fill: readLatestOrderFill(db, contract.chain_id),
      recorded: false,
    }
  }

  const executionResult = buildMockExecutionResult(contract, mode)
  const event = buildRecordedExecutionEvent({
    event_key: stringField(input.event_key),
    created_at: stringField(input.created_at),
    preflight_result: preflightResult,
    execution_contract_input: input.execution_contract_input,
    execution_result: executionResult,
  })
  appendPlanEvent(db, event)

  return {
    mode,
    preflight_result: preflightResult,
    execution_gate: { status: "ready" },
    execution_contract: contract,
    execution_result: executionResult,
    order_fill_event: event,
    latest_order_fill: readLatestOrderFill(db, contract.chain_id),
    recorded: true,
  }
}

export function evaluateTriggerCondition(input: JSONRecord): ExecutionGateResult {
  const trigger = readTriggerCondition(input)
  if (Object.keys(trigger).length === 0) {
    return { status: "ready" }
  }

  const parsedNow = parseTimeMillis(stringField(input.now) || new Date().toISOString())
  const now = parsedNow == null ? Date.now() : parsedNow
  const validUntil = parseTimeMillis(stringField(trigger.valid_until_at))
  if (validUntil != null && now > validUntil) {
    return {
      status: "skipped",
      reason: "trigger_condition_expired",
      evidence: {
        now: new Date(now).toISOString(),
        valid_until_at: stringField(trigger.valid_until_at),
      },
    }
  }

  const range = readPriceRange(trigger.price_in_range)
  if (range) {
    const mark = readCurrentMark(input)
    if (mark == null) {
      return {
        status: "skipped",
        reason: "current_mark_missing_for_trigger",
        evidence: {
          price_in_range: range,
        },
      }
    }
    if (mark < range[0] || mark > range[1]) {
      return {
        status: "skipped",
        reason: "current_mark_outside_trigger_range",
        evidence: {
          current_mark: mark,
          price_in_range: range,
        },
      }
    }
  }

  return { status: "ready" }
}

export function evaluateIdempotency(db: Database, contract: ExecutionContract): ExecutionGateResult {
  const events = readFlowEvents(db, contract.chain_id)
  const matchingEvent = events.find((event) => (
    event.kind === "order_fill"
    && stringField(event.body_json.source_observe_event_key) === contract.source_observe_event_key
  ))
  if (matchingEvent) {
    return {
      status: "skipped",
      reason: "source_observe_already_recorded",
      evidence: {
        event_key: matchingEvent.event_key,
        source_observe_event_key: contract.source_observe_event_key,
      },
    }
  }

  const state = reduceFlowState(db, contract.chain_id)
  const currentOrders = Array.isArray(state.current_orders) ? state.current_orders.map(asRecord) : []
  const entryIds = new Set(contract.entries.map((entry) => entry.client_order_id))
  const matchingOrder = currentOrders.find((order) => entryIds.has(stringField(order.client_order_id)))
  if (matchingOrder) {
    return {
      status: "skipped",
      reason: "client_order_already_open",
      evidence: {
        client_order_id: stringField(matchingOrder.client_order_id),
      },
    }
  }

  return { status: "ready" }
}

export function buildMockExecutionResult(contract: ExecutionContract, mode: RunMode = "dry-run"): JSONRecord {
  const entry = contract.entries[0]
  return {
    mode,
    method: ["STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"].includes(entry.type)
      ? `${mode}FuturesCreateAlgoOrder`
      : `${mode}FuturesOrder`,
    request: entry,
    result: {
      orderId: `mock-${entry.client_order_id}`,
      clientOrderId: entry.client_order_id,
      status: "NEW",
      symbol: contract.symbol,
      type: entry.type,
    },
    confirmedResult: {
      orderId: `mock-${entry.client_order_id}`,
      clientOrderId: entry.client_order_id,
      status: "NEW",
    },
  }
}

export function readTargetAction(value: unknown): TargetAction {
  const candidate = stringField(value)
  if (["no_action", "place_entry", "cancel_order", "sync_protection", "adjust_position"].includes(candidate)) {
    return candidate as TargetAction
  }
  return "place_entry"
}

function readTriggerCondition(input: JSONRecord): JSONRecord {
  const direct = asRecord(input.trigger_condition)
  if (Object.keys(direct).length > 0) {
    return direct
  }
  const planIntent = asRecord(asRecord(input.plan).action_intent)
  const planTrigger = asRecord(planIntent.trigger_condition)
  if (Object.keys(planTrigger).length > 0) {
    return planTrigger
  }
  const observeIntent = asRecord(asRecord(input.observe).action_intent)
  return asRecord(observeIntent.trigger_condition)
}

function readCurrentMark(input: JSONRecord): number | null {
  const candidates = [
    input.current_mark,
    input.current_mark_price,
    input.mark_price,
    asRecord(input.market).mark_price,
    asRecord(input.market).markPrice,
    asRecord(input.market_snapshot).mark_price,
    asRecord(input.market_snapshot).markPrice,
    asRecord(input.observe).current_mark,
    asRecord(input.observe).mark_price,
    asRecord(input.observe).markPrice,
  ]
  for (const candidate of candidates) {
    const parsed = Number(candidate)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

function readPriceRange(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return null
  }
  const low = Number(value[0])
  const high = Number(value[1])
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return null
  }
  return low <= high ? [low, high] : [high, low]
}

function parseTimeMillis(value: string): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildOrderPlaceCommand(contract: ExecutionContract): string[] {
  const entry = contract.entries[0]
  const command = [
    "bun",
    "scripts/main.ts",
    "--symbol",
    contract.symbol,
    "--side",
    contract.side === "long" ? "BUY" : "SELL",
    "--type",
    entry.type,
    "--quantity",
    String(entry.quantity),
    "--position-side",
    contract.position_side,
    "--leverage",
    String(contract.target_leverage),
    "--new-client-order-id",
    entry.client_order_id,
    "--yes",
  ]
  if (entry.price != null) {
    command.push("--price", String(entry.price))
  }
  if (entry.stop_price != null) {
    command.push("--stop-price", String(entry.stop_price))
  }
  return command
}

export function unwrapSkillResponse(value: unknown): JSONRecord {
  const response = asRecord(value)
  if (response.ok === false) {
    throw new Error(stringField(response.error) || "skill returned ok=false")
  }
  return asRecord(response.data ?? response)
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
