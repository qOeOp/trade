import { Database } from "bun:sqlite"
import { compileExecutionContract, type ExecutionContractInput } from "../../../../contracts/execution-contract/src/execution-contract"
import { evaluatePreflight } from "../../../../contracts/preflight-contract/src/preflight"
import {
  appendExecutionObserve,
  evaluateIdempotency,
  readTargetAction,
} from "../../../execution-flow-runner/src/lib/execution-flow-runner"
import { evaluateTriggerCondition } from "../../../execution-gate/src/lib/execution-gate"
import { buildExecutionCommandSpec } from "../../../execution-router/src/lib/execution-router"
import { buildRecordedExecutionEvent, unwrapToolResponse } from "../../../execution-recorder/src/lib/execution-recorder"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { appendPlanEvent, readLatestOrderFill } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { runJsonCommand, type Runner } from "../../../../live-decision-planning/observe-runner/src/lib/observe-runner"

export async function runLiveSmall(
  db: Database,
  input: JSONRecord,
  yes: boolean,
  runner: Runner = runJsonCommand,
): Promise<JSONRecord> {
  if (!yes) {
    throw new Error("--run-live-small requires --yes")
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
    const executionGate = { status: "skipped" as const, reason: "preflight_not_armable" }
    const observeEvent = appendExecutionObserve(db, input, preflightResult, executionGate)
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
    const observeEvent = appendExecutionObserve(db, input, preflightResult, executionGate)
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
    const observeEvent = appendExecutionObserve(db, input, preflightResult, triggerGate)
    return {
      mode: "live-small",
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
      mode: "live-small",
      preflight_result: preflightResult,
      execution_gate: idempotencyGate,
      execution_contract: contract,
      observe_event: observeEvent,
      latest_order_fill: readLatestOrderFill(db, contract.chain_id),
      recorded: false,
    }
  }

  const repoRoot = stringField(input.repoRoot) || process.cwd()
  const commandSpec = buildExecutionCommandSpec({ ...input, repoRoot }, contract)
  const execution = await runner(commandSpec.command, { cwd: commandSpec.cwd })
  if (!execution.ok) {
    throw new Error(`live-small execution failed: ${execution.error}`)
  }

  const executionResult = unwrapToolResponse(execution.data)
  const event = buildRecordedExecutionEvent({
    event_key: stringField(input.event_key),
    created_at: stringField(input.created_at),
    preflight_result: preflightResult,
    execution_contract_input: input.execution_contract_input,
    execution_result: executionResult,
  })
  appendPlanEvent(db, event)
  return {
    mode: "live-small",
    preflight_result: preflightResult,
    execution_gate: { status: "ready" },
    execution_contract: contract,
    execution_result: executionResult,
    order_fill_event: event,
    latest_order_fill: readLatestOrderFill(db, contract.chain_id),
    recorded: true,
  }
}
