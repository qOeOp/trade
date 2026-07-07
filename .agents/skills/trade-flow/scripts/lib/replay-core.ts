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
  oosSplitRatio?: number
  trialCount?: number
  parameterCount?: number
  antiOverfitStage?: "selection_validation" | "locked_holdout"
  supplementalDataRefs?: string[]
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

function replayStrategy(strategy: ReplayStrategy, options: ReplayOptions): ReplayResult {
  const timeframe = options.timeframe || strategy.default_timeframe
  const maxHoldBars = options.maxHoldBars ?? 18
  const manifest = loadManifest(options.manifestPath)
  const candles = loadCandlesFromManifest(options.manifestPath, manifest, timeframe)
  const indicators = buildIndicators(candles)
  const trades: ReplayTrade[] = []
  let index = Math.max(strategy.warmup_bars, 1)

  while (index < candles.length - 2) {
    const signal = strategy.generateSignal({
      candles,
      indicators,
      index,
      options,
    })
    if (!signal) {
      index += 1
      continue
    }
    const trade = resolveTrade(candles, signal, maxHoldBars, options)
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
    same_candle_policy: "stop_first",
    overlapping_positions: false,
  }
  const antiOverfit = buildAntiOverfitProof(trades, options)
  if (antiOverfit) {
    assumptions.anti_overfit = antiOverfit
  }
  assumptions.robustness = buildRobustnessProof(trades)

  const result = summarizeReplay({
    strategy_id: strategy.strategy_id,
    symbol: stringField(manifest.symbol) || stringField(manifest.requested_symbol) || "UNKNOWN",
    timeframe,
    trades,
    assumptions,
  })
  result.provenance = buildReplayProvenance(options.manifestPath, timeframe, assumptions, options.supplementalDataRefs)
  return result
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
      ? signal.stop
      : exitCandle.close
  const grossR = signal.side === "long"
    ? (exit - signal.entry) / risk
    : (signal.entry - exit) / risk
  const costR = estimateCostR(signal.entry, exit, risk, options)
  return {
    side: signal.side,
    signal_time: signalCandle.date,
    entry_time: entryCandle.date,
    exit_time: exitCandle.date,
    entry: round(signal.entry),
    exit: round(exit),
    stop: round(signal.stop),
    target: round(signal.target),
    r: round(grossR - costR),
    outcome,
    reason: signal.reason,
    bars_held: barsHeld,
    regime: "unknown",
    ...(signal.meta ? { meta: signal.meta } : {}),
  }
}

function estimateCostR(entry: number, exit: number, risk: number, options: ReplayOptions): number {
  const feeBps = options.feeBps ?? 0
  const slippageBps = options.slippageBps ?? 0
  if (risk <= 0 || (feeBps <= 0 && slippageBps <= 0)) {
    return 0
  }
  const cost = ((Math.abs(entry) + Math.abs(exit)) * (feeBps + slippageBps)) / 10000
  return cost / risk
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
  if (options.antiOverfitStage === "locked_holdout") {
    return {
      method: "out_of_sample",
      stage: "locked_holdout",
      oos_stats: summarizeTrades(trades),
      trial_count: options.trialCount ?? 1,
      parameter_count: options.parameterCount ?? 0,
      notes: "The frozen candidate is evaluated on the complete locked holdout; no holdout segment is reused for selection.",
    }
  }
  const ratio = options.oosSplitRatio ?? 0
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    return null
  }
  const splitIndex = Math.max(1, Math.min(trades.length - 1, Math.floor(trades.length * (1 - ratio))))
  return {
    method: "out_of_sample",
    stage: "selection_validation",
    train_stats: summarizeTrades(trades.slice(0, splitIndex)),
    oos_stats: summarizeTrades(trades.slice(splitIndex)),
    trial_count: options.trialCount ?? 1,
    parameter_count: options.parameterCount ?? 0,
    notes: `Selection validation uses the last ${round(ratio * 100)}% of chronological replay trades; it is not a locked final holdout.`,
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
    profit_factor: losses > 0 ? round(gains / losses) : gains > 0 ? Number.POSITIVE_INFINITY : 0,
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
  type ReplayOptions,
  type ReplayResult,
  type ReplayProvenance,
  type ReplaySignal,
  type ReplayStrategy,
  type ReplayTrade,
}
