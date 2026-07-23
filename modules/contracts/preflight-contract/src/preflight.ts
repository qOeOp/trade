import { readObserveTargetAction, type TargetAction } from "./target-action"

type JSONRecord = Record<string, unknown>
type Verdict = "armable" | "blocked" | "abstain"

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
  runtime_policy?: JSONRecord
  runtime_authorization?: JSONRecord
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

function evaluatePreflight(input: PreflightInput): PreflightOutput {
  const plan = input.plan
  const observe = input.observe
  const targetAction = input.target_action ?? readObserveTargetAction(observe)
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
  checkRuntimeAuthorization(input, targetAction, blockedBy, now)
  checkKillSwitch(input.runtime_health, blockedBy, isNewRiskAction(targetAction, input.request))
  checkLadders(plan, blockedBy)
  checkPortfolioProjection(input, targetAction, blockedBy, now)
  checkRiskLimits(input, targetAction, blockedBy)
  checkChurnGuards(input, targetAction, blockedBy)
  checkRequest(input.request, targetAction, blockedBy)

  const verdict: Verdict = blockedBy.length > 0 ? "blocked" : "armable"
  return {
    verdict,
    blocked_by: blockedBy,
    warnings,
    decision_card: renderDecisionCard(input, verdict, blockedBy, warnings),
  }
}

function checkRuntimeAuthorization(
  input: PreflightInput,
  targetAction: TargetAction,
  blockedBy: CheckResult[],
  now: number,
): void {
  if (!isNewRiskAction(targetAction, input.request)) return
  const authorization = input.runtime_authorization ?? {}
  const runtimePolicy = input.runtime_policy ?? {}
  const account = asRecord(input.observe.account)
  const reasons: string[] = []
  if (authorization.schema_version !== "trade.policy.runtime-authorization.v1") {
    reasons.push("runtime authorization schema is missing")
  }
  if (!firstString(authorization.authorization_ref) || !firstString(authorization.content_hash)) {
    reasons.push("authorization_ref/content_hash is missing")
  }
  const policyHash = firstString(authorization.policy_hash)
  if (!policyHash || policyHash !== firstString(runtimePolicy.source_hash)) {
    reasons.push("authorization policy_hash does not bind the supplied runtime policy")
  }
  const expectedAccountRef = firstString(account.account_ref, runtimePolicy.account_ref)
  const expectedAccountScope = firstString(account.account_scope, runtimePolicy.account_scope)
  if (!expectedAccountRef || firstString(authorization.account_ref) !== expectedAccountRef) {
    reasons.push("authorization account_ref does not match current account facts")
  }
  if (!expectedAccountScope || firstString(authorization.account_scope) !== expectedAccountScope) {
    reasons.push("authorization account_scope does not match current account facts")
  }
  const issuedAt = Date.parse(firstString(authorization.issued_at))
  const expiresAt = Date.parse(firstString(authorization.expires_at))
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now || expiresAt <= now) {
    reasons.push("runtime authorization is missing, not yet valid, or expired")
  }
  if (reasons.length > 0) {
    blockedBy.push({ check_id: "G-RUNTIME-POLICY-AUTHORIZATION", reason: reasons.join("; ") })
  }
}

function checkPortfolioProjection(
  input: PreflightInput,
  targetAction: TargetAction,
  blockedBy: CheckResult[],
  now: number,
): void {
  if (!isNewRiskAction(targetAction, input.request)) return
  const projection = input.aggregate_view ?? {}
  const account = asRecord(input.observe.account)
  const expectedAccountRef = firstString(account.account_ref, input.runtime_policy?.account_ref)
  const expectedAccountScope = firstString(account.account_scope, input.runtime_policy?.account_scope)
  const reasons: string[] = []
  if (projection.schema_version !== "trade.state.portfolio-account-projection.v1") {
    reasons.push("owner projection schema is missing")
  }
  if (!firstString(projection.projection_ref) || !firstString(projection.content_hash)) {
    reasons.push("projection_ref/content_hash is missing")
  }
  if (!expectedAccountRef || !expectedAccountScope) {
    reasons.push("observe/policy account_ref and account_scope are required")
  }
  if (expectedAccountRef && firstString(projection.account_ref) !== expectedAccountRef) {
    reasons.push("projection account_ref does not match current account facts")
  }
  if (expectedAccountScope && firstString(projection.account_scope) !== expectedAccountScope) {
    reasons.push("projection account_scope does not match current account facts")
  }
  if (projection.completeness !== "complete") {
    reasons.push("portfolio projection is incomplete")
  }
  if (asRecord(projection.risk_lock).locked === true || projection.reconcile_status === "blocked") {
    reasons.push("portfolio projection is risk locked or unreconciled")
  }
  const computedAt = Date.parse(firstString(projection.computed_at))
  if (!Number.isFinite(computedAt) || Math.max(0, now - computedAt) > 30_000) {
    reasons.push("portfolio projection is missing or older than 30s")
  }
  if (reasons.length > 0) {
    blockedBy.push({
      check_id: "G-PORTFOLIO-PROJECTION-AUTHORITY",
      reason: reasons.join("; "),
    })
  }
}

function checkFreshness(observe: JSONRecord, now: number, blockedBy: CheckResult[]): void {
  const raw = firstString(observe.created_at, observe.captured_at, observe.snapshot_at, observe.generated_at)
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

function checkKillSwitch(runtimeHealth: JSONRecord | undefined, blockedBy: CheckResult[], blocksNewRisk: boolean): void {
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
  if (!blocksNewRisk) {
    return
  }
  const safeModeReason = firstString(runtimeHealth.safe_mode_reason, runtimeHealth.reason)
  if (runtimeHealth.safe_mode_active === true) {
    blockedBy.push({ check_id: "G-KILL-SWITCH", reason: `safe mode active${safeModeReason ? `: ${safeModeReason}` : ""}` })
  }
  const streakReasons = [
    ["ai_failures_streak", "AI failure streak reached safe-mode threshold"],
    ["binance_api_failures_streak", "Binance API failure streak reached safe-mode threshold"],
    ["reconcile_mismatch_streak", "reconciliation mismatch streak reached safe-mode threshold"],
  ] as const
  for (const [key, reason] of streakReasons) {
    if (numeric(runtimeHealth[key]) >= 3) {
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
  const effectiveLimits = asRecord(input.runtime_policy?.effective_limits)
  const aggregate = input.aggregate_view ?? {}
  const account = asRecord(input.observe.account)
  const equity = numeric(account.equity_usdt)
  const riskBudget = numeric(input.plan.risk_budget_usdt)

  if (equity <= 0 || riskBudget <= 0) {
    blockedBy.push({ check_id: "G-RISK-OPEN-CAP", reason: "equity_usdt and risk_budget_usdt are required" })
    return
  }

  const maxSingleTradeRisk = firstPositive(effectiveLimits.max_single_trade_risk_usdt, accountConfig.max_single_trade_risk_usdt)
  if (maxSingleTradeRisk > 0 && riskBudget > maxSingleTradeRisk) {
    blockedBy.push({ check_id: "G-MAX-SINGLE-TRADE-RISK", reason: `risk_budget_usdt ${riskBudget} exceeds cap ${maxSingleTradeRisk}` })
  }

  const maxOpenRiskPct = firstPositive(effectiveLimits.max_open_risk_pct, accountConfig.max_open_risk_pct)
  if (maxOpenRiskPct > 0) {
    const totalRisk = numeric(aggregate.active_plans_risk_sum)
      + numeric(aggregate.current_account_open_risk_usdt)
      + riskBudget
    if (totalRisk > equity * maxOpenRiskPct) {
      blockedBy.push({ check_id: "G-RISK-OPEN-CAP", reason: `open risk ${totalRisk} exceeds cap ${equity * maxOpenRiskPct}` })
    }
  }

  const maxOpenRiskUsdt = firstPositive(effectiveLimits.max_open_risk_usdt, accountConfig.max_open_risk_usdt)
  if (maxOpenRiskUsdt > 0) {
    const totalRisk = numeric(aggregate.active_plans_risk_sum)
      + numeric(aggregate.current_account_open_risk_usdt)
      + riskBudget
    if (totalRisk > maxOpenRiskUsdt) {
      blockedBy.push({ check_id: "G-RISK-OPEN-CAP", reason: `open risk ${totalRisk} exceeds fixed cap ${maxOpenRiskUsdt}` })
    }
  }

  const maxDayLossPct = firstPositive(effectiveLimits.max_day_loss_pct, accountConfig.max_day_loss_pct)
  if (maxDayLossPct > 0) {
    const floor = -(equity * maxDayLossPct)
    const worst = numeric(aggregate.realized_pnl_today_usdt)
      + numeric(aggregate.active_plans_worst_loss_at_stop)
      - riskBudget
    if (worst < floor) {
      blockedBy.push({ check_id: "G-RISK-DAY-FLOOR", reason: `worst day pnl ${worst} is below floor ${floor}` })
    }
  }
  const maxDayLossUsdt = firstPositive(effectiveLimits.max_day_loss_usdt, accountConfig.max_day_loss_usdt)
  if (maxDayLossUsdt > 0) {
    const worst = numeric(aggregate.realized_pnl_today_usdt)
      + numeric(aggregate.active_plans_worst_loss_at_stop)
      - riskBudget
    if (worst < -maxDayLossUsdt) {
      blockedBy.push({ check_id: "G-RISK-DAY-FLOOR", reason: `worst day pnl ${worst} is below fixed floor ${-maxDayLossUsdt}` })
    }
  }

  const request = input.request ?? asRecord(asRecord(input.observe.action_intent).request)
  const estimatedNewNotional = estimateNewNotional(input.plan, input.observe, request)
  if (estimatedNewNotional > 0) {
    checkNotionalCaps(effectiveLimits, accountConfig, aggregate, equity, estimatedNewNotional, blockedBy)
  }
  const maxConcurrentFlows = firstPositive(effectiveLimits.max_concurrent_risk_flows, accountConfig.max_concurrent_risk_flows)
  const activeFlows = numeric(aggregate.active_risk_flow_count)
  if (maxConcurrentFlows > 0 && activeFlows >= maxConcurrentFlows) {
    blockedBy.push({ check_id: "G-MAX-CONCURRENT-RISK-FLOWS", reason: `active risk flows ${activeFlows} meets cap ${maxConcurrentFlows}` })
  }
}

function checkChurnGuards(input: PreflightInput, targetAction: TargetAction, blockedBy: CheckResult[]): void {
  const request = input.request ?? asRecord(asRecord(input.observe.action_intent).request)
  const accountConfig = input.account_config ?? {}
  const effectiveLimits = asRecord(input.runtime_policy?.effective_limits)
  const aggregate = input.aggregate_view ?? {}

  if (isNewRiskAction(targetAction, request)) {
    const cycleCap = firstPositive(effectiveLimits.max_open_actions_per_cycle, accountConfig.max_open_actions_per_cycle)
    const cycleCount = firstNumber(aggregate.open_actions_this_cycle, aggregate.new_risk_actions_this_cycle)
    if (cycleCap > 0 && cycleCount != null && cycleCount >= cycleCap) {
      blockedBy.push({ check_id: "G-OPEN-RATE-CAP", reason: `open actions this cycle ${cycleCount} meets cap ${cycleCap}` })
    }

    const hourlyCap = firstPositive(effectiveLimits.max_open_actions_per_hour, accountConfig.max_open_actions_per_hour)
    const hourlyCount = firstNumber(aggregate.recent_open_actions_1h, aggregate.open_actions_last_hour, aggregate.new_risk_actions_last_hour)
    if (hourlyCap > 0 && hourlyCount != null && hourlyCount >= hourlyCap) {
      blockedBy.push({ check_id: "G-OPEN-RATE-CAP", reason: `open actions in 1h ${hourlyCount} meets cap ${hourlyCap}` })
    }

    const cooldown = firstPositive(effectiveLimits.reentry_cooldown_minutes, accountConfig.reentry_cooldown_minutes)
    const lastCloseAge = firstNumber(aggregate.minutes_since_last_close, aggregate.last_close_age_minutes, request.minutes_since_last_close)
    if (cooldown > 0 && lastCloseAge != null && lastCloseAge < cooldown) {
      blockedBy.push({ check_id: "G-REENTRY-COOLDOWN", reason: `last close age ${lastCloseAge}m is below cooldown ${cooldown}m` })
    }

    const currentSide = normalizeSide(firstString(
      aggregate.current_lane_position_state,
      aggregate.current_lane_side,
      aggregate.current_position_side,
    ))
    const actionSide = normalizeSide(firstString(request.side, input.plan.side, input.observe.side, request.direction))
    if (currentSide && actionSide && currentSide !== actionSide) {
      blockedBy.push({ check_id: "G-SAME-LANE-OPPOSITE-OPEN-CAP", reason: `current lane is ${currentSide}; new risk side is ${actionSide}` })
    }
    return
  }

  if (!isReduceOrExitAction(targetAction, request)) {
    return
  }
  const minHold = firstPositive(effectiveLimits.min_hold_minutes_before_noise_close, accountConfig.min_hold_minutes_before_noise_close)
  const positionAge = firstNumber(aggregate.position_age_minutes, aggregate.current_position_age_minutes, request.position_age_minutes)
  const reason = firstString(request.exit_reason, request.reduce_reason, aggregate.exit_reason)
  if (minHold > 0 && positionAge != null && positionAge < minHold && !isHardExitReason(reason)) {
    blockedBy.push({ check_id: "G-MIN-HOLD-BEFORE-NOISE-CLOSE", reason: `position age ${positionAge}m is below minimum hold ${minHold}m` })
  }
}

function checkNotionalCaps(
  effectiveLimits: JSONRecord,
  accountConfig: JSONRecord,
  aggregate: JSONRecord,
  equity: number,
  estimatedNewNotional: number,
  blockedBy: CheckResult[],
): void {
  const maxEntryNotional = firstPositive(effectiveLimits.max_entry_notional_usdt, accountConfig.max_entry_notional_usdt)
  if (maxEntryNotional > 0 && estimatedNewNotional > maxEntryNotional) {
    blockedBy.push({ check_id: "G-MAX-ENTRY-NOTIONAL", reason: `entry notional ${round(estimatedNewNotional)} exceeds cap ${maxEntryNotional}` })
  }
  const maxSymbolNotional = firstPositive(effectiveLimits.max_symbol_notional_usdt, accountConfig.max_symbol_notional_usdt)
  const symbolNotional = numeric(aggregate.current_symbol_notional_usdt) + estimatedNewNotional
  if (maxSymbolNotional > 0 && symbolNotional > maxSymbolNotional) {
    blockedBy.push({ check_id: "G-MAX-SYMBOL-NOTIONAL", reason: `symbol notional ${round(symbolNotional)} exceeds cap ${maxSymbolNotional}` })
  }
  const maxGrossNotional = firstPositive(effectiveLimits.max_gross_notional_usdt, accountConfig.max_gross_notional_usdt)
  const grossNotional = numeric(aggregate.current_gross_notional_usdt) + estimatedNewNotional
  if (maxGrossNotional > 0 && grossNotional > maxGrossNotional) {
    blockedBy.push({ check_id: "G-GROSS-NOTIONAL-CAP", reason: `gross notional ${round(grossNotional)} exceeds cap ${maxGrossNotional}` })
  }
  const maxSingleLeverage = firstPositive(effectiveLimits.max_single_position_leverage, accountConfig.max_single_position_leverage)
  const laneNotional = numeric(aggregate.current_lane_notional_usdt) + estimatedNewNotional
  if (equity > 0 && maxSingleLeverage > 0 && laneNotional > equity * maxSingleLeverage) {
    blockedBy.push({ check_id: "G-SINGLE-POSITION-LEVERAGE-CAP", reason: `lane notional ${round(laneNotional)} exceeds cap ${round(equity * maxSingleLeverage)}` })
  }
  const maxGrossExposure = firstPositive(effectiveLimits.max_gross_exposure, accountConfig.max_gross_exposure)
  if (equity > 0 && maxGrossExposure > 0 && grossNotional > equity * maxGrossExposure) {
    blockedBy.push({ check_id: "G-GROSS-EXPOSURE-CAP", reason: `gross notional ${round(grossNotional)} exceeds exposure cap ${round(equity * maxGrossExposure)}` })
  }
}

function estimateNewNotional(plan: JSONRecord, observe: JSONRecord, request: JSONRecord): number {
  const stop = numeric(plan.stop_price) || numeric(observe.stop_price)
  const riskBudget = numeric(plan.risk_budget_usdt)
  if (stop <= 0 || riskBudget <= 0) return 0
  const entries = Array.isArray(request.entries) ? request.entries.map(asRecord) : []
  if (entries.length === 0) return numeric(request.notional_usdt)
  return entries.reduce((sum, entry) => {
    const riskRatio = numeric(entry.risk_ratio) || 1
    const entryRef = numeric(entry.price)
      || numeric(entry.reference_price)
      || numeric(observe.current_mark)
      || numeric(asRecord(observe.market_state).mark_price)
      || numeric(asRecord(observe.microstructure).mark_price)
    const riskPerUnit = Math.abs(entryRef - stop)
    if (entryRef <= 0 || riskPerUnit <= 0) return sum
    return sum + (riskBudget * riskRatio / riskPerUnit) * entryRef
  }, 0)
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

function isNewRiskAction(targetAction: TargetAction, request: JSONRecord | undefined): boolean {
  if (request?.increases_risk === false) {
    return false
  }
  if (targetAction === "adjust_position") {
    return String(request?.direction ?? "") === "add"
  }
  return NEW_RISK_ACTIONS.has(targetAction)
}

function isReduceOrExitAction(targetAction: TargetAction, request: JSONRecord | undefined): boolean {
  if (targetAction !== "adjust_position") {
    return false
  }
  const direction = String(request?.direction ?? "").toLowerCase()
  return direction === "reduce" || direction === "close" || request?.close_all === true
}

function normalizeSide(value: string): "long" | "short" | "" {
  const normalized = value.trim().toLowerCase()
  if (normalized === "buy" || normalized === "long" || normalized === "多") return "long"
  if (normalized === "sell" || normalized === "short" || normalized === "空") return "short"
  return ""
}

function isHardExitReason(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return [
    "hard_stop",
    "invalidation",
    "protection",
    "risk_reduction",
    "stop",
    "stop_loss",
    "take_profit",
    "tp",
  ].includes(normalized)
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (isNonEmptyString(value)) {
      return value.trim()
    }
  }
  return ""
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

function firstPositive(...values: unknown[]): number {
  for (const value of values) {
    const number = numeric(value)
    if (number > 0) return number
  }
  return 0
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue
    const number = numeric(value)
    if (Number.isFinite(number)) return number
  }
  return undefined
}

function round(value: number): number {
  return Number(value.toFixed(6))
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

export {
  evaluatePreflight,
  type PreflightInput,
  type PreflightOutput,
}
