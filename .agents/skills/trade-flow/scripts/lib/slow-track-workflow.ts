import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { listActiveFlows } from "./flow-state"
import { asRecord, numberField, stringField, type JSONRecord } from "./json"
import { loadRuntime } from "./observe-flow"
import { type Runner } from "./observe-adapter"
import { runJsonCommand } from "./skill-runner"

interface SlowTrackWorkflowInput {
  repoRoot: string
  dataDir: string
  runId: string
  db: Database
  candidateLimitPerSide?: number
  symbolSnapshotLimitPerSide?: number
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
  const strategyPool = summarizeStrategyPool(runtime)
  const accountState = summarizeAccountState(accountSnapshot)
  const watchlist = buildWatchlist(candidates, symbolSnapshots, strategyPool, accountState)
  const report = {
    track: "slow",
    mode: "workflow-dry-run",
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
      "strategy_pool_gate",
      "watchlist_and_no_action_decision",
      "cron_log",
    ],
  }
  const artifactPath = join(input.dataDir, `slow-track-${input.runId}.json`)
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`)
  return {
    ...report,
    artifact_path: artifactPath,
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
  strategyPool: JSONRecord,
  accountState: JSONRecord,
): JSONRecord[] {
  return candidates.map((candidate) => {
    const snapshot = snapshots[candidate.symbol]
    const market = asRecord(snapshot?.data)
    const ticker = asRecord(market.ticker24h)
    const premium = asRecord(market.premiumIndex)
    const price = asRecord(market.priceSnapshot)
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
      strategy_usage: buildStrategyUsage(candidate, strategyPool),
      trade_suggestion: buildTradeSuggestion(accountState, strategyPool, snapshot),
    }
  })
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
