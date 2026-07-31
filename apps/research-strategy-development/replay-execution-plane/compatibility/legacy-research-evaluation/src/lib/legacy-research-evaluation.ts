type JSONRecord = Record<string, unknown>

interface LegacyReplayEvaluationTrade {
  r: number
  signal_time: string
  exit_time: string
  entry: number
  exit: number
  stop: number
  regime: string
  r_multiple_initial?: number
  r_multiple_max_live_risk?: number
}

interface LegacyReplayEvaluationOptions {
  oosSplitRatio?: number
  trialCount?: number
  parameterCount?: number
  antiOverfitStage?: "selection_validation" | "external_validation" | "locked_holdout"
}

interface LegacyReplayStats {
  sample_count: number
  win_rate: number
  avg_r: number
  total_r: number
  max_drawdown_r: number
  profit_factor: number
}

interface LegacyReplayGate {
  shadow_candidate: boolean
  live_small_candidate: false
  blocked_by: Array<{ check_id: string; reason: string }>
}

function buildReplayDiagnostics(trades: LegacyReplayEvaluationTrade[]): JSONRecord {
  const rValues = trades.map((trade) => trade.r)
  return {
    schema_version: "trade-flow.replay-diagnostics.v1",
    promotion_effect: "diagnostic_only_cannot_authorize",
    metrics: {
      sample_count: trades.length,
      r_multiple_initial: summarizeRValues(trades.map((trade) => trade.r_multiple_initial ?? trade.r)),
      r_multiple_max_live_risk: summarizeRValues(trades.map((trade) => trade.r_multiple_max_live_risk ?? trade.r)),
    },
    monte_carlo: {
      method: "deterministic_trade_order_shuffle_and_r_perturbation_v1",
      trade_order_shuffle: tradeOrderShuffleDiagnostics(rValues),
      candle_perturbation: candlePerturbationDiagnostics(rValues),
    },
  }
}

function buildAntiOverfitProof(
  trades: LegacyReplayEvaluationTrade[],
  options: LegacyReplayEvaluationOptions,
): JSONRecord | null {
  if (trades.length === 0) return null
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
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return null
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
  return {
    method: "out_of_sample",
    stage: "selection_validation",
    train_stats: summarizeTrades(train),
    oos_stats: summarizeTrades(trades.slice(splitIndex)),
    purged_overlap_count: splitIndex - train.length,
    trial_count: options.trialCount ?? 1,
    parameter_count: options.parameterCount ?? 0,
    notes: `Selection validation uses the last ${roundMetric(ratio * 100)}% of chronological replay trades and purges training labels crossing the OOS boundary; it is not a locked final holdout.`,
  }
}

function buildRobustnessProof(trades: LegacyReplayEvaluationTrade[]): JSONRecord {
  const groups = new Map<string, LegacyReplayEvaluationTrade[]>()
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
    return { ...trade, r: roundMetric(trade.r - extraCostR) }
  })
  return {
    regime_slices: regimeSlices,
    cost_stress: { extra_bps_per_side: 5, stats: summarizeTrades(stressed) },
  }
}

function summarizeTrades(trades: Array<Pick<LegacyReplayEvaluationTrade, "r">>): LegacyReplayStats {
  const wins = trades.filter((trade) => trade.r > 0)
  const gains = wins.reduce((sum, trade) => sum + trade.r, 0)
  const losses = Math.abs(trades.filter((trade) => trade.r < 0).reduce((sum, trade) => sum + trade.r, 0))
  const total = trades.reduce((sum, trade) => sum + trade.r, 0)
  return {
    sample_count: trades.length,
    win_rate: trades.length > 0 ? roundMetric(wins.length / trades.length) : 0,
    avg_r: trades.length > 0 ? roundMetric(total / trades.length) : 0,
    total_r: roundMetric(total),
    max_drawdown_r: roundMetric(maxDrawdown(trades.map((trade) => trade.r))),
    profit_factor: losses > 0 ? roundMetric(gains / losses) : gains > 0 ? 999999 : 0,
  }
}

function evaluateReplayGate(stats: Pick<LegacyReplayStats, "sample_count" | "avg_r" | "total_r" | "max_drawdown_r" | "profit_factor">): LegacyReplayGate {
  const blockedBy: LegacyReplayGate["blocked_by"] = []
  if (stats.sample_count < 30) blockedBy.push({ check_id: "R-SAMPLE-SIZE", reason: `sample_count ${stats.sample_count} is below 30` })
  if (stats.total_r <= 0 || stats.avg_r <= 0) blockedBy.push({ check_id: "R-EXPECTANCY", reason: `avg_r ${stats.avg_r} / total_r ${stats.total_r} is not positive` })
  if (stats.profit_factor < 1.1) blockedBy.push({ check_id: "R-PROFIT-FACTOR", reason: `profit_factor ${stats.profit_factor} is below 1.1` })
  if (stats.max_drawdown_r > 10) blockedBy.push({ check_id: "R-DRAWDOWN", reason: `max_drawdown_r ${stats.max_drawdown_r} exceeds 10R` })
  return { shadow_candidate: blockedBy.length === 0, live_small_candidate: false, blocked_by: blockedBy }
}

function summarizeRValues(values: number[]): JSONRecord {
  const finite = values.filter(Number.isFinite)
  const total = finite.reduce((sum, value) => sum + value, 0)
  return {
    sample_count: finite.length,
    avg_r: finite.length > 0 ? roundMetric(total / finite.length) : 0,
    total_r: roundMetric(total),
    max_drawdown_r: roundMetric(maxDrawdown(finite)),
    p10_r: finite.length > 0 ? roundMetric(quantile([...finite].sort((a, b) => a - b), 0.1)) : 0,
  }
}

function tradeOrderShuffleDiagnostics(values: number[]): JSONRecord {
  if (values.length === 0) return { status: "empty", trial_count: 0 }
  const trials = [values, [...values].reverse(), rotate(values, Math.max(1, Math.floor(values.length / 3))), rotate(values, Math.max(1, Math.floor(values.length / 2)))]
  const drawdowns = trials.map((trial) => maxDrawdown(trial))
  return {
    status: "evaluated",
    trial_count: trials.length,
    observed_max_drawdown_r: roundMetric(maxDrawdown(values)),
    worst_shuffle_drawdown_r: roundMetric(Math.max(...drawdowns)),
    p75_shuffle_drawdown_r: roundMetric(quantile([...drawdowns].sort((a, b) => a - b), 0.75)),
  }
}

function candlePerturbationDiagnostics(values: number[]): JSONRecord {
  if (values.length === 0) return { status: "empty", trial_count: 0 }
  const variants = [0.05, 0.1, 0.15].map((drag) => values.map((value) => roundMetric(value - drag)))
  const stats = variants.map(summarizeRValues)
  return {
    status: "evaluated",
    method: "adverse_r_drag_proxy",
    trial_count: variants.length,
    worst_total_r: roundMetric(Math.min(...stats.map((item) => Number(item.total_r)))),
    worst_avg_r: roundMetric(Math.min(...stats.map((item) => Number(item.avg_r)))),
  }
}

function rotate(values: number[], offset: number): number[] {
  const normalized = values.length > 0 ? offset % values.length : 0
  return values.slice(normalized).concat(values.slice(0, normalized))
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
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

function roundMetric(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

export {
  buildAntiOverfitProof,
  buildReplayDiagnostics,
  buildRobustnessProof,
  evaluateReplayGate,
  summarizeTrades,
  type LegacyReplayEvaluationOptions,
  type LegacyReplayEvaluationTrade,
  type LegacyReplayGate,
  type LegacyReplayStats,
}
