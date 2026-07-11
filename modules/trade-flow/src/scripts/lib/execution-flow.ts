import { Database } from "bun:sqlite"
import {
  compileExecutionContract,
  type ExecutionContract,
  type ExecutionContractInput,
} from "../../../../contracts/execution-contract/src/execution-contract"
import { evaluatePreflight } from "../../../../contracts/preflight-contract/src/preflight"
import { readTargetAction } from "../../../../contracts/preflight-contract/src/target-action"
import {
  buildRecordedExecutionEvent,
} from "../../../../flow/execution-recorder/src/lib/execution-recorder"
import { asRecord, removeUndefined, stringField, type JSONRecord } from "./json"
import { latestSlowObserve, reduceFlowState } from "./flow-state"
import { appendPlanEvent, readFlowEvents, readLatestOrderFill, type PlanEvent } from "./plan-events"
import type { RunMode } from "./run-mode"

export type { TargetAction } from "../../../../contracts/preflight-contract/src/target-action"
export { readTargetAction } from "../../../../contracts/preflight-contract/src/target-action"
export type ExecutionGateResult =
  | { status: "ready" }
  | { status: "skipped"; reason: string; evidence?: JSONRecord }
type SkippedExecutionGateResult = Extract<ExecutionGateResult, { status: "skipped" }>

export function runOneFlowStep(db: Database, input: JSONRecord, mode: RunMode): JSONRecord {
  if (mode !== "dry-run" && mode !== "shadow") {
    throw new Error(`unsupported run mode: ${mode}`)
  }

  const preflightResult = evaluatePreflight({
    plan: asRecord(input.plan),
    observe: asRecord(input.observe),
    strategy: asRecord(input.strategy),
    account_config: asRecord(input.account_config),
    runtime_policy: asRecord(input.runtime_policy),
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
