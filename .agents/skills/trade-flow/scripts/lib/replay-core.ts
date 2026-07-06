import { readFileSync } from "node:fs"
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
  stop: number
  target: number
  r: number
  outcome: ExitReason
  reason: string
  bars_held: number
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
  notes: string[]
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
    trades.push(trade)
    const exitIndex = candles.findIndex((candle) => candle.timestamp === Date.parse(trade.exit_time))
    index = Math.max(signal.entry_index + 1, exitIndex + 1)
  }

  return summarizeReplay({
    strategy_id: strategy.strategy_id,
    symbol: stringField(manifest.symbol) || stringField(manifest.requested_symbol) || "UNKNOWN",
    timeframe,
    trades,
    assumptions: {
      max_hold_bars: maxHoldBars,
      reward_risk: options.rewardRisk ?? 2,
      fee_bps: options.feeBps ?? 0,
      slippage_bps: options.slippageBps ?? 0,
      same_candle_policy: "stop_first",
      overlapping_positions: false,
    },
  })
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
    stop: round(signal.stop),
    target: round(signal.target),
    r: round(grossR - costR),
    outcome,
    reason: signal.reason,
    bars_held: barsHeld,
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
  const wins = input.trades.filter((trade) => trade.r > 0)
  const gains = input.trades.filter((trade) => trade.r > 0).reduce((sum, trade) => sum + trade.r, 0)
  const losses = Math.abs(input.trades.filter((trade) => trade.r < 0).reduce((sum, trade) => sum + trade.r, 0))
  const total = input.trades.reduce((sum, trade) => sum + trade.r, 0)
  const stats = {
    sample_count: input.trades.length,
    win_rate: input.trades.length > 0 ? round(wins.length / input.trades.length) : 0,
    avg_r: input.trades.length > 0 ? round(total / input.trades.length) : 0,
    total_r: round(total),
    max_drawdown_r: round(maxDrawdown(input.trades.map((trade) => trade.r))),
    profit_factor: losses > 0 ? round(gains / losses) : gains > 0 ? Number.POSITIVE_INFINITY : 0,
  }
  return {
    strategy_id: input.strategy_id,
    symbol: input.symbol,
    timeframe: input.timeframe,
    ...stats,
    expectancy_r: stats.avg_r,
    gate: evaluateReplayGate(stats),
    trades: input.trades,
    assumptions: input.assumptions,
    notes: [
      "Replay is mechanical and conservative: if stop and target hit in the same candle, stop wins.",
      "Replay enforces one active position per strategy lane.",
      "This is evidence for draft/shadow gating, not permission for live-small by itself.",
    ],
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
  summarizeReplay,
  evaluateReplayGate,
  type Candle,
  type IndicatorSet,
  type ReplayOptions,
  type ReplayResult,
  type ReplaySignal,
  type ReplayStrategy,
  type ReplayTrade,
}
