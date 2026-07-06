#!/usr/bin/env bun

import { readFileSync } from "node:fs"

type JSONRecord = Record<string, unknown>
type Verdict = "armable" | "blocked" | "abstain"
type TargetAction = "no_action" | "place_entry" | "cancel_order" | "sync_protection" | "adjust_position"

interface CheckResult {
  check_id: string
  reason: string
}

interface WarningResult {
  source: string
  reason: string
}

interface PreflightInput {
  plan: JSONRecord
  observe: JSONRecord
  strategy?: JSONRecord
  account_config?: JSONRecord
  target_action?: TargetAction
  request?: JSONRecord
  aggregate_view?: JSONRecord
  runtime_health?: JSONRecord
  now?: string
}

interface PreflightOutput {
  verdict: Verdict
  blocked_by: CheckResult[]
  warnings: WarningResult[]
  decision_card: string
}

const DIRECTIONS = new Set(["偏多已确认", "偏空已确认", "中性", "冲突"])
const EXECUTION_VERDICTS = new Set(["追", "不追", "等条件", "等回踩", "放弃", "持有不动", "减仓", "退出"])
const NEW_RISK_ACTIONS = new Set<TargetAction>(["place_entry"])

const HELP_TEXT = `Usage:
  ./scripts/main.ts --input preflight-input.json

Key flags:
  --input <path>     JSON containing plan / observe / strategy / account_config
  --json <json>      Inline JSON input
  --help             Show this help
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT)
    return
  }

  const response = run(argv)
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`)
  if (response.verdict === "blocked") {
    process.exitCode = 2
  }
}

function run(argv: string[]): PreflightOutput {
  const input = parseInput(argv)
  return evaluatePreflight(input)
}

function evaluatePreflight(input: PreflightInput): PreflightOutput {
  const plan = input.plan
  const observe = input.observe
  const targetAction = input.target_action ?? readTargetAction(observe)
  const blockedBy: CheckResult[] = []
  const warnings: WarningResult[] = []
  const now = input.now ? Date.parse(input.now) : Date.now()

  if (targetAction === "no_action") {
    return {
      verdict: "abstain",
      blocked_by: [],
      warnings,
      decision_card: renderDecisionCard(input, "abstain", [], warnings),
    }
  }

  checkFreshness(observe, now, blockedBy)
  checkPlanIntent(plan, blockedBy)
  checkPlanVerdict(plan, blockedBy)
  checkSetupLivePermission(input, targetAction, blockedBy)
  checkKillSwitch(input.runtime_health, blockedBy)
  checkLadders(plan, blockedBy)
  checkRiskLimits(input, targetAction, blockedBy)
  checkRequest(input.request, targetAction, blockedBy)

  const verdict: Verdict = blockedBy.length > 0 ? "blocked" : "armable"
  return {
    verdict,
    blocked_by: blockedBy,
    warnings,
    decision_card: renderDecisionCard(input, verdict, blockedBy, warnings),
  }
}

function checkFreshness(observe: JSONRecord, now: number, blockedBy: CheckResult[]): void {
  const raw = firstString(observe.created_at, observe.captured_at, observe.snapshot_at, observe.generatedAt)
  if (!raw) {
    blockedBy.push({ check_id: "G-OBS-FRESH", reason: "observe timestamp is missing" })
    return
  }
  const capturedAt = Date.parse(raw)
  if (!Number.isFinite(capturedAt)) {
    blockedBy.push({ check_id: "G-OBS-FRESH", reason: `observe timestamp is invalid: ${raw}` })
    return
  }
  const ageSeconds = Math.max(0, (now - capturedAt) / 1000)
  if (ageSeconds > 30) {
    blockedBy.push({ check_id: "G-OBS-FRESH", reason: `observe age ${Math.round(ageSeconds)}s exceeds 30s` })
  }
}

function checkPlanIntent(plan: JSONRecord, blockedBy: CheckResult[]): void {
  for (const key of ["thesis", "entry_intent", "exit_intent", "invalidation"]) {
    if (!isNonEmptyString(plan[key])) {
      blockedBy.push({ check_id: "G-PLAN-INTENT-COMPLETE", reason: `${key} is required` })
    }
  }
}

function checkPlanVerdict(plan: JSONRecord, blockedBy: CheckResult[]): void {
  if (!DIRECTIONS.has(String(plan.direction_state))) {
    blockedBy.push({ check_id: "G-PLAN-VERDICT-COMPLETE", reason: "direction_state is missing or invalid" })
  }
  if (!EXECUTION_VERDICTS.has(String(plan.execution_verdict))) {
    blockedBy.push({ check_id: "G-PLAN-VERDICT-COMPLETE", reason: "execution_verdict is missing or invalid" })
  }
}

function checkSetupLivePermission(input: PreflightInput, targetAction: TargetAction, blockedBy: CheckResult[]): void {
  if (!isNewRiskAction(targetAction, input.request)) {
    return
  }
  const setupId = firstString(input.plan.setup_id, input.observe.setup_id)
  if (!setupId) {
    blockedBy.push({ check_id: "G-SETUP-LIVE-PERMISSION", reason: "setup_id is required for new risk" })
  }
  const strategyStatus = String(input.strategy?.status ?? "")
  const livePermission = firstString(input.strategy?.live_permission, input.plan.live_permission, input.observe.live_permission)
  if (strategyStatus && strategyStatus !== "live-small") {
    blockedBy.push({ check_id: "G-SETUP-LIVE-PERMISSION", reason: `strategy.status is ${strategyStatus}` })
  }
  if (livePermission && livePermission !== "live-small") {
    blockedBy.push({ check_id: "G-SETUP-LIVE-PERMISSION", reason: `setup live_permission is ${livePermission}` })
  }
  if (!strategyStatus && !livePermission) {
    blockedBy.push({ check_id: "G-SETUP-LIVE-PERMISSION", reason: "live-small permission is missing" })
  }
}

function checkKillSwitch(runtimeHealth: JSONRecord | undefined, blockedBy: CheckResult[]): void {
  if (!runtimeHealth) {
    return
  }
  const reasons = [
    ["reconciliation_failed", "reconciliation failed"],
    ["api_failures", "Binance API failures reached threshold"],
    ["cron_failures", "cron failures reached threshold"],
    ["day_loss_near_floor", "day loss is near floor"],
    ["lane_paused", "lane is paused"],
    ["event_window_blocked", "event window blocks new risk"],
  ] as const
  for (const [key, reason] of reasons) {
    const value = runtimeHealth[key]
    if (value === true || (typeof value === "number" && value >= 3)) {
      blockedBy.push({ check_id: "G-KILL-SWITCH", reason })
    }
  }
}

function checkLadders(plan: JSONRecord, blockedBy: CheckResult[]): void {
  const stopLadder = Array.isArray(plan.stop_ladder) ? plan.stop_ladder.map(asRecord) : []
  for (let index = 1; index < stopLadder.length; index += 1) {
    const prev = Number(stopLadder[index - 1].new_stop)
    const next = Number(stopLadder[index].new_stop)
    if (Number.isFinite(prev) && Number.isFinite(next) && next < prev) {
      blockedBy.push({ check_id: "G-STOP-LADDER-MONOTONIC", reason: "stop_ladder new_stop must be monotonic" })
      break
    }
  }

  const takeProfitLadder = Array.isArray(plan.takeprofit_ladder) ? plan.takeprofit_ladder.map(asRecord) : []
  const ratioSum = takeProfitLadder.reduce((sum, item) => sum + numeric(item.qty_ratio), 0)
  if (ratioSum > 1) {
    blockedBy.push({ check_id: "G-TP-LADDER-RATIO-CAP", reason: `takeprofit_ladder qty_ratio sum ${ratioSum} exceeds 1` })
  }
}

function checkRiskLimits(input: PreflightInput, targetAction: TargetAction, blockedBy: CheckResult[]): void {
  if (!isNewRiskAction(targetAction, input.request)) {
    return
  }
  const accountConfig = input.account_config ?? {}
  const aggregate = input.aggregate_view ?? {}
  const account = asRecord(input.observe.account)
  const equity = numeric(account.equity_usdt)
  const riskBudget = numeric(input.plan.risk_budget_usdt)

  if (equity <= 0 || riskBudget <= 0) {
    blockedBy.push({ check_id: "G-RISK-OPEN-CAP", reason: "equity_usdt and risk_budget_usdt are required" })
    return
  }

  const maxOpenRiskPct = numeric(accountConfig.max_open_risk_pct)
  if (maxOpenRiskPct > 0) {
    const totalRisk = numeric(aggregate.active_plans_risk_sum)
      + numeric(aggregate.current_account_open_risk_usdt)
      + riskBudget
    if (totalRisk > equity * maxOpenRiskPct) {
      blockedBy.push({ check_id: "G-RISK-OPEN-CAP", reason: `open risk ${totalRisk} exceeds cap ${equity * maxOpenRiskPct}` })
    }
  }

  const maxDayLossPct = numeric(accountConfig.max_day_loss_pct)
  if (maxDayLossPct > 0) {
    const floor = -(equity * maxDayLossPct)
    const worst = numeric(aggregate.realized_pnl_today_usdt)
      + numeric(aggregate.active_plans_worst_loss_at_stop)
      - riskBudget
    if (worst < floor) {
      blockedBy.push({ check_id: "G-RISK-DAY-FLOOR", reason: `worst day pnl ${worst} is below floor ${floor}` })
    }
  }
}

function checkRequest(request: JSONRecord | undefined, targetAction: TargetAction, blockedBy: CheckResult[]): void {
  if (targetAction !== "no_action" && (!request || Object.keys(request).length === 0)) {
    blockedBy.push({ check_id: "G-PLAN-INTENT-COMPLETE", reason: "action_intent.request is required" })
  }
}

function renderDecisionCard(
  input: PreflightInput,
  verdict: Verdict,
  blockedBy: CheckResult[],
  warnings: WarningResult[],
): string {
  const plan = input.plan
  const observe = input.observe
  const blocked = blockedBy.map((item) => item.check_id).join(",") || "none"
  const warn = warnings.map((item) => item.source).join(",") || "none"
  return [
    `Verdict: ${plan.direction_state ?? "?"} / ${plan.execution_verdict ?? "?"} / ${verdict}`,
    `Plan: ${plan.symbol ?? observe.symbol ?? "?"} ${plan.side ?? observe.side ?? "?"} stop=${plan.stop_price ?? observe.stop_price ?? "?"} risk=${plan.risk_budget_usdt ?? observe.risk_budget_usdt ?? "?"}`,
    `Entry: ${stringOrQuestion(plan.entry_intent)}`,
    `Exit: ${stringOrQuestion(plan.exit_intent)} invalidation=${stringOrQuestion(plan.invalidation)}`,
    `Risk: equity=${asRecord(observe.account).equity_usdt ?? "?"} rr=${plan.expected_rr_net ?? "?"}`,
    `Checks: blocked=${blocked} warnings=${warn}`,
  ].join("\n")
}

function parseInput(argv: string[]): PreflightInput {
  let raw = ""
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--input":
        raw = readFileSync(readFlagValue(argv, ++index, arg), "utf8")
        break
      case "--json":
        raw = readFlagValue(argv, ++index, arg)
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }
  if (!raw) {
    throw new Error("--input or --json is required")
  }
  return JSON.parse(raw) as PreflightInput
}

function readTargetAction(observe: JSONRecord): TargetAction {
  const actionIntent = asRecord(observe.action_intent)
  const value = String(actionIntent.target_action || "no_action")
  if (["place_entry", "cancel_order", "sync_protection", "adjust_position", "no_action"].includes(value)) {
    return value as TargetAction
  }
  return "no_action"
}

function isNewRiskAction(targetAction: TargetAction, request: JSONRecord | undefined): boolean {
  if (request?.increases_risk === false) {
    return false
  }
  return NEW_RISK_ACTIONS.has(targetAction)
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (isNonEmptyString(value)) {
      return value.trim()
    }
  }
  return ""
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

function stringOrQuestion(value: unknown): string {
  return isNonEmptyString(value) ? value.trim() : "?"
}

function numeric(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

export {
  evaluatePreflight,
  parseInput,
  run,
  type PreflightInput,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
