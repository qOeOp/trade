import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { listActiveFlows } from "./flow-state"
import { asRecord, numberField, stringField, type JSONRecord } from "./json"
import { loadRuntime } from "./observe-flow"
import { type Runner } from "./observe-adapter"
import { runJsonCommand } from "./skill-runner"
import { displayPath, displayPathFrom, resolvePathFrom } from "./paths"

interface SlowTrackWorkflowInput {
  repoRoot: string
  dataDir: string
  runId: string
  db: Database
  candidateLimitPerSide?: number
  symbolSnapshotLimitPerSide?: number
  technicalAnalysisLimitPerSide?: number
  runner?: Runner
}

interface SkillCallResult {
  ok: boolean
  data?: JSONRecord
  error?: string
}

export async function runSlowTrackWorkflowDryRun(input: SlowTrackWorkflowInput): Promise<JSONRecord> {
  const runner = input.runner ?? runJsonCommand
  const candidateLimit = input.candidateLimitPerSide ?? 5
  const snapshotLimit = input.symbolSnapshotLimitPerSide ?? 3
  const technicalLimit = input.technicalAnalysisLimitPerSide ?? snapshotLimit
  const accountConfigPath = join(input.repoRoot, "profile/account_config.json")
  const strategiesDir = join(input.repoRoot, ".agents/skills/trade-flow/strategies")
  const runtime = loadRuntime(accountConfigPath, strategiesDir)

  const [accountSnapshot, marketScan] = await Promise.all([
    callSkill(runner, ["bun", "scripts/main.ts", "--timeout", "10"], join(input.repoRoot, ".agents/skills/binance-account-snapshot")),
    callSkill(
      runner,
      ["bun", "scripts/main.ts", "--direction", "both", "--limit-per-side", String(candidateLimit)],
      join(input.repoRoot, ".agents/skills/binance-market-scan"),
    ),
  ])

  const candidates = extractCandidates(marketScan.data, snapshotLimit)
  const symbolSnapshots = await fetchSymbolSnapshots(input.repoRoot, runner, candidates)
  const technicalAnalyses = await fetchTechnicalAnalyses(input, runner, extractCandidates(marketScan.data, technicalLimit))
  const strategyPool = summarizeStrategyPool(runtime)
  const accountState = summarizeAccountState(accountSnapshot)
  const watchlist = buildWatchlist(candidates, symbolSnapshots, technicalAnalyses, strategyPool, accountState)
  const report = {
    track: "slow",
    mode: "analysis-only",
    executable: false,
    live_execution_allowed: false,
    run_id: input.runId,
    generated_at: new Date().toISOString(),
    active_flow_count: listActiveFlows(input.db).length,
    strategy_pool: strategyPool,
    account_state: accountState,
    market_scan: {
      ok: marketScan.ok,
      error: marketScan.error,
      summary: asRecord(asRecord(marketScan.data).summary),
      filters: asRecord(asRecord(marketScan.data).filters),
    },
    watchlist,
    trade_decision: {
      target_action: "no_action",
      reason: buildNoActionReason(accountState, strategyPool, watchlist),
    },
    workflow_steps: [
      "load_runtime_policy",
      "account_snapshot_read_only",
      "market_scan_read_only",
      "symbol_pulse_for_candidates",
      "ohlcv_fetch_for_top_candidates",
      "tech_indicators_for_top_candidates",
      "operator_suggestion_without_exchange_write",
      "strategy_pool_gate",
      "watchlist_and_no_action_decision",
      "cron_log",
    ],
  }
  const artifactPath = join(input.dataDir, `slow-track-${input.runId}.json`)
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`)
  return {
    ...report,
    artifact_path: displayPath(artifactPath, input.repoRoot),
  }
}

async function fetchTechnicalAnalyses(
  input: SlowTrackWorkflowInput,
  runner: Runner,
  candidates: Array<{ symbol: string; side: "long" | "short"; scan: JSONRecord }>,
): Promise<Record<string, SkillCallResult>> {
  const results: Record<string, SkillCallResult> = {}
  const unique = uniqueSymbols(candidates)
  for (const symbol of unique) {
    results[symbol] = await runTechnicalAnalysis(input, runner, symbol)
  }
  return results
}

async function runTechnicalAnalysis(
  input: SlowTrackWorkflowInput,
  runner: Runner,
  symbol: string,
): Promise<SkillCallResult> {
  const ohlcvSkillDir = join(input.repoRoot, ".agents/skills/ohlcv-fetch")
  const ohlcvOutputDir = join("..", "trade-flow", "data", "market", input.runId, symbol)
  const ohlcv = await callSkill(
    runner,
    ["bun", "scripts/main.ts", "--symbol", symbol, "--timeframes", "1d,4h,1h", "--output-dir", ohlcvOutputDir],
    ohlcvSkillDir,
  )
  if (!ohlcv.ok) {
    return ohlcv
  }
  const manifestPath = stringField(asRecord(ohlcv.data).manifest_path)
  if (!manifestPath) {
    return {
      ok: false,
      error: "ohlcv manifest_path missing",
      data: ohlcv.data,
    }
  }
  const manifestFsPath = resolvePathFrom(manifestPath, ohlcvSkillDir)
  const indicators = await callSkill(
    runner,
    ["go", "run", "./scripts", "--manifest", manifestFsPath],
    join(input.repoRoot, ".agents/skills/tech-indicators"),
  )
  if (!indicators.ok) {
    return {
      ...indicators,
      data: {
        ohlcv: ohlcv.data,
        indicator_error: indicators.error,
      },
    }
  }
  return {
    ok: true,
    data: {
      ohlcv: summarizeOhlcv(input.repoRoot, ohlcvSkillDir, asRecord(ohlcv.data)),
      indicators: summarizeIndicators(asRecord(indicators.data)),
    },
  }
}

async function fetchSymbolSnapshots(
  repoRoot: string,
  runner: Runner,
  candidates: Array<{ symbol: string; side: "long" | "short"; scan: JSONRecord }>,
): Promise<Record<string, SkillCallResult>> {
  const unique = uniqueSymbols(candidates)
  const entries = await Promise.all(unique.map(async (symbol) => {
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

function summarizeStrategyPool(runtime: JSONRecord): JSONRecord {
  const strategies = Array.isArray(runtime.strategies) ? runtime.strategies.map(asRecord) : []
  const byStatus: Record<string, number> = {}
  for (const strategy of strategies) {
    const status = stringField(strategy.status) || "draft"
    byStatus[status] = (byStatus[status] ?? 0) + 1
  }
  return {
    total: strategies.length,
    by_status: byStatus,
    live_small_ready: strategies.filter((strategy) => stringField(strategy.status) === "live-small").map(strategySummary),
    shadow_ready: strategies.filter((strategy) => stringField(strategy.status) === "shadow").map(strategySummary),
    draft_only: strategies.filter((strategy) => stringField(strategy.status) === "draft").map(strategySummary),
  }
}

function strategySummary(strategy: JSONRecord): JSONRecord {
  return {
    strategy_id: stringField(strategy.strategy_id),
    name: stringField(strategy.name),
    status: stringField(strategy.status),
    tags: Array.isArray(strategy.tags) ? strategy.tags.map(String) : [],
  }
}

function summarizeAccountState(snapshot: SkillCallResult): JSONRecord {
  if (!snapshot.ok) {
    return {
      ok: false,
      error: snapshot.error,
      balances_count: 0,
      positions_count: 0,
      open_orders_count: 0,
    }
  }
  const data = asRecord(snapshot.data)
  const regularOrders = readArray(asRecord(data.openOrders).regular)
  const protectiveOrders = readArray(asRecord(data.openOrders).protective)
  return {
    ok: true,
    generated_at: stringField(data.generatedAt),
    balances_count: readArray(data.balances).length,
    positions_count: readArray(data.positions).length,
    open_orders_count: regularOrders.length + protectiveOrders.length,
    regular_orders_count: regularOrders.length,
    protective_orders_count: protectiveOrders.length,
    errors: asRecord(data.errors),
  }
}

function extractCandidates(scan: JSONRecord | undefined, limitPerSide: number): Array<{ symbol: string; side: "long" | "short"; scan: JSONRecord }> {
  const buckets = asRecord(asRecord(scan).candidates)
  const result: Array<{ symbol: string; side: "long" | "short"; scan: JSONRecord }> = []
  for (const side of ["long", "short"] as const) {
    for (const item of readArray(buckets[side]).slice(0, limitPerSide)) {
      const scanItem = asRecord(item)
      const symbol = stringField(scanItem.symbol)
      if (symbol) {
        result.push({ symbol, side, scan: scanItem })
      }
    }
  }
  return result
}

function buildWatchlist(
  candidates: Array<{ symbol: string; side: "long" | "short"; scan: JSONRecord }>,
  snapshots: Record<string, SkillCallResult>,
  technicalAnalyses: Record<string, SkillCallResult>,
  strategyPool: JSONRecord,
  accountState: JSONRecord,
): JSONRecord[] {
  return candidates.map((candidate) => {
    const snapshot = snapshots[candidate.symbol]
    const market = asRecord(snapshot?.data)
    const ticker = asRecord(market.ticker24h)
    const premium = asRecord(market.premiumIndex)
    const price = asRecord(market.priceSnapshot)
    const technical = technicalAnalyses[candidate.symbol]
    return {
      symbol: candidate.symbol,
      side: candidate.side,
      scan_score: numberField(candidate.scan.score),
      price_change_percent_24h: stringField(candidate.scan.priceChangePercent),
      quote_volume_24h: stringField(candidate.scan.quoteVolume),
      tags: Array.isArray(candidate.scan.tags) ? candidate.scan.tags.map(String) : [],
      snapshot_ok: snapshot?.ok === true,
      mark_price: stringField(price.markPrice) || stringField(premium.markPrice) || stringField(ticker.lastPrice),
      funding_rate: stringField(premium.lastFundingRate),
      open_interest: stringField(asRecord(market.openInterest).openInterest),
      technical_analysis: technical?.ok === true ? asRecord(technical.data) : {
        ok: false,
        error: technical?.error || "technical_analysis_not_run",
      },
      strategy_usage: buildStrategyUsage(candidate, strategyPool),
      operator_suggestion: buildOperatorSuggestion(candidate, accountState, snapshot, technical),
      trade_suggestion: buildTradeSuggestion(accountState, strategyPool, snapshot),
    }
  })
}

function summarizeOhlcv(repoRoot: string, fromDir: string, data: JSONRecord): JSONRecord {
  const timeframes = asRecord(data.timeframes)
  return {
    manifest_path: displayPathFrom(stringField(data.manifest_path), fromDir, repoRoot),
    output_dir: displayPathFrom(stringField(data.output_dir), fromDir, repoRoot),
    symbol: stringField(data.symbol),
    timeframes: Object.fromEntries(Object.entries(timeframes).map(([key, value]) => {
      const row = asRecord(value)
      return [key, {
        rows: numberField(row.rows),
        first_open_ts: numberField(row.first_open_ts),
        last_open_ts: numberField(row.last_open_ts),
      }]
    })),
  }
}

function summarizeIndicators(data: JSONRecord): JSONRecord {
  const timeframes = asRecord(data.timeframes)
  return {
    ok: true,
    symbol: stringField(data.symbol),
    generated_at: stringField(data.generated_at),
    summary: asRecord(data.summary),
    timeframes: {
      "1d": summarizeTimeframe(asRecord(timeframes["1d"])),
      "4h": summarizeTimeframe(asRecord(timeframes["4h"])),
      "1h": summarizeTimeframe(asRecord(timeframes["1h"])),
    },
    summary_markdown: clipText(stringField(data.summary_markdown), 1200),
  }
}

function summarizeTimeframe(timeframe: JSONRecord): JSONRecord {
  return {
    trend: stringField(timeframe.trend),
    core_context: asRecord(timeframe.core_context),
    position_in_range: stringField(timeframe.position_in_range),
    bullish_invalidation: stringField(timeframe.bullish_invalidation),
    bearish_invalidation: stringField(timeframe.bearish_invalidation),
    supports: readArray(timeframe.supports).slice(0, 3).map(summarizeLevel),
    resistances: readArray(timeframe.resistances).slice(0, 3).map(summarizeLevel),
    trendlines: readArray(timeframe.trendlines).slice(0, 3).map(summarizeTrendline),
  }
}

function summarizeLevel(value: unknown): JSONRecord {
  const level = asRecord(value)
  return {
    price: numberField(level.price),
    zone_low: numberField(level.zone_low),
    zone_high: numberField(level.zone_high),
    strength: stringField(level.strength),
    touches: numberField(level.touches),
    distance_from_price_pct: numberField(level.distance_from_price_pct),
  }
}

function summarizeTrendline(value: unknown): JSONRecord {
  const line = asRecord(value)
  return {
    kind: stringField(line.kind),
    line_family: stringField(line.line_family),
    projected_price: numberField(line.projected_price),
    projected_low: numberField(line.projected_low),
    projected_high: numberField(line.projected_high),
    distance_from_price_pct: numberField(line.distance_from_price_pct),
    invalidation: stringField(line.invalidation),
    score: numberField(line.score),
  }
}

function buildOperatorSuggestion(
  candidate: { symbol: string; side: "long" | "short"; scan: JSONRecord },
  accountState: JSONRecord,
  snapshot: SkillCallResult | undefined,
  technical: SkillCallResult | undefined,
): JSONRecord {
  if (accountState.ok !== true) {
    return { action: "stand_down", reason: "account_snapshot_unavailable" }
  }
  if (snapshot?.ok !== true) {
    return { action: "stand_down", reason: "symbol_snapshot_unavailable" }
  }
  if (technical?.ok !== true) {
    return { action: "watch_only", reason: "technical_analysis_unavailable" }
  }
  const indicators = asRecord(asRecord(technical.data).indicators)
  const summary = asRecord(indicators.summary)
  const bias = stringField(summary.bias)
  const baseSuggestion = stringField(summary.suggestion)
  const aligned = candidate.side === "long"
    ? ["bullish", "slightly-bullish"].includes(bias)
    : ["bearish", "slightly-bearish"].includes(bias)
  const tf4h = asRecord(asRecord(indicators.timeframes)["4h"])
  return {
    action: aligned ? (candidate.side === "long" ? "watch_long_setup" : "watch_short_setup") : "avoid_chasing_wait",
    reason: aligned ? "market_scan_direction_aligns_with_technical_bias" : "market_scan_direction_conflicts_or_is_not_confirmed",
    bias,
    suggestion: baseSuggestion,
    execution: "manual_only_no_exchange_write",
    reference_levels: {
      supports: readArray(tf4h.supports).slice(0, 2),
      resistances: readArray(tf4h.resistances).slice(0, 2),
      bullish_invalidation: stringField(tf4h.bullish_invalidation),
      bearish_invalidation: stringField(tf4h.bearish_invalidation),
    },
  }
}

function buildStrategyUsage(candidate: { symbol: string; side: "long" | "short" }, strategyPool: JSONRecord): JSONRecord {
  const liveStrategies = readArray(strategyPool.live_small_ready).map(asRecord)
  const matching = liveStrategies.filter((strategy) => {
    const tags = Array.isArray(strategy.tags) ? strategy.tags.map((tag) => String(tag).toLowerCase()) : []
    return tags.includes(candidate.symbol.toLowerCase().replace("usdt", "")) || tags.includes("usdm")
  })
  return {
    evaluated: false,
    matched_live_small_strategies: matching.map((strategy) => stringField(strategy.strategy_id)).filter(Boolean),
    note: matching.length > 0
      ? "strategy_signal_not_wired_in_this_dry_run"
      : "no_live_small_strategy_match",
  }
}

function buildTradeSuggestion(accountState: JSONRecord, strategyPool: JSONRecord, snapshot?: SkillCallResult): JSONRecord {
  if (accountState.ok !== true) {
    return {
      target_action: "no_action",
      reason: "account_snapshot_unavailable",
    }
  }
  if (snapshot?.ok !== true) {
    return {
      target_action: "no_action",
      reason: "symbol_snapshot_unavailable",
    }
  }
  if (readArray(strategyPool.live_small_ready).length === 0) {
    return {
      target_action: "no_action",
      reason: "no_live_small_strategy",
    }
  }
  return {
    target_action: "no_action",
    reason: "strategy_signal_and_preflight_not_wired_in_this_dry_run",
  }
}

function buildNoActionReason(accountState: JSONRecord, strategyPool: JSONRecord, watchlist: JSONRecord[]): string {
  if (accountState.ok !== true) {
    return "account_snapshot_unavailable"
  }
  if (watchlist.length === 0) {
    return "no_market_scan_candidates"
  }
  if (readArray(strategyPool.live_small_ready).length === 0) {
    return "no_live_small_strategy"
  }
  return "strategy_signal_and_preflight_not_wired_in_this_dry_run"
}

function uniqueSymbols(candidates: Array<{ symbol: string }>): string[] {
  return [...new Set(candidates.map((candidate) => candidate.symbol))]
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function workflowRuntimeAvailable(repoRoot: string): boolean {
  return existsSync(join(repoRoot, "profile/account_config.json"))
    && existsSync(join(repoRoot, ".agents/skills/trade-flow/strategies"))
}

function clipText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value
}
