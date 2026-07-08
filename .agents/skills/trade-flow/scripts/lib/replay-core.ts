import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

type Side = "long" | "short"
type JSONRecord = Record<string, unknown>
type ExitReason = "target" | "stop" | "time_exit"

interface Candle {
  date: string
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface IndicatorSet {
  ema20: number[]
  ema50: number[]
  ema200: number[]
  atr14: number[]
}

interface ReplaySignal {
  side: Side
  signal_index: number
  entry_index: number
  entry: number
  stop: number
  target: number
  reason: string
  meta?: JSONRecord
}

interface ReplayTrade {
  side: Side
  signal_time: string
  entry_time: string
  exit_time: string
  entry: number
  exit: number
  stop: number
  target: number
  r: number
  funding_r?: number
  outcome: ExitReason
  reason: string
  bars_held: number
  regime: string
  meta?: JSONRecord
}

interface ReplayStrategy {
  strategy_id: string
  default_timeframe: string
  warmup_bars: number
  generateSignal(input: {
    candles: Candle[]
    indicators: IndicatorSet
    index: number
    entryPrice: number
    entryIndex: number
    options: ReplayOptions
  }): ReplaySignal | null
}

interface ReplayOptions {
  manifestPath: string
  strategyId?: string
  timeframe?: string
  maxHoldBars?: number
  rewardRisk?: number
  feeBps?: number
  slippageBps?: number
  fundingBpsPer8h?: number
  fundingEvents?: Array<{ timestamp: string; value: number }>
  oosSplitRatio?: number
  trialCount?: number
  parameterCount?: number
  antiOverfitStage?: "selection_validation" | "external_validation" | "locked_holdout"
  supplementalDataRefs?: string[]
  skipParameterStability?: boolean
}

interface ReplayResult {
  strategy_id: string
  symbol: string
  timeframe: string
  sample_count: number
  win_rate: number
  avg_r: number
  total_r: number
  max_drawdown_r: number
  profit_factor: number
  expectancy_r: number
  gate: {
    shadow_candidate: boolean
    live_small_candidate: false
    blocked_by: Array<{ check_id: string; reason: string }>
  }
  trades: ReplayTrade[]
  assumptions: JSONRecord
  provenance: ReplayProvenance
  notes: string[]
}

interface ReplayProvenance {
  harness_hash: string
  data_hash: string
  assumptions_hash: string
  data_ref: string
  timeframe: string
  data_schema_version: number
  closed_candles_only: boolean
  manifest_checksum_verified: boolean
  supplemental_data?: Array<{ ref: string; content_sha256: string }>
}

interface LatestSignalResult {
  strategy_id: string
  symbol: string
  timeframe: string
  signal_time: string
  entry_reference: number
  action: "entry" | "no_action"
  signal: ReplaySignal | null
}

function replayStrategy(strategy: ReplayStrategy, options: ReplayOptions): ReplayResult {
  const timeframe = options.timeframe || strategy.default_timeframe
  const effectiveOptions = { ...options, timeframe }
  const maxHoldBars = options.maxHoldBars ?? 18
  const manifest = loadManifest(options.manifestPath)
  const candles = loadCandlesFromManifest(options.manifestPath, manifest, timeframe)
  const indicators = buildIndicators(candles)
  const fundingCoverage = analyzeFundingCoverage(candles, options.fundingEvents || [])
  const trades: ReplayTrade[] = []
  let index = Math.max(strategy.warmup_bars, 1)

  while (index < candles.length - 2) {
    const signal = strategy.generateSignal({
      candles,
      indicators,
      index,
      entryPrice: candles[index + 1].open,
      entryIndex: index + 1,
      options,
    })
    if (!signal) {
      index += 1
      continue
    }
    const trade = resolveTrade(candles, signal, maxHoldBars, effectiveOptions)
    trade.regime = classifyMarketRegime(candles, indicators, signal.signal_index)
    trades.push(trade)
    const exitIndex = candles.findIndex((candle) => candle.timestamp === Date.parse(trade.exit_time))
    index = Math.max(signal.entry_index + 1, exitIndex + 1)
  }

  const assumptions: JSONRecord = {
    max_hold_bars: maxHoldBars,
    reward_risk: options.rewardRisk ?? 2,
    fee_bps: options.feeBps ?? 0,
    slippage_bps: options.slippageBps ?? 0,
    adverse_funding_bps_per_8h: options.fundingBpsPer8h ?? 0,
    funding_model: options.fundingEvents?.length ? "historical_events_entry_notional" : "adverse_stress_only",
    funding_event_count: options.fundingEvents?.length ?? 0,
    funding_events_hash: options.fundingEvents?.length ? hashCanonical(options.fundingEvents) : null,
    funding_event_coverage: fundingCoverage,
    stop_gap_policy: "next_open_if_worse",
    same_candle_policy: "stop_first",
    overlapping_positions: false,
  }
  const antiOverfit = buildAntiOverfitProof(trades, effectiveOptions)
  if (antiOverfit) {
    assumptions.anti_overfit = antiOverfit
  }
  const robustness = buildRobustnessProof(trades)
  if (options.antiOverfitStage === "locked_holdout" && !options.skipParameterStability) {
    robustness.parameter_stability = buildReplayParameterStability(strategy, effectiveOptions)
  }
  assumptions.robustness = robustness

  const result = summarizeReplay({
    strategy_id: strategy.strategy_id,
    symbol: stringField(manifest.symbol) || stringField(manifest.requested_symbol) || "UNKNOWN",
    timeframe,
    trades,
    assumptions,
  })
  if (fundingCoverage.status === "partial") {
    result.gate.shadow_candidate = false
    result.gate.blocked_by.push({ check_id: "R-FUNDING-COVERAGE", reason: "historical funding events do not cover the complete replay interval" })
  }
  result.provenance = buildReplayProvenance(options.manifestPath, timeframe, assumptions, options.supplementalDataRefs)
  return result
}

function analyzeFundingCoverage(candles: Candle[], events: Array<{ timestamp: string; value: number }>): JSONRecord {
  if (events.length === 0 || candles.length === 0) return { status: "none", event_count: events.length }
  const timestamps = events.map((event) => Date.parse(event.timestamp)).filter(Number.isFinite).sort((a, b) => a - b)
  if (timestamps.length === 0) return { status: "invalid", event_count: events.length }
  const first = timestamps[0]
  const last = timestamps.at(-1) || first
  const maxGap = timestamps.slice(1).reduce((gap, timestamp, index) => Math.max(gap, timestamp - timestamps[index]), 0)
  const tolerance = 9 * 3_600_000
  const complete = first <= candles[0].timestamp + tolerance && last >= candles.at(-1)!.timestamp - tolerance && maxGap <= tolerance
  return { status: complete ? "complete" : "partial", event_count: timestamps.length, first: new Date(first).toISOString(), last: new Date(last).toISOString(), max_gap_hours: round(maxGap / 3_600_000) }
}

function evaluateLatestSignal(
  strategy: ReplayStrategy,
  options: ReplayOptions,
  entryPrice: number,
  freshness: { now?: string; maxAgeBars?: number } = {},
): LatestSignalResult {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error("latest signal requires a positive entry price")
  }
  const timeframe = options.timeframe || strategy.default_timeframe
  const manifest = loadManifest(options.manifestPath)
  const candles = loadCandlesFromManifest(options.manifestPath, manifest, timeframe)
  const index = candles.length - 1
  if (index < strategy.warmup_bars) {
    throw new Error(`latest signal requires at least ${strategy.warmup_bars + 1} candles`)
  }
  const interval = timeframeMilliseconds(timeframe)
  const now = freshness.now ? Date.parse(freshness.now) : Date.now()
  const closedAt = candles[index].timestamp + interval
  const maxAgeBars = freshness.maxAgeBars ?? 1
  if (!Number.isFinite(now) || maxAgeBars < 0 || closedAt > now || now - closedAt > interval * maxAgeBars) {
    throw new Error(`latest closed candle is stale or not yet closed: ${candles[index].date}`)
  }
  const signal = strategy.generateSignal({
    candles,
    indicators: buildIndicators(candles),
    index,
    entryPrice,
    entryIndex: candles.length,
    options,
  })
  return {
    strategy_id: strategy.strategy_id,
    symbol: stringField(manifest.symbol) || stringField(manifest.requested_symbol) || "UNKNOWN",
    timeframe,
    signal_time: candles[index].date,
    entry_reference: entryPrice,
    action: signal ? "entry" : "no_action",
    signal,
  }
}

function timeframeMilliseconds(timeframe: string): number {
  const match = timeframe.match(/^(\d+)([mhdw])$/)
  if (!match) throw new Error(`unsupported signal timeframe: ${timeframe}`)
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]] || 0
  return Number(match[1]) * unit
}

function loadManifest(path: string): JSONRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JSONRecord
}

function loadCandlesFromManifest(manifestPath: string, manifest: JSONRecord, timeframe: string): Candle[] {
  const timeframes = asRecord(manifest.timeframes)
  const item = asRecord(timeframes[timeframe])
  const file = stringField(item.file)
  if (!file) {
    throw new Error(`manifest missing timeframe ${timeframe}`)
  }
  return parseCsvCandles(readFileSync(join(dirname(manifestPath), file), "utf8"))
}

function parseCsvCandles(csv: string): Candle[] {
  const lines = csv.trim().split(/\r?\n/)
  const headers = lines.shift()?.split(",") ?? []
  const index = Object.fromEntries(headers.map((header, idx) => [header, idx]))
  return lines.map((line) => {
    const parts = line.split(",")
    return {
      date: parts[index.date],
      timestamp: Number(parts[index.timestamp]),
      open: Number(parts[index.open]),
      high: Number(parts[index.high]),
      low: Number(parts[index.low]),
      close: Number(parts[index.close]),
      volume: Number(parts[index.volume]),
    }
  }).filter((item) => Number.isFinite(item.close))
}

function buildIndicators(candles: Candle[]): IndicatorSet {
  const closes = candles.map((item) => item.close)
  return {
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    atr14: atr(candles, 14),
  }
}

function resolveTrade(
  candles: Candle[],
  signal: ReplaySignal,
  maxHoldBars: number,
  options: ReplayOptions,
): ReplayTrade {
  const end = Math.min(candles.length - 1, signal.entry_index + maxHoldBars)
  for (let index = signal.entry_index; index <= end; index += 1) {
    const candle = candles[index]
    if (signal.side === "long") {
      const hitStop = candle.low <= signal.stop
      const hitTarget = candle.high >= signal.target
      if (hitStop || hitTarget) {
        return buildTrade(signal, candles[signal.signal_index], candles[signal.entry_index], candle, hitStop ? "stop" : "target", options, index - signal.entry_index)
      }
    } else {
      const hitStop = candle.high >= signal.stop
      const hitTarget = candle.low <= signal.target
      if (hitStop || hitTarget) {
        return buildTrade(signal, candles[signal.signal_index], candles[signal.entry_index], candle, hitStop ? "stop" : "target", options, index - signal.entry_index)
      }
    }
  }
  return buildTrade(signal, candles[signal.signal_index], candles[signal.entry_index], candles[end], "time_exit", options, end - signal.entry_index)
}

function buildTrade(
  signal: ReplaySignal,
  signalCandle: Candle,
  entryCandle: Candle,
  exitCandle: Candle,
  outcome: ExitReason,
  options: ReplayOptions,
  barsHeld: number,
): ReplayTrade {
  const risk = Math.abs(signal.entry - signal.stop)
  const exit = outcome === "target"
    ? signal.target
    : outcome === "stop"
      ? signal.side === "long" ? Math.min(signal.stop, exitCandle.open) : Math.max(signal.stop, exitCandle.open)
      : exitCandle.close
  const grossR = signal.side === "long"
    ? (exit - signal.entry) / risk
    : (signal.entry - exit) / risk
  const costs = estimateCostR(signal.side, signal.entry, exit, risk, barsHeld, entryCandle.timestamp, exitCandle.timestamp + (outcome === "time_exit" ? timeframeMilliseconds(options.timeframe || "4h") : 0), options)
  return {
    side: signal.side,
    signal_time: signalCandle.date,
    entry_time: entryCandle.date,
    exit_time: exitCandle.date,
    entry: round(signal.entry),
    exit: round(exit),
    stop: round(signal.stop),
    target: round(signal.target),
    r: round(grossR - costs.total),
    funding_r: round(costs.funding),
    outcome,
    reason: signal.reason,
    bars_held: barsHeld,
    regime: "unknown",
    ...(signal.meta ? { meta: signal.meta } : {}),
  }
}

function estimateCostR(side: Side, entry: number, exit: number, risk: number, barsHeld: number, entryTime: number, exitTime: number, options: ReplayOptions): { total: number; funding: number } {
  const feeBps = options.feeBps ?? 0
  const slippageBps = options.slippageBps ?? 0
  const fundingBps = options.fundingBpsPer8h ?? 0
  if (risk <= 0 || (feeBps <= 0 && slippageBps <= 0 && fundingBps <= 0 && !options.fundingEvents?.length)) {
    return { total: 0, funding: 0 }
  }
  const tradingCost = (Math.abs(entry) + Math.abs(exit)) * (feeBps + slippageBps) / 10000
  const heldHours = (barsHeld + 1) * timeframeMilliseconds(options.timeframe || "4h") / 3_600_000
  const stressFunding = Math.abs(entry) * fundingBps * heldHours / 8 / 10000
  const historicalFunding = Math.abs(entry) * (side === "long" ? 1 : -1) * (options.fundingEvents || [])
    .filter((event) => Date.parse(event.timestamp) > entryTime && Date.parse(event.timestamp) <= exitTime)
    .reduce((sum, event) => sum + event.value, 0)
  const fundingR = (stressFunding + historicalFunding) / risk
  return { total: tradingCost / risk + fundingR, funding: fundingR }
}

function summarizeReplay(input: {
  strategy_id: string
  symbol: string
  timeframe: string
  trades: ReplayTrade[]
  assumptions: JSONRecord
}): ReplayResult {
  const stats = summarizeTrades(input.trades)
  return {
    strategy_id: input.strategy_id,
    symbol: input.symbol,
    timeframe: input.timeframe,
    ...stats,
    expectancy_r: stats.avg_r,
    gate: evaluateReplayGate(stats),
    trades: input.trades,
    assumptions: input.assumptions,
    provenance: {
      harness_hash: "",
      data_hash: "",
      assumptions_hash: hashCanonical(input.assumptions),
      data_ref: "",
      timeframe: input.timeframe,
      data_schema_version: 0,
      closed_candles_only: false,
      manifest_checksum_verified: false,
    },
    notes: [
      "Replay is mechanical and conservative: if stop and target hit in the same candle, stop wins.",
      "Replay enforces one active position per strategy lane.",
      "This is evidence for draft/shadow gating, not permission for live-small by itself.",
    ],
  }
}

function buildAntiOverfitProof(trades: ReplayTrade[], options: ReplayOptions): JSONRecord | null {
  if (trades.length === 0) {
    return null
  }
  if (options.antiOverfitStage === "locked_holdout" || options.antiOverfitStage === "external_validation") {
    const stage = options.antiOverfitStage
    return {
      method: "out_of_sample",
      stage,
      oos_stats: summarizeTrades(trades),
      trial_count: options.trialCount ?? 1,
      parameter_count: options.parameterCount ?? 0,
      notes: stage === "locked_holdout"
        ? "The frozen candidate is evaluated on the complete pristine holdout; no holdout segment is reused for selection."
        : "The frozen candidate is evaluated on the complete non-overlapping external dataset; this is not pristine holdout evidence.",
    }
  }
  const ratio = options.oosSplitRatio ?? 0
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    return null
  }
  if (trades.length < 2) {
    return {
      method: "out_of_sample",
      stage: "selection_validation",
      train_stats: summarizeTrades([]),
      oos_stats: summarizeTrades(trades),
      purged_overlap_count: 0,
      trial_count: options.trialCount ?? 1,
      parameter_count: options.parameterCount ?? 0,
      notes: "Selection validation has fewer than two trades and cannot form independent train/OOS samples.",
    }
  }
  const splitIndex = Math.max(1, Math.min(trades.length - 1, Math.floor(trades.length * (1 - ratio))))
  const oosStart = Date.parse(trades[splitIndex].signal_time)
  const train = trades.slice(0, splitIndex).filter((trade) => Date.parse(trade.exit_time) < oosStart)
  const purgedCount = splitIndex - train.length
  return {
    method: "out_of_sample",
    stage: "selection_validation",
    train_stats: summarizeTrades(train),
    oos_stats: summarizeTrades(trades.slice(splitIndex)),
    purged_overlap_count: purgedCount,
    trial_count: options.trialCount ?? 1,
    parameter_count: options.parameterCount ?? 0,
    notes: `Selection validation uses the last ${round(ratio * 100)}% of chronological replay trades and purges training labels crossing the OOS boundary; it is not a locked final holdout.`,
  }
}

function classifyMarketRegime(candles: Candle[], indicators: IndicatorSet, index: number): string {
  const close = candles[index]?.close
  const longTrend = indicators.ema200[index]
  const atrNow = indicators.atr14[index]
  if (!Number.isFinite(close) || !Number.isFinite(longTrend) || !Number.isFinite(atrNow) || close <= 0) {
    return "unknown"
  }
  const ratios = candles.slice(Math.max(0, index - 99), index + 1)
    .map((candle, offset) => {
      const absoluteIndex = Math.max(0, index - 99) + offset
      const value = indicators.atr14[absoluteIndex] / candle.close
      return Number.isFinite(value) ? value : null
    })
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)
  const median = ratios[Math.floor(ratios.length / 2)] ?? atrNow / close
  return `${close >= longTrend ? "bull" : "bear"}_${atrNow / close >= median ? "high_vol" : "low_vol"}`
}

function buildRobustnessProof(trades: ReplayTrade[]): JSONRecord {
  const groups = new Map<string, ReplayTrade[]>()
  for (const trade of trades) {
    const list = groups.get(trade.regime) || []
    list.push(trade)
    groups.set(trade.regime, list)
  }
  const regimeSlices = Array.from(groups.entries())
    .filter(([regime, items]) => regime !== "unknown" && items.length >= 5)
    .map(([regime, items]) => ({ regime, ...summarizeTrades(items) }))
  const stressed = trades.map((trade) => {
    const risk = Math.abs(trade.entry - trade.stop)
    const extraCostR = risk > 0 ? ((Math.abs(trade.entry) + Math.abs(trade.exit)) * 5 / 10000) / risk : 0
    return { ...trade, r: round(trade.r - extraCostR) }
  })
  return {
    regime_slices: regimeSlices,
    cost_stress: { extra_bps_per_side: 5, stats: summarizeTrades(stressed) },
  }
}

function buildReplayParameterStability(strategy: ReplayStrategy, options: ReplayOptions): JSONRecord {
  const base = {
    maxHoldBars: options.maxHoldBars ?? 18,
    rewardRisk: options.rewardRisk ?? 2,
  }
  const variants: Array<{ parameter: string; multiplier: number; options: ReplayOptions }> = []
  for (const multiplier of [0.9, 1.1]) {
    variants.push({
      parameter: "maxHoldBars",
      multiplier,
      options: { ...options, maxHoldBars: Math.max(1, Math.round(base.maxHoldBars * multiplier)) },
    })
    variants.push({
      parameter: "rewardRisk",
      multiplier,
      options: { ...options, rewardRisk: Number((base.rewardRisk * multiplier).toFixed(6)) },
    })
  }
  const seen = new Set<string>()
  const results = variants
    .filter((variant) => {
      const key = hashCanonical({ parameter: variant.parameter, maxHoldBars: variant.options.maxHoldBars, rewardRisk: variant.options.rewardRisk })
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((variant) => {
      const replay = replayStrategy(strategy, {
        ...variant.options,
        skipParameterStability: true,
      })
      return {
        parameter: variant.parameter,
        multiplier: variant.multiplier,
        avg_r: replay.avg_r,
        total_r: replay.total_r,
      }
    })
  const positive = results.filter((item) => item.avg_r > 0 && item.total_r > 0)
  return {
    method: "fixed_plus_minus_10pct",
    evaluation_count: results.length,
    positive_ratio: results.length > 0 ? round(positive.length / results.length) : 0,
    worst_avg_r: results.length > 0 ? round(Math.min(...results.map((item) => item.avg_r))) : 0,
    results,
  }
}

function buildReplayProvenance(manifestPath: string, timeframe: string, assumptions: JSONRecord, supplementalDataRefs: string[] = []): ReplayProvenance {
  const manifest = loadManifest(manifestPath)
  const item = asRecord(asRecord(manifest.timeframes)[timeframe])
  const declaredChecksum = stringField(item.content_sha256)
  const supplementalData = [...new Set(supplementalDataRefs)].sort().map((ref) => ({
    ref,
    content_sha256: hashFile(ref),
  }))
  const actualDataHash = replayDataHash(manifestPath, timeframe, supplementalData.map((item) => item.ref))
  const contentHash = replayContentHash(manifestPath, timeframe)
  return {
    harness_hash: replayHarnessHash(),
    data_hash: actualDataHash,
    assumptions_hash: hashCanonical(assumptions),
    data_ref: manifestPath,
    timeframe,
    data_schema_version: Number(manifest.schema_version) || 0,
    closed_candles_only: manifest.closed_candles_only === true,
    manifest_checksum_verified: Boolean(declaredChecksum && declaredChecksum === contentHash),
    ...(supplementalData.length > 0 ? { supplemental_data: supplementalData } : {}),
  }
}

function replayDataHash(manifestPath: string, timeframe: string, supplementalDataRefs: string[] = []): string {
  const manifest = loadManifest(manifestPath)
  const item = asRecord(asRecord(manifest.timeframes)[timeframe])
  const file = stringField(item.file)
  if (!file) {
    throw new Error(`manifest missing timeframe ${timeframe}`)
  }
  const identity = {
    schema_version: Number(manifest.schema_version) || 0,
    source: asRecord(manifest.source),
    closed_candles_only: manifest.closed_candles_only === true,
    symbol: stringField(manifest.symbol) || stringField(manifest.requested_symbol),
    exchange: stringField(manifest.exchange) || stringField(manifest.requested_exchange),
    timeframe,
    columns: Array.isArray(manifest.columns) ? manifest.columns : [],
  }
  const contentHash = replayContentHash(manifestPath, timeframe)
  const declaredChecksum = stringField(item.content_sha256)
  if (declaredChecksum && declaredChecksum !== contentHash) {
    throw new Error(`manifest checksum mismatch for ${timeframe}`)
  }
  const marketDataHash = createHash("sha256").update(stableJson(identity)).update("\n").update(contentHash).digest("hex")
  const supplementalData = [...new Set(supplementalDataRefs)].sort().map((ref) => ({ ref, content_sha256: hashFile(ref) }))
  return hashCanonical({ market_data_hash: marketDataHash, supplemental_data: supplementalData })
}

function replayContentHash(manifestPath: string, timeframe: string): string {
  const manifest = loadManifest(manifestPath)
  const item = asRecord(asRecord(manifest.timeframes)[timeframe])
  const file = stringField(item.file)
  if (!file) throw new Error(`manifest missing timeframe ${timeframe}`)
  return createHash("sha256").update(readFileSync(join(dirname(manifestPath), file))).digest("hex")
}

function replayHarnessHash(): string {
  const root = import.meta.dir
  const files = [
    join(root, "replay-core.ts"),
    join(root, "replay-strategies.ts"),
    join(root, "strategy-replay.ts"),
    join(root, "strategy-rnd.ts"),
    join(root, "factor-engine.ts"),
    join(root, "factor-research.ts"),
    join(root, "rnd-family.ts"),
    join(root, "rnd-family-helpers.ts"),
    ...sourceFiles(join(root, "rnd-families")),
  ].filter((path) => statOrNull(path)?.isFile())
  const hash = createHash("sha256")
  for (const path of files.sort()) {
    hash.update(path.slice(root.length))
    hash.update("\n")
    hash.update(readFileSync(path))
    hash.update("\n")
  }
  return hash.digest("hex")
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function sourceFiles(path: string): string[] {
  if (!statOrNull(path)?.isDirectory()) {
    return []
  }
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    return entry.isDirectory() ? sourceFiles(child) : entry.name.endsWith(".ts") ? [child] : []
  })
}

function statOrNull(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JSONRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function summarizeTrades(trades: ReplayTrade[]): {
  sample_count: number
  win_rate: number
  avg_r: number
  total_r: number
  max_drawdown_r: number
  profit_factor: number
} {
  const wins = trades.filter((trade) => trade.r > 0)
  const gains = wins.reduce((sum, trade) => sum + trade.r, 0)
  const losses = Math.abs(trades.filter((trade) => trade.r < 0).reduce((sum, trade) => sum + trade.r, 0))
  const total = trades.reduce((sum, trade) => sum + trade.r, 0)
  return {
    sample_count: trades.length,
    win_rate: trades.length > 0 ? round(wins.length / trades.length) : 0,
    avg_r: trades.length > 0 ? round(total / trades.length) : 0,
    total_r: round(total),
    max_drawdown_r: round(maxDrawdown(trades.map((trade) => trade.r))),
    profit_factor: losses > 0 ? round(gains / losses) : gains > 0 ? 999999 : 0,
  }
}

function evaluateReplayGate(stats: {
  sample_count: number
  avg_r: number
  total_r: number
  max_drawdown_r: number
  profit_factor: number
}): ReplayResult["gate"] {
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  if (stats.sample_count < 30) {
    blockedBy.push({ check_id: "R-SAMPLE-SIZE", reason: `sample_count ${stats.sample_count} is below 30` })
  }
  if (stats.total_r <= 0 || stats.avg_r <= 0) {
    blockedBy.push({ check_id: "R-EXPECTANCY", reason: `avg_r ${stats.avg_r} / total_r ${stats.total_r} is not positive` })
  }
  if (stats.profit_factor < 1.1) {
    blockedBy.push({ check_id: "R-PROFIT-FACTOR", reason: `profit_factor ${stats.profit_factor} is below 1.1` })
  }
  if (stats.max_drawdown_r > 10) {
    blockedBy.push({ check_id: "R-DRAWDOWN", reason: `max_drawdown_r ${stats.max_drawdown_r} exceeds 10R` })
  }
  return {
    shadow_candidate: blockedBy.length === 0,
    live_small_candidate: false,
    blocked_by: blockedBy,
  }
}

function ema(values: number[], length: number): number[] {
  const output = Array(values.length).fill(Number.NaN) as number[]
  const alpha = 2 / (length + 1)
  let previous = 0
  for (let index = 0; index < values.length; index += 1) {
    if (index < length - 1) {
      continue
    }
    if (index === length - 1) {
      previous = values.slice(0, length).reduce((sum, value) => sum + value, 0) / length
    } else {
      previous = values[index] * alpha + previous * (1 - alpha)
    }
    output[index] = previous
  }
  return output
}

function atr(candles: Candle[], length: number): number[] {
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) {
      return candle.high - candle.low
    }
    const prevClose = candles[index - 1].close
    return Math.max(candle.high - candle.low, Math.abs(candle.high - prevClose), Math.abs(candle.low - prevClose))
  })
  return ema(trueRanges, length)
}

function maxDrawdown(values: number[]): number {
  let equity = 0
  let peak = 0
  let drawdown = 0
  for (const value of values) {
    equity += value
    peak = Math.max(peak, equity)
    drawdown = Math.max(drawdown, peak - equity)
  }
  return drawdown
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

export {
  atr,
  buildIndicators,
  ema,
  evaluateLatestSignal,
  loadCandlesFromManifest,
  parseCsvCandles,
  replayStrategy,
  replayDataHash,
  replayContentHash,
  replayHarnessHash,
  hashCanonical,
  summarizeReplay,
  summarizeTrades,
  evaluateReplayGate,
  type Candle,
  type IndicatorSet,
  type LatestSignalResult,
  type ReplayOptions,
  type ReplayResult,
  type ReplayProvenance,
  type ReplaySignal,
  type ReplayStrategy,
  type ReplayTrade,
}
