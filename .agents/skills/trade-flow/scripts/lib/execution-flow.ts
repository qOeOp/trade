import { Database } from "bun:sqlite"
import {
  compileExecutionContract,
  type ExecutionContract,
  type ExecutionContractInput,
} from "../../../_shared/execution-contract"
import { evaluatePreflight } from "../../../_shared/preflight"
import { readTargetAction, TARGET_ACTIONS, type ExecutableTargetAction } from "../../../_shared/target-action"
import { asRecord, compactRecord, numberOrUndefined, removeUndefined, stringField, type JSONRecord } from "./json"
import { latestSlowObserve, reduceFlowState } from "./flow-state"
import { appendPlanEvent, readFlowEvents, readLatestOrderFill, type PlanEvent } from "./plan-events"
import type { RunMode } from "./run-mode"

export type { TargetAction } from "../../../_shared/target-action"
export { readTargetAction } from "../../../_shared/target-action"
export const EXECUTABLE_TARGET_ACTIONS = TARGET_ACTIONS.filter((action): action is ExecutableTargetAction => action !== "no_action")
export interface ExecutionCommandSpec {
  target_action: ExecutableTargetAction
  skill: string
  cwd: string
  command: string[]
}
export type ExecutionGateResult =
  | { status: "ready" }
  | { status: "skipped"; reason: string; evidence?: JSONRecord }
type SkippedExecutionGateResult = Extract<ExecutionGateResult, { status: "skipped" }>

export function buildRecordedExecutionEvent(input: JSONRecord): PlanEvent {
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

export function buildRecordedActionEvents(input: JSONRecord): PlanEvent[] {
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
    const executionGate: ExecutionGateResult = { status: "skipped", reason: "preflight_not_armable" }
    const observeEvent = appendExecutionObserve(db, input, preflightResult, executionGate)
    return {
      mode,
      preflight_result: preflightResult,
      execution_gate: executionGate,
      observe_event: observeEvent,
      recorded: false,
    }
  }

  const triggerGate = evaluateTriggerCondition(input)
  if (triggerGate.status === "skipped") {
    const observeEvent = appendExecutionObserve(db, input, preflightResult, triggerGate)
    return {
      mode,
      preflight_result: preflightResult,
      execution_gate: triggerGate,
      observe_event: observeEvent,
      recorded: false,
    }
  }

  const contract = compileExecutionContract(asRecord(input.execution_contract_input) as unknown as ExecutionContractInput)
  const idempotencyGate = evaluateIdempotency(db, contract)
  if (idempotencyGate.status === "skipped") {
    const observeEvent = appendExecutionObserve(db, input, preflightResult, idempotencyGate)
    return {
      mode,
      preflight_result: preflightResult,
      execution_gate: idempotencyGate,
      execution_contract: contract,
      observe_event: observeEvent,
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

export function buildExecutionObserveEvent(
  input: JSONRecord,
  preflightResult: unknown,
  executionGate: SkippedExecutionGateResult,
): PlanEvent {
  const observe = asRecord(input.observe)
  const plan = asRecord(input.plan)
  const contractInput = asRecord(input.execution_contract_input)
  const created_at = stringField(input.created_at) || new Date().toISOString()
  const body: JSONRecord = {
    ...observe,
    source: readTrackSource(input, observe),
    symbol: firstString(observe.symbol, plan.symbol, contractInput.symbol),
    side: firstString(observe.side, plan.side, contractInput.side),
    strategy_ref: firstString(observe.strategy_ref, plan.strategy_ref),
    setup_id: firstString(observe.setup_id, plan.setup_id, contractInput.setup_id),
    direction_state: firstValue(observe.direction_state, plan.direction_state),
    execution_verdict: firstValue(observe.execution_verdict, plan.execution_verdict),
    thesis: firstValue(observe.thesis, plan.thesis),
    entry_intent: firstValue(observe.entry_intent, plan.entry_intent),
    exit_intent: firstValue(observe.exit_intent, plan.exit_intent),
    invalidation: firstValue(observe.invalidation, plan.invalidation),
    expected_rr_net: firstValue(observe.expected_rr_net, plan.expected_rr_net),
    stop_price: firstValue(observe.stop_price, plan.stop_price),
    risk_budget_usdt: firstValue(observe.risk_budget_usdt, plan.risk_budget_usdt),
    action_intent: buildObserveActionIntent(input, observe, executionGate),
    preflight_result: preflightResult,
    execution_gate: executionGate,
    decision_summary: buildExecutionDecisionSummary(input, preflightResult, executionGate),
    created_at,
  }
  removeUndefined(body)

  return {
    event_key: stringField(input.observe_event_key) || crypto.randomUUID(),
    chain_id: firstString(input.chain_id, observe.chain_id, contractInput.chain_id),
    kind: "observe",
    body_json: body,
    created_at,
  }
}

export function appendExecutionObserve(
  db: Database,
  input: JSONRecord,
  preflightResult: unknown,
  executionGate: SkippedExecutionGateResult,
): PlanEvent {
  const event = buildExecutionObserveEvent(inheritLatestSlowObserveForFastTrack(db, input), preflightResult, executionGate)
  appendPlanEvent(db, event)
  return event
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
  const riskLock = asRecord(state.risk_lock)
  if (riskLock.locked === true) {
    return {
      status: "skipped",
      reason: "flow_risk_locked",
      evidence: riskLock,
    }
  }
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

export function validateExecutionResultForTarget(
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
    filled_qty: numberOrUndefined(reduced.executedQty) ?? numberOrUndefined(asRecord(input.request).reduce_quantity),
    avg_fill_price: readAverageFillPrice(reduced),
    execution_method: stringField(executionResult.method),
    remaining_position: executionResult.remainingPosition ?? null,
  }))
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

function buildObserveActionIntent(
  input: JSONRecord,
  observe: JSONRecord,
  executionGate: SkippedExecutionGateResult,
): JSONRecord {
  if (["source_observe_already_recorded", "client_order_already_open"].includes(executionGate.reason)) {
    return {
      target_action: "no_action",
      previous_target_action: readTargetAction(input.target_action),
      cleared_reason: executionGate.reason,
    }
  }
  const observeIntent = asRecord(observe.action_intent)
  if (Object.keys(observeIntent).length > 0) {
    return observeIntent
  }
  const triggerCondition = readTriggerCondition(input)
  const actionIntent: JSONRecord = {
    target_action: readTargetAction(input.target_action),
    request: asRecord(input.request),
  }
  if (Object.keys(triggerCondition).length > 0) {
    actionIntent.trigger_condition = triggerCondition
  }
  return actionIntent
}

function inheritLatestSlowObserveForFastTrack(db: Database, input: JSONRecord): JSONRecord {
  const observe = asRecord(input.observe)
  if (readTrackSource(input, observe) !== "fast_track") {
    return input
  }

  const chainId = firstString(input.chain_id, observe.chain_id, asRecord(input.execution_contract_input).chain_id)
  if (!chainId) {
    return input
  }
  const slowObserve = latestSlowObserve(readFlowEvents(db, chainId))
  if (!slowObserve) {
    return input
  }

  const slowBody = asRecord(slowObserve.body_json)
  const inheritedObserve: JSONRecord = {
    ...observe,
    source: "fast_track",
    latest_slow_observe_event_key: slowObserve.event_key,
  }
  for (const key of FAST_TRACK_INHERITED_KEYS) {
    if (slowBody[key] !== undefined && slowBody[key] !== "") {
      inheritedObserve[key] = slowBody[key]
    }
  }
  return {
    ...input,
    observe: inheritedObserve,
  }
}

const FAST_TRACK_INHERITED_KEYS = [
  "symbol",
  "side",
  "strategy_ref",
  "setup_id",
  "direction_state",
  "execution_verdict",
  "thesis",
  "entry_intent",
  "exit_intent",
  "invalidation",
  "invalidation_price",
  "setup_valid_until_at",
  "expected_rr_net",
  "stop_price",
  "risk_budget_usdt",
  "stop_ladder",
  "takeprofit_ladder",
  "expected_holding_hours",
  "action_intent",
]

function buildExecutionDecisionSummary(
  input: JSONRecord,
  preflightResult: unknown,
  executionGate: SkippedExecutionGateResult,
): string {
  const prefix = readTrackSource(input, asRecord(input.observe)) === "fast_track" ? "fast" : "slow"
  if (executionGate.reason === "preflight_not_armable") {
    const preflight = asRecord(preflightResult)
    const blocked = Array.isArray(preflight.blocked_by)
      ? preflight.blocked_by.map(asRecord).map((item) => stringField(item.check_id)).filter(Boolean)
      : []
    return `${prefix}_blocked: ${blocked.join(",") || "preflight_not_armable"}`
  }
  return `${prefix}_skipped: ${executionGate.reason}`
}

function readTrackSource(input: JSONRecord, observe: JSONRecord): "slow_track" | "fast_track" {
  const source = firstString(input.source, input.track_source, observe.source)
  if (source === "fast" || source === "fast_track") {
    return "fast_track"
  }
  return "slow_track"
}

function firstValue(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== "") {
      return value
    }
  }
  return undefined
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

export function buildExecutionCommandSpec(input: JSONRecord, contract?: ExecutionContract): ExecutionCommandSpec {
  const targetAction = readTargetAction(input.target_action)
  const repoRoot = stringField(input.repoRoot) || process.cwd()
  if (targetAction === "place_entry") {
    const compiled = contract
      ?? compileExecutionContract(asRecord(input.execution_contract_input) as unknown as ExecutionContractInput)
    return {
      target_action: targetAction,
      skill: "binance-order-place",
      cwd: `${repoRoot}/.agents/skills/binance-order-place`,
      command: buildOrderPlaceCommand(compiled),
    }
  }
  if (targetAction === "cancel_order") {
    return {
      target_action: targetAction,
      skill: "binance-order-cancel",
      cwd: `${repoRoot}/.agents/skills/binance-order-cancel`,
      command: buildOrderCancelCommand(input),
    }
  }
  if (targetAction === "adjust_position") {
    return {
      target_action: targetAction,
      skill: "binance-position-adjust",
      cwd: `${repoRoot}/.agents/skills/binance-position-adjust`,
      command: buildPositionAdjustCommand(input),
    }
  }
  if (targetAction === "sync_protection") {
    return {
      target_action: targetAction,
      skill: "binance-position-protect",
      cwd: `${repoRoot}/.agents/skills/binance-position-protect`,
      command: buildPositionProtectCommand(input),
    }
  }
  throw new Error("no_action has no executable skill command")
}

export function buildOrderCancelCommand(input: JSONRecord): string[] {
  const request = asRecord(input.request)
  const command = ["bun", "scripts/main.ts", "--symbol", readRequiredSymbol(input)]
  const all = readBoolean(firstValue(request.all, request.cancel_all, request.scope === "all"))
  const algo = readBoolean(firstValue(request.algo, request.order_bucket === "algo"))
    || readId(request.algo_id, request.algoId) !== ""
    || readId(request.client_algo_id, request.clientAlgoId) !== ""

  if (algo) {
    command.push("--algo")
  }
  if (all) {
    command.push("--all")
  } else if (algo) {
    pushFlag(command, "--algo-id", readId(request.algo_id, request.algoId))
    pushFlag(command, "--client-algo-id", readId(request.client_algo_id, request.clientAlgoId))
  } else {
    pushFlag(command, "--order-id", readId(request.order_id, request.orderId))
    pushFlag(command, "--orig-client-order-id", readId(
      request.orig_client_order_id,
      request.origClientOrderId,
      request.client_order_id,
      request.clientOrderId,
    ))
  }
  command.push("--yes")
  return command
}

export function buildPositionAdjustCommand(input: JSONRecord): string[] {
  const request = asRecord(input.request)
  const direction = firstString(request.direction, request.adjustment)
  if (direction === "add") {
    throw new Error("adjust_position command only supports reduce or close")
  }

  const command = [
    "bun",
    "scripts/main.ts",
    "--symbol",
    readRequiredSymbol(input),
    "--position-side",
    readPositionSide(input),
  ]
  const closePosition = readBoolean(firstValue(
    request.close_position,
    request.closePosition,
    request.close_all,
    request.closeAll,
    direction === "close",
  ))
  if (closePosition) {
    command.push("--close-position", "true")
  } else {
    command.push("--reduce-quantity", readRequiredQuantity(input, [
      request.reduce_quantity,
      request.reduceQuantity,
      request.quantity,
      request.qty,
    ]))
  }
  command.push("--yes")
  return command
}

export function buildPositionProtectCommand(input: JSONRecord): string[] {
  const request = asRecord(input.request)
  const command = [
    "bun",
    "scripts/main.ts",
    "--symbol",
    readRequiredSymbol(input),
    "--position-side",
    readPositionSide(input),
  ]
  pushFlag(command, "--side", commandScalar(request.side))

  const closePosition = readBoolean(firstValue(request.close_position, request.closePosition, request.close_all, request.closeAll))
  if (closePosition) {
    command.push("--close-position", "true")
  } else {
    command.push("--quantity", readRequiredQuantity(input, [
      request.quantity,
      request.qty,
      request.protection_quantity,
      request.position_quantity,
      asRecord(input.plan).position_quantity,
      asRecord(input.observe).position_quantity,
    ]))
  }

  pushFlag(command, "--stop-loss-trigger", commandScalar(
    request.stop_loss_trigger,
    request.stopLossTrigger,
    request.stop_price,
    asRecord(input.plan).stop_price,
    asRecord(input.observe).stop_price,
  ))
  pushFlag(command, "--stop-loss-limit-price", commandScalar(request.stop_loss_limit_price, request.stopLossLimitPrice))
  pushFlag(command, "--take-profit-trigger", commandScalar(
    request.take_profit_trigger,
    request.takeProfitTrigger,
    request.takeprofit_trigger,
    request.tp_price,
  ))
  pushFlag(command, "--take-profit-limit-price", commandScalar(request.take_profit_limit_price, request.takeProfitLimitPrice))
  pushFlag(command, "--trailing-activation-price", commandScalar(
    request.trailing_activation_price,
    request.trailingActivationPrice,
  ))
  pushFlag(command, "--callback-rate", commandScalar(request.callback_rate, request.callbackRate))
  pushFlag(command, "--working-type", commandScalar(request.working_type, request.workingType))
  if (request.price_protect !== undefined || request.priceProtect !== undefined) {
    command.push("--price-protect", String(readBoolean(firstValue(request.price_protect, request.priceProtect))))
  }
  command.push("--yes")
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

function readRequiredSymbol(input: JSONRecord): string {
  const request = asRecord(input.request)
  const symbol = normalizeSymbol(firstString(
    request.symbol,
    input.symbol,
    asRecord(input.plan).symbol,
    asRecord(input.observe).symbol,
    asRecord(input.execution_contract_input).symbol,
  ))
  if (!symbol) {
    throw new Error("execution command requires symbol")
  }
  return symbol
}

function readPositionSide(input: JSONRecord): string {
  const request = asRecord(input.request)
  const value = firstString(
    request.position_side,
    request.positionSide,
    input.position_side,
    asRecord(input.observe).position_side,
    asRecord(input.execution_contract_input).position_side,
  ).toUpperCase()
  return value || "BOTH"
}

function readRequiredQuantity(input: JSONRecord, candidates: unknown[]): string {
  const quantity = commandScalar(...candidates)
  if (!quantity) {
    throw new Error(`${readTargetAction(input.target_action)} command requires quantity unless close-position is true`)
  }
  return quantity
}

function readBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value
  }
  const normalized = stringField(value).toLowerCase()
  return ["1", "true", "yes", "y", "on"].includes(normalized)
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

function pushFlag(command: string[], flag: string, value: string): void {
  if (value) {
    command.push(flag, value)
  }
}

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[\/:_\-\s]/g, "")
}

function commandScalar(...values: unknown[]): string {
  for (const value of values) {
    if (value == null || value === "") {
      continue
    }
    if (typeof value === "string") {
      return value.trim()
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }
  return ""
}
