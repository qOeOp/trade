import {
  compileExecutionContract,
  type ExecutionContract,
  type ExecutionContractInput,
} from "../../../../contracts/execution-contract/src/execution-contract"
import { evaluatePreflight } from "../../../../contracts/preflight-contract/src/preflight"
import { readTargetAction } from "../../../../contracts/preflight-contract/src/target-action"
import {
  buildRecordedExecutionEvent,
} from "../../../execution-recorder/src/lib/execution-recorder"
import {
  evaluateTriggerCondition,
  type ExecutionGateResult,
  type SkippedExecutionGateResult,
} from "../../../execution-gate/src/lib/execution-gate"
import { asRecord, removeUndefined, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { appendEvent, readFlowEvents, readLatestOrderFill } from "./event-store-client"
import { readLatestSlowObserve, reduceFlow } from "./flow-projector-client"
import type { RunMode } from "./run-mode"

export type { TargetAction } from "../../../../contracts/preflight-contract/src/target-action"
export { readTargetAction } from "../../../../contracts/preflight-contract/src/target-action"

export type PlanEvent = JSONRecord & {
  event_key: string
  chain_id: string
  kind: "observe" | "order_fill" | "review"
  body_json: JSONRecord
  created_at: string
}

export interface ExecutionStateRuntime {
  eventReader?: (dbPath: string, chainId: string) => JSONRecord[]
  eventAppender?: (dbPath: string, event: JSONRecord) => JSONRecord
  latestOrderFillReader?: (dbPath: string, chainId: string) => JSONRecord | null
  flowStateReader?: (dbPath: string, chainId: string) => JSONRecord
  latestSlowObserveReader?: (dbPath: string, chainId: string) => JSONRecord | null
}

export function runOneFlowStep(
  dbPath: string,
  input: JSONRecord,
  mode: RunMode,
  runtime: ExecutionStateRuntime = {},
): JSONRecord {
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
    const observeEvent = appendExecutionObserve(dbPath, input, preflightResult, executionGate, runtime)
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
    const observeEvent = appendExecutionObserve(dbPath, input, preflightResult, triggerGate, runtime)
    return {
      mode,
      preflight_result: preflightResult,
      execution_gate: triggerGate,
      observe_event: observeEvent,
      recorded: false,
    }
  }

  const contract = compileExecutionContract(asRecord(input.execution_contract_input) as unknown as ExecutionContractInput)
  const idempotencyGate = evaluateIdempotency(dbPath, contract, runtime)
  if (idempotencyGate.status === "skipped") {
    const observeEvent = appendExecutionObserve(dbPath, input, preflightResult, idempotencyGate, runtime)
    return {
      mode,
      preflight_result: preflightResult,
      execution_gate: idempotencyGate,
      execution_contract: contract,
      observe_event: observeEvent,
      latest_order_fill: latestOrderFill(dbPath, contract.chain_id, runtime),
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
  appendStateEvent(dbPath, event, runtime)

  return {
    mode,
    preflight_result: preflightResult,
    execution_gate: { status: "ready" },
    execution_contract: contract,
    execution_result: executionResult,
    order_fill_event: event,
    latest_order_fill: latestOrderFill(dbPath, contract.chain_id, runtime),
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
  dbPath: string,
  input: JSONRecord,
  preflightResult: unknown,
  executionGate: SkippedExecutionGateResult,
  runtime: ExecutionStateRuntime = {},
): PlanEvent {
  const event = buildExecutionObserveEvent(inheritLatestSlowObserveForFastTrack(dbPath, input, runtime), preflightResult, executionGate)
  appendStateEvent(dbPath, event, runtime)
  return event
}

export function evaluateIdempotency(
  dbPath: string,
  contract: ExecutionContract,
  runtime: ExecutionStateRuntime = {},
): ExecutionGateResult {
  const events = readStateEvents(dbPath, contract.chain_id, runtime)
  const matchingEvent = events.find((event) => (
    stringField(event.kind) === "order_fill"
    && stringField(asRecord(event.body_json).source_observe_event_key) === contract.source_observe_event_key
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

  const state = readFlowState(dbPath, contract.chain_id, runtime)
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

function inheritLatestSlowObserveForFastTrack(
  dbPath: string,
  input: JSONRecord,
  runtime: ExecutionStateRuntime,
): JSONRecord {
  const observe = asRecord(input.observe)
  if (readTrackSource(input, observe) !== "fast_track") {
    return input
  }

  const chainId = firstString(input.chain_id, observe.chain_id, asRecord(input.execution_contract_input).chain_id)
  if (!chainId) {
    return input
  }
  const slowObserve = latestSlowObserve(dbPath, chainId, runtime)
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

function readStateEvents(dbPath: string, chainId: string, runtime: ExecutionStateRuntime): JSONRecord[] {
  return (runtime.eventReader ?? readFlowEvents)(dbPath, chainId)
}

function readFlowState(dbPath: string, chainId: string, runtime: ExecutionStateRuntime): JSONRecord {
  return (runtime.flowStateReader ?? reduceFlow)(dbPath, chainId)
}

function appendStateEvent(dbPath: string, event: unknown, runtime: ExecutionStateRuntime): JSONRecord {
  return (runtime.eventAppender ?? appendEvent)(dbPath, asRecord(event))
}

function latestOrderFill(dbPath: string, chainId: string, runtime: ExecutionStateRuntime): JSONRecord | null {
  return (runtime.latestOrderFillReader ?? readLatestOrderFill)(dbPath, chainId)
}

function latestSlowObserve(dbPath: string, chainId: string, runtime: ExecutionStateRuntime): JSONRecord | null {
  return (runtime.latestSlowObserveReader ?? readLatestSlowObserve)(dbPath, chainId)
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
