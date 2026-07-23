import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { loadJsonFile, loadStrategies } from "../../../../contracts/strategy-policy/src/strategy-policy"
import { asRecord, numberField, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { displayPath, displayPathFrom, resolvePathFrom } from "../../../../contracts/runtime-core/src/paths"
import { runJsonCommand, runToolCommand, type Runner, type ToolCallResult } from "../../../../contracts/runtime-core/src/tool-runner"
import { resolveRegisteredOwnerTool } from "../../../../contracts/runtime-core/src/owner-tool-registry"
import {
  buildMarketDataDemand,
  type MarketDataDemand,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { timeframeMilliseconds } from "../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-contract"
import { compileIndicatorFeatureArtifact } from "../../../../contracts/market-data-demand-contract/src/indicator-feature-contract"
import { activeFlows } from "./flow-projector-client"
import { loadRuntimePolicyFromOwner } from "./runtime-policy-client"
import { buildDecisionChain } from "./decision-chain"

interface SlowTrackWorkflowInput {
  repoRoot: string
  dataDir: string
  runId: string
  dbPath: string
  candidateLimitPerSide?: number
  symbolSnapshotLimitPerSide?: number
  technicalAnalysisLimitPerSide?: number
  runner?: Runner
  activeFlowCountReader?: (dbPath: string) => number
  runtimePolicyLoader?: (tradingConfigPath: string) => JSONRecord
  marketDataDemandWriter?: (demand: MarketDataDemand) => Promise<ToolCallResult>
}

function loadRuntime(
  accountConfigPath: string,
  tradingConfigPath: string,
  strategiesDir: string,
  runtimePolicyLoader: (tradingConfigPath: string) => JSONRecord,
): JSONRecord {
  const accountConfig = loadJsonFile(accountConfigPath)
  const strategies = loadStrategies(strategiesDir)
  const { trading_config, runtime_policy, runtime_authorization } = runtimePolicyLoader(tradingConfigPath)
  return {
    trading_config,
    runtime_policy,
    runtime_authorization,
    account_config: accountConfig,
    strategies,
    loaded_at: new Date().toISOString(),
  }
}

export async function runSlowTrackWorkflowDryRun(input: SlowTrackWorkflowInput): Promise<JSONRecord> {
  const runner = input.runner ?? runJsonCommand
  const candidateLimit = input.candidateLimitPerSide ?? 5
  const snapshotLimit = input.symbolSnapshotLimitPerSide ?? 3
  const technicalLimit = input.technicalAnalysisLimitPerSide ?? snapshotLimit
  const accountConfigPath = join(input.repoRoot, "profile/account_config.json")
  const tradingConfigPath = join(input.repoRoot, "profile/trading-config.json")
  const strategiesDir = join(input.repoRoot, "strategies")
  const runtime = loadRuntime(
    accountConfigPath,
    tradingConfigPath,
    strategiesDir,
    input.runtimePolicyLoader ?? ((path) => loadRuntimePolicyFromOwner({ tradingConfigPath: path })),
  )

  const [accountSnapshot, marketScan] = await Promise.all([
    runOwnerTool(runner, input.repoRoot, "binance.account-snapshot", ["--timeout", "10"]),
    runOwnerTool(runner, input.repoRoot, "binance.market-scan", ["--direction", "both", "--limit-per-side", String(candidateLimit)]),
  ])

  const candidates = extractCandidates(marketScan.data, snapshotLimit)
  const generatedAt = new Date().toISOString()
  const marketDataDemands = await submitCandidateMarketDataDemands(input, runner, candidates, generatedAt)
  const symbolSnapshots = await fetchSymbolSnapshots(input.repoRoot, runner, candidates)
  const technicalAnalyses = await fetchTechnicalAnalyses(
    input,
    runner,
    extractCandidates(marketScan.data, technicalLimit),
    generatedAt,
  )
  const strategyPool = summarizeStrategyPool(runtime)
  const accountState = summarizeAccountState(accountSnapshot)
  const watchlist = buildWatchlist(candidates, symbolSnapshots, technicalAnalyses, strategyPool, accountState)
  const decisionChain = buildDecisionChain({
    runId: input.runId,
    generatedAt,
    runtime,
    accountState,
    watchlist,
  })
  const report = {
    track: "slow",
    mode: "analysis-only",
    executable: false,
    live_execution_allowed: false,
    run_id: input.runId,
    generated_at: generatedAt,
    active_flow_count: readActiveFlowCount(input),
    strategy_pool: strategyPool,
    account_state: accountState,
    market_scan: {
      ok: marketScan.ok,
      error: marketScan.error,
      summary: asRecord(asRecord(marketScan.data).summary),
      filters: asRecord(asRecord(marketScan.data).filters),
    },
    market_data_demands: marketDataDemands,
    watchlist,
    decision_input_bundle: decisionChain.decision_input_bundle,
    trade_plan_draft: decisionChain.trade_plan_draft,
    capital_allocation_proposal: decisionChain.capital_allocation_proposal,
    action_intent: decisionChain.action_intent,
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
  const artifactPath = join(input.repoRoot, "tmp", "artifacts", "trade-flow", `slow-track-${input.runId}.json`)
  mkdirSync(dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`)
  return {
    ...report,
    artifact_path: displayPath(artifactPath, input.repoRoot),
  }
}

async function submitCandidateMarketDataDemands(
  input: SlowTrackWorkflowInput,
  runner: Runner,
  candidates: Array<{ symbol: string; side: "long" | "short"; scan: JSONRecord }>,
  observedAt: string,
): Promise<JSONRecord> {
  const issuedAt = new Date(Math.floor(Date.parse(observedAt) / 60_000) * 60_000).toISOString()
  const demands = uniqueSymbols(candidates).map((symbol) => buildMarketDataDemand({
    demand_id: `slow-track-candidate:${symbol.toLowerCase()}`,
    consumer_owner: "slow-track-plan",
    consumer_kind: "runtime",
    subject_ref: `market-watch:symbol/${symbol}`,
    venue: "binance_usdm",
    symbol,
    priority: "opportunity_candidate",
    requirements: [
      {
        product: "l2_book",
        timeframe: null,
        indicator_set_ref: null,
        coverage_start: null,
        coverage_end: null,
        max_freshness_ms: 2_000,
        minimum_depth: 20,
      },
      ...["1d", "4h", "1h"].flatMap((timeframe) => [{
        product: "ohlcv" as const,
        timeframe,
        indicator_set_ref: null,
        coverage_start: desiredCoverageStart(issuedAt, timeframe),
        coverage_end: null,
        max_freshness_ms: 60_000,
        minimum_depth: null,
      }, {
        product: "indicator_set" as const,
        timeframe,
        indicator_set_ref: "indicator-set:technical-default-v1",
        coverage_start: desiredCoverageStart(issuedAt, timeframe),
        coverage_end: null,
        max_freshness_ms: 60_000,
        minimum_depth: null,
      }]),
    ],
    lease: {
      issued_at: issuedAt,
      expires_at: new Date(Date.parse(issuedAt) + 15 * 60_000).toISOString(),
      renewal_grace_ms: 0,
    },
  }))
  const outcomes = await Promise.all(demands.map(async (demand) => {
    try {
      const result = input.marketDataDemandWriter
        ? await input.marketDataDemandWriter(demand)
        : await runOwnerTool(runner, input.repoRoot, "market-data.store", [
          "--db", join(input.dataDir, "market_data.db"),
          "--action", "put_market_data_demand",
          "--json", JSON.stringify({ demand, committed_at: observedAt }),
        ])
      const data = asRecord(result.data)
      const accepted = result.ok
        && data.action === "put_market_data_demand"
        && data.demand_id === demand.demand_id
        && data.demand_hash === demand.demand_hash
      return {
        demand_ref: `market_data_store:demand/${demand.demand_id}`,
        symbol: demand.symbol,
        accepted,
        reason: accepted ? stringField(data.commit_status) || "accepted" : result.error || "owner_response_identity_drifted",
      }
    } catch (error) {
      return {
        demand_ref: `market_data_store:demand/${demand.demand_id}`,
        symbol: demand.symbol,
        accepted: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }))
  return {
    requested_count: outcomes.length,
    accepted_count: outcomes.filter((item) => item.accepted).length,
    failed_count: outcomes.filter((item) => !item.accepted).length,
    outcomes,
    lifecycle_authority: "none",
  }
}

function readActiveFlowCount(input: SlowTrackWorkflowInput): number {
  if (input.activeFlowCountReader) return input.activeFlowCountReader(input.dbPath)
  const projection = activeFlows(input.dbPath)
  return numberField(projection.active_flow_count) ?? readArray(projection.active_flows).length
}

async function fetchTechnicalAnalyses(
  input: SlowTrackWorkflowInput,
  runner: Runner,
  candidates: Array<{ symbol: string; side: "long" | "short"; scan: JSONRecord }>,
  observedAt: string,
): Promise<Record<string, ToolCallResult>> {
  const results: Record<string, ToolCallResult> = {}
  const unique = uniqueSymbols(candidates)
  for (const symbol of unique) {
    results[symbol] = await runTechnicalAnalysis(input, runner, symbol, observedAt)
  }
  return results
}

async function runTechnicalAnalysis(
  input: SlowTrackWorkflowInput,
  runner: Runner,
  symbol: string,
  observedAt: string,
): Promise<ToolCallResult> {
  const admitted = await readAdmittedTechnicalAnalysis(input, runner, symbol, observedAt)
  if (admitted.ok) return admitted
  const ohlcvOutputDir = join(input.repoRoot, "tmp", "market", input.runId, symbol)
  const marketDataDb = join(input.dataDir, "market_data.db")
  const ohlcvDb = join(input.dataDir, "ohlcv.db")
  const ohlcvOwner = resolveRegisteredOwnerTool(
    "ohlcv-fetch",
    [
      "--symbol",
      symbol,
      "--timeframes",
      "1d,4h,1h",
      "--output-dir",
      ohlcvOutputDir,
      "--market-data-db",
      marketDataDb,
      "--ohlcv-db",
      ohlcvDb,
    ],
    input.repoRoot,
  )
  const ohlcv = await runToolCommand(runner, ohlcvOwner.argv, ohlcvOwner.cwd)
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
  const manifestFsPath = resolvePathFrom(manifestPath, ohlcvOwner.cwd)
  const indicatorOwner = resolveRegisteredOwnerTool(
    "tech-indicators",
    ["./src/scripts", "--manifest", manifestFsPath],
    input.repoRoot,
  )
  const indicators = await runToolCommand(runner, indicatorOwner.argv, indicatorOwner.cwd)
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
      source_mode: "compatibility_one_shot_until_resident_feature_ready",
      resident_feature_error: admitted.error,
      ohlcv: summarizeOhlcv(input.repoRoot, ohlcvOwner.cwd, asRecord(ohlcv.data)),
      indicators: summarizeIndicators(asRecord(indicators.data)),
    },
  }
}

async function readAdmittedTechnicalAnalysis(
  input: SlowTrackWorkflowInput,
  runner: Runner,
  symbol: string,
  observedAt: string,
): Promise<ToolCallResult> {
  try {
    const artifacts: Record<string, ReturnType<typeof compileIndicatorFeatureArtifact>> = {}
    for (const timeframe of ["1d", "4h", "1h"]) {
      const listed = await runOwnerTool(runner, input.repoRoot, "market-data.store", [
        "--db", join(input.dataDir, "market_data.db"),
        "--ohlcv-db", join(input.dataDir, "ohlcv.db"),
        "--action", "list_feature_manifests",
        "--json", JSON.stringify({
          symbol,
          timeframe,
          feature_set_id: "indicator-set:technical-default-v1",
          limit: 10,
        }),
      ])
      if (!listed.ok) return { ok: false, error: listed.error || `feature_list_failed:${timeframe}` }
      const manifests = readArray(asRecord(listed.data).manifests).map(asRecord)
      const desiredStart = Date.parse(desiredCoverageStart(observedAt, timeframe))
      const timeframeMs = timeframeMilliseconds(timeframe)
      const desiredEnd = Math.floor(Date.parse(observedAt) / timeframeMs) * timeframeMs - timeframeMs
      let selected: ReturnType<typeof compileIndicatorFeatureArtifact> | undefined
      for (const manifest of manifests) {
        const manifestId = stringField(manifest.feature_manifest_id)
        if (!manifestId) continue
        const read = await runOwnerTool(runner, input.repoRoot, "market-data.store", [
          "--db", join(input.dataDir, "market_data.db"),
          "--ohlcv-db", join(input.dataDir, "ohlcv.db"),
          "--action", "read_feature_artifact",
          "--json", JSON.stringify({ feature_manifest_id: manifestId }),
        ])
        if (!read.ok) continue
        const artifact = compileIndicatorFeatureArtifact(asRecord(read.data).artifact)
        if (artifact.source.symbol === symbol
          && artifact.source.timeframe === timeframe
          && artifact.source.first_open_time <= desiredStart
          && artifact.source.last_open_time >= desiredEnd) {
          selected = artifact
          break
        }
      }
      if (selected == null) return { ok: false, error: `resident_feature_not_ready:${timeframe}` }
      artifacts[timeframe] = selected
    }
    const tf4h = artifacts["4h"]!
    return {
      ok: true,
      data: {
        source_mode: "resident_demand_feature_artifacts",
        ohlcv: {
          source_refs: Object.fromEntries(Object.entries(artifacts).map(([timeframe, artifact]) => [
            timeframe,
            artifact.source.slice_ref,
          ])),
        },
        indicators: {
          ok: true,
          symbol,
          summary: tf4h.summary,
          timeframes: Object.fromEntries(Object.entries(artifacts).map(([timeframe, artifact]) => [
            timeframe,
            artifact.timeframe_result,
          ])),
        },
      },
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function fetchSymbolSnapshots(
  repoRoot: string,
  runner: Runner,
  candidates: Array<{ symbol: string; side: "long" | "short"; scan: JSONRecord }>,
): Promise<Record<string, ToolCallResult>> {
  const unique = uniqueSymbols(candidates)
  const entries = await Promise.all(unique.map(async (symbol) => {
    const result = await runOwnerTool(runner, repoRoot, "binance.symbol-snapshot", ["--symbol", symbol, "--pulse"])
    return [symbol, result] as const
  }))
  return Object.fromEntries(entries)
}

function runOwnerTool(
  runner: Runner,
  ownerRepoRoot: string,
  toolId: string,
  args: string[],
): Promise<ToolCallResult> {
  const owner = resolveRegisteredOwnerTool(toolId, args, ownerRepoRoot)
  return runToolCommand(runner, owner.argv, owner.cwd)
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

function summarizeAccountState(snapshot: ToolCallResult): JSONRecord {
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
  const facts = asRecord(data.account_facts)
  const orders = asRecord(facts.open_orders ?? data.openOrders)
  const regularOrders = readArray(orders.regular)
  const protectiveOrders = readArray(orders.protective)
  return {
    ok: true,
    generated_at: stringField(facts.as_of) || stringField(data.generated_at),
    account_ref: stringField(facts.account_ref),
    account_scope: stringField(facts.account_scope),
    snapshot_ref: stringField(facts.snapshot_ref) || stringField(data.snapshot_ref),
    content_hash: stringField(facts.content_hash) || stringField(data.content_hash),
    balances_count: readArray(facts.balances ?? data.balances).length,
    positions_count: readArray(facts.positions ?? data.positions).length,
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
  snapshots: Record<string, ToolCallResult>,
  technicalAnalyses: Record<string, ToolCallResult>,
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
  snapshot: ToolCallResult | undefined,
  technical: ToolCallResult | undefined,
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

function buildTradeSuggestion(accountState: JSONRecord, strategyPool: JSONRecord, snapshot?: ToolCallResult): JSONRecord {
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

function desiredCoverageStart(observedAt: string, timeframe: string): string {
  const timeframeMs = timeframeMilliseconds(timeframe)
  const latestClosedOpen = Math.floor(Date.parse(observedAt) / timeframeMs) * timeframeMs - timeframeMs
  return new Date(latestClosedOpen - 239 * timeframeMs).toISOString()
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function workflowRuntimeAvailable(repoRoot: string): boolean {
  return existsSync(join(repoRoot, "profile/account_config.json"))
    && existsSync(join(repoRoot, "strategies"))
}

function clipText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value
}
