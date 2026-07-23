import { compileExecutionContract, type ExecutionContractInput } from "../../../../contracts/execution-contract/src/execution-contract"
import { evaluatePreflight } from "../../../../contracts/preflight-contract/src/preflight"
import {
  appendExecutionObserve,
  evaluateIdempotency,
  resolvePortfolioProjection,
  type ExecutionStateRuntime,
} from "../../../execution-flow-runner/src/lib/execution-flow-runner"
import { readTargetAction } from "../../../../contracts/preflight-contract/src/target-action"
import { evaluateTriggerCondition } from "../../../execution-gate/src/lib/execution-gate"
import { buildExecutionCommandSpec } from "../../../execution-router/src/lib/execution-router"
import { buildExecutionCapability } from "../../../execution-capability/src/lib/execution-capability"
import { buildRecordedExecutionEvent, unwrapToolResponse } from "../../../execution-recorder/src/lib/execution-recorder"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { appendEvent, readLatestOrderFill } from "../../../execution-flow-runner/src/lib/event-store-client"
import { runJsonCommand, runToolCommand, type Runner } from "../../../../contracts/runtime-core/src/tool-runner"
import { resolveRegisteredOwnerTool } from "../../../../contracts/runtime-core/src/owner-tool-registry"

export async function runLiveSmall(
  dbPath: string,
  input: JSONRecord,
  yes: boolean,
  runner: Runner = runJsonCommand,
  runtime: ExecutionStateRuntime = {},
): Promise<JSONRecord> {
  if (!yes) {
    throw new Error("--run-live-small requires --yes")
  }

  const aggregateView = resolvePortfolioProjection(dbPath, input, runtime)
  const preflightResult = evaluatePreflight({
    plan: asRecord(input.plan),
    observe: asRecord(input.observe),
    strategy: asRecord(input.strategy),
    account_config: asRecord(input.account_config),
    runtime_policy: asRecord(input.runtime_policy),
    runtime_authorization: asRecord(input.runtime_authorization),
    target_action: readTargetAction(input.target_action),
    request: asRecord(input.request),
    aggregate_view: aggregateView,
    runtime_health: asRecord(input.runtime_health),
    now: stringField(input.now) || undefined,
  })
  if (preflightResult.verdict !== "armable") {
    const executionGate = { status: "skipped" as const, reason: "preflight_not_armable" }
    const observeEvent = appendExecutionObserve(dbPath, input, preflightResult, executionGate, runtime)
    return {
      mode: "live-small",
      preflight_result: preflightResult,
      execution_gate: executionGate,
      observe_event: observeEvent,
      recorded: false,
    }
  }

  const targetAction = readTargetAction(input.target_action)
  if (targetAction !== "place_entry") {
    const executionGate = {
      status: "skipped" as const,
      reason: "unsupported_live_small_target_action",
      evidence: { target_action: targetAction },
    }
    const observeEvent = appendExecutionObserve(dbPath, input, preflightResult, executionGate, runtime)
    return {
      mode: "live-small",
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
      mode: "live-small",
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
      mode: "live-small",
      preflight_result: preflightResult,
      execution_gate: idempotencyGate,
      execution_contract: contract,
      observe_event: observeEvent,
      latest_order_fill: latestOrderFill(dbPath, contract.chain_id, runtime),
      recorded: false,
    }
  }

  const repoRoot = stringField(input.repoRoot) || process.cwd()
  const sourceIntentRef = resolveSourceIntentRef(input, contract)
  const idempotencyKey = `${contract.chain_id}:${contract.source_observe_event_key}:${contract.entries[0].client_order_id}`
  const capability = buildExecutionCapability({
    target_action: targetAction,
    preflight_result: preflightResult as unknown as JSONRecord,
    runtime_authorization: asRecord(input.runtime_authorization),
    account_fact: asRecord(asRecord(input.observe).account),
    portfolio_projection: aggregateView,
    source_intent_ref: sourceIntentRef,
    idempotency_key: idempotencyKey,
    risk_budget_usdt: Number(contract.risk.risk_budget_usdt),
    max_notional_usdt: estimateContractNotional(contract as unknown as JSONRecord),
    now: stringField(input.now) || undefined,
  })
  const route = await runGatewayStage(runner, repoRoot, "exchange.request-router", {
    request_kind: "write",
    action: targetAction,
    symbol: contract.symbol,
    mode: "live_small",
    idempotency_key: idempotencyKey,
    source_intent_ref: sourceIntentRef,
    capability_ref: capability.capability_ref,
  })
  if (stringField(route.route) !== "exchange-write-pre-adapter-gate") {
    throw new Error("exchange request router did not select the write pre-adapter gate")
  }
  const writeGate = await runGatewayStage(runner, repoRoot, "exchange.write-pre-adapter-gate", {
    action: targetAction,
    symbol: contract.symbol,
    mode: "live_small",
    idempotency_key: idempotencyKey,
    source_intent_ref: sourceIntentRef,
    client_order_id: contract.entries[0].client_order_id,
    authorized: true,
    now: stringField(input.now) || undefined,
    capability,
  })
  if (stringField(writeGate.status) !== "passed") {
    throw new Error("exchange write pre-adapter gate did not pass")
  }
  const commandSpec = buildExecutionCommandSpec({ ...input, repoRoot }, contract)
  const execution = await runner(commandSpec.command, { cwd: commandSpec.cwd })
  if (!execution.ok) {
    throw new Error(`live-small execution failed: ${execution.error}`)
  }

  const executionResult = unwrapToolResponse(execution.data)
  const confirmation = await runGatewayStage(runner, repoRoot, "exchange.post-write-confirmation", {
    command_ref: stringField(asRecord(executionResult.exchange_command_ref).command_ref) || `exchange-command://${encodeURIComponent(idempotencyKey)}`,
    client_order_id: contract.entries[0].client_order_id,
    action: targetAction,
    status: Object.keys(asRecord(executionResult.confirmedResult)).length > 0 ? "confirmed" : "unknown",
    idempotency_key: idempotencyKey,
    source_intent_ref: sourceIntentRef,
    capability_ref: stringField(capability.capability_ref),
    exchange_order_ids: exchangeOrderIds(executionResult),
  })
  const event = buildRecordedExecutionEvent({
    event_key: stringField(input.event_key),
    created_at: stringField(input.created_at),
    preflight_result: preflightResult,
    execution_contract_input: input.execution_contract_input,
    execution_result: executionResult,
    execution_capability: capability,
    exchange_confirmation_ref: confirmation,
  })
  appendStateEvent(dbPath, event, runtime)
  return {
    mode: "live-small",
    preflight_result: preflightResult,
    execution_gate: { status: "ready" },
    execution_contract: contract,
    execution_capability: capability,
    exchange_route: route,
    exchange_write_gate: writeGate,
    exchange_confirmation_ref: confirmation,
    execution_result: executionResult,
    order_fill_event: event,
    latest_order_fill: latestOrderFill(dbPath, contract.chain_id, runtime),
    recorded: true,
  }
}

async function runGatewayStage(
  runner: Runner,
  repoRoot: string,
  toolId: string,
  payload: JSONRecord,
): Promise<JSONRecord> {
  const owner = resolveRegisteredOwnerTool(toolId, ["--json", JSON.stringify(payload)], repoRoot)
  const result = await runToolCommand(
    runner,
    owner.argv,
    owner.cwd,
  )
  if (!result.ok) throw new Error(`${toolId} failed: ${result.error}`)
  return asRecord(result.data)
}

function resolveSourceIntentRef(input: JSONRecord, contract: { source_observe_event_key: string }): string {
  const observe = asRecord(input.observe)
  const intent = asRecord(observe.action_intent)
  return stringField(input.source_intent_ref)
    || stringField(intent.intent_ref)
    || `action-intent://observe/${encodeURIComponent(contract.source_observe_event_key)}`
}

function estimateContractNotional(contract: JSONRecord): number {
  const entries = Array.isArray(contract.entries) ? contract.entries.map(asRecord) : []
  return entries.reduce((sum, entry) => {
    const quantity = Number(entry.quantity) || 0
    const reference = Number(entry.price) || Number(entry.stop_price) || Number(entry.reference_price) || 0
    return sum + Math.abs(quantity * reference)
  }, 0)
}

function exchangeOrderIds(result: JSONRecord): string[] {
  const ids = [
    asRecord(result.result).orderId,
    asRecord(result.result).algoId,
    asRecord(result.confirmedResult).orderId,
    asRecord(result.confirmedResult).algoId,
  ].map(String).filter((value) => value && value !== "undefined")
  return [...new Set(ids)]
}

function appendStateEvent(dbPath: string, event: unknown, runtime: ExecutionStateRuntime): JSONRecord {
  return (runtime.eventAppender ?? appendEvent)(dbPath, asRecord(event))
}

function latestOrderFill(dbPath: string, chainId: string, runtime: ExecutionStateRuntime): JSONRecord | null {
  return (runtime.latestOrderFillReader ?? readLatestOrderFill)(dbPath, chainId)
}
