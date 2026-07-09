import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { latestSlowObserve, listActiveFlows, reduceFlowState } from "./flow-state"
import { evaluateTriggerCondition } from "./execution-flow"
import { asRecord, numberField, removeUndefined, stringField, type JSONRecord } from "./json"
import { type Runner } from "./observe-adapter"
import { appendPlanEvent, readFlowEvents, type PlanEvent } from "./plan-events"
import { runJsonCommand } from "./skill-runner"
import { displayPath } from "./paths"

interface FastTrackWorkflowInput {
  repoRoot: string
  dataDir: string
  runId: string
  db: Database
  runner?: Runner
}

interface SkillCallResult {
  ok: boolean
  data?: JSONRecord
  error?: string
}

export async function runFastTrackWorkflowDryRun(input: FastTrackWorkflowInput): Promise<JSONRecord> {
  const runner = input.runner ?? runJsonCommand
  const activeFlows = listActiveFlows(input.db)
  if (activeFlows.length === 0) {
    return writeFastArtifact(input, {
      track: "fast",
      mode: "workflow-dry-run",
      executable: false,
      live_execution_allowed: false,
      run_id: input.runId,
      generated_at: new Date().toISOString(),
      active_flow_count: 0,
      flow_checks: [],
      trade_decision: {
        target_action: "no_action",
        reason: "no_active_flows",
      },
      workflow_steps: fastWorkflowSteps(),
    })
  }

  const accountSnapshot = await callSkill(
    runner,
    ["bun", "scripts/main.ts", "--timeout", "10"],
    join(input.repoRoot, ".agents/skills/binance-account-snapshot"),
  )
  const symbolSnapshots = await fetchSymbolSnapshots(input.repoRoot, runner, uniqueSymbols(activeFlows.map((flow) => flow.lane_key)))
  const flowChecks = activeFlows.map((flow) => buildFlowCheck(input.db, flow.chain_id, accountSnapshot, symbolSnapshots))
  for (const check of flowChecks) {
    appendPlanEvent(input.db, check.event)
  }

  return writeFastArtifact(input, {
    track: "fast",
    mode: "workflow-dry-run",
    executable: false,
    live_execution_allowed: false,
    run_id: input.runId,
    generated_at: new Date().toISOString(),
    active_flow_count: activeFlows.length,
    account_state: summarizeAccountState(accountSnapshot),
    flow_checks: flowChecks.map((check) => check.report),
    trade_decision: {
      target_action: "no_action",
      reason: "fast_track_dry_run_never_executes",
    },
    workflow_steps: fastWorkflowSteps(),
  })
}

function buildFlowCheck(
  db: Database,
  chainId: string,
  accountSnapshot: SkillCallResult,
  symbolSnapshots: Record<string, SkillCallResult>,
): { event: PlanEvent; report: JSONRecord } {
  const state = reduceFlowState(db, chainId)
  const latestObserve = asRecord(state.latest_observe) as unknown as PlanEvent | null
  const observeBody = asRecord(latestObserve?.body_json)
  const events = readFlowEvents(db, chainId)
  const slowObserve = latestSlowObserve(events)
  const symbol = stringField(observeBody.symbol)
  const actionIntent = asRecord(observeBody.action_intent)
  const targetAction = stringField(actionIntent.target_action) || "no_action"
  const symbolSnapshot = symbolSnapshots[symbol]
  const currentMark = readMarkPrice(symbolSnapshot)
  const riskLock = asRecord(state.risk_lock)
  const triggerGate = targetAction === "no_action"
    ? { status: "skipped" as const, reason: "no_pending_action" }
    : evaluateTriggerCondition({
      observe: observeBody,
      target_action: targetAction,
      current_mark: currentMark,
      now: new Date().toISOString(),
    })
  const executionGate = riskLock.locked === true
    ? { status: "skipped", reason: "flow_risk_locked", evidence: riskLock }
    : triggerGate
  const fastBody: JSONRecord = {
    ...inheritObserveFields(observeBody),
    source: "fast_track",
    latest_slow_observe_event_key: stringField(slowObserve?.event_key),
    latest_observe_event_key: stringField(latestObserve?.event_key),
    action_intent: Object.keys(actionIntent).length > 0 ? actionIntent : { target_action: "no_action" },
    account_state: summarizeAccountState(accountSnapshot),
    market_state: summarizeMarketState(symbolSnapshot),
    execution_gate: executionGate,
    decision_summary: `fast_${executionGate.status === "ready" ? "ready" : "skipped"}: ${
      executionGate.status === "ready" ? targetAction : stringField(asRecord(executionGate).reason)
    }`,
    created_at: new Date().toISOString(),
  }
  removeUndefined(fastBody)
  const event: PlanEvent = {
    event_key: crypto.randomUUID(),
    chain_id: chainId,
    kind: "observe",
    body_json: fastBody,
    created_at: stringField(fastBody.created_at),
  }
  return {
    event,
    report: {
      chain_id: chainId,
      symbol,
      side: stringField(observeBody.side),
      latest_observe_event_key: stringField(latestObserve?.event_key),
      latest_slow_observe_event_key: stringField(slowObserve?.event_key),
      target_action: targetAction,
      current_mark: currentMark,
      account_ok: accountSnapshot.ok,
      symbol_snapshot_ok: symbolSnapshot?.ok === true,
      risk_lock: riskLock,
      execution_gate: executionGate,
      fast_observe_event_key: event.event_key,
    },
  }
}

async function fetchSymbolSnapshots(
  repoRoot: string,
  runner: Runner,
  symbols: string[],
): Promise<Record<string, SkillCallResult>> {
  const entries = await Promise.all(symbols.map(async (symbol) => {
    const result = await callSkill(
      runner,
      ["bun", "scripts/main.ts", "--symbol", symbol, "--pulse"],
      join(repoRoot, ".agents/skills/binance-symbol-snapshot"),
    )
    return [symbol, result] as const
  }))
  return Object.fromEntries(entries)
}

async function callSkill(runner: Runner, command: string[], cwd: string): Promise<SkillCallResult> {
  const result = await runner(command, { cwd })
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
    }
  }
  const response = asRecord(result.data)
  if (response.ok === false) {
    return {
      ok: false,
      error: stringField(response.error) || "skill returned ok=false",
      data: asRecord(response.data),
    }
  }
  return {
    ok: true,
    data: asRecord(response.data ?? response),
  }
}

function writeFastArtifact(input: FastTrackWorkflowInput, report: JSONRecord): JSONRecord {
  const artifactPath = join(input.dataDir, `fast-track-${input.runId}.json`)
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`)
  return {
    ...report,
    artifact_path: displayPath(artifactPath, input.repoRoot),
  }
}

function uniqueSymbols(laneKeys: string[]): string[] {
  const symbols = laneKeys
    .map((key) => key.split("|")[1] || "")
    .filter(Boolean)
  return [...new Set(symbols)]
}

function readMarkPrice(snapshot: SkillCallResult | undefined): number | undefined {
  if (snapshot?.ok !== true) {
    return undefined
  }
  const data = asRecord(snapshot.data)
  const price = numberField(asRecord(data.priceSnapshot).markPrice)
    || numberField(asRecord(data.premiumIndex).markPrice)
    || numberField(asRecord(data.ticker24h).lastPrice)
  return price > 0 ? price : undefined
}

function summarizeAccountState(snapshot: SkillCallResult): JSONRecord {
  if (!snapshot.ok) {
    return {
      ok: false,
      error: snapshot.error,
    }
  }
  const data = asRecord(snapshot.data)
  const regularOrders = readArray(asRecord(data.openOrders).regular)
  const protectiveOrders = readArray(asRecord(data.openOrders).protective)
  return {
    ok: true,
    generated_at: stringField(data.generatedAt),
    positions_count: readArray(data.positions).length,
    open_orders_count: regularOrders.length + protectiveOrders.length,
    regular_orders_count: regularOrders.length,
    protective_orders_count: protectiveOrders.length,
    errors: asRecord(data.errors),
  }
}

function summarizeMarketState(snapshot: SkillCallResult | undefined): JSONRecord {
  if (snapshot?.ok !== true) {
    return {
      ok: false,
      error: snapshot?.error || "symbol_snapshot_missing",
    }
  }
  const data = asRecord(snapshot.data)
  return {
    ok: true,
    generated_at: stringField(data.generatedAt),
    mark_price: readMarkPrice(snapshot),
    funding_rate: stringField(asRecord(data.premiumIndex).lastFundingRate),
    open_interest: stringField(asRecord(data.openInterest).openInterest),
  }
}

function inheritObserveFields(observe: JSONRecord): JSONRecord {
  const inherited: JSONRecord = {}
  for (const key of [
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
  ]) {
    if (observe[key] !== undefined && observe[key] !== "") {
      inherited[key] = observe[key]
    }
  }
  return inherited
}

function fastWorkflowSteps(): string[] {
  return [
    "reduce_active_flows",
    "account_snapshot_read_only",
    "symbol_pulse_for_active_flows",
    "trigger_condition_check",
    "risk_lock_check",
    "append_fast_observe",
    "cron_log",
  ]
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
