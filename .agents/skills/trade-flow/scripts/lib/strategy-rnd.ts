import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  replayStrategy,
  type Candle,
  type IndicatorSet,
  type ReplayResult,
  type ReplaySignal,
  type ReplayStrategy,
} from "./replay-core"

type JSONRecord = Record<string, unknown>
type SideFilter = "long" | "short" | "both"
type IndicatorFilterOp = "gt" | "lt" | "between"

interface StrategyRndBatchInput {
  batchId?: string
  hypothesis?: string
  manifestPath: string
  timeframe?: string
  maxHoldBars?: number
  feeBps?: number
  slippageBps?: number
  oosSplitRatio?: number
  indicatorReportPath?: string
  autoCandidates?: boolean
  candidates: StrategyRndCandidateInput[]
}

interface StrategyRndLoopInput extends StrategyRndBatchInput {
  runId?: string
  artifactRoot?: string
  ledgerPath?: string
  now?: string
}

interface StrategyRndCandidateInput {
  candidateId: string
  description?: string
  family?: "trend_pullback_v1"
  parameterCount?: number
  params?: JSONRecord
}

interface StrategyRndBatchReport {
  batch_id: string
  hypothesis: string
  trial_count: number
  accepted_count: number
  candidate_source: "provided" | "auto_indicator_synthesis"
  outcome: "candidate_found" | "no_promote"
  winner: StrategyRndCandidateReport | null
  candidates: StrategyRndCandidateReport[]
  guardrails: {
    max_trials: 10
    max_parameter_count: 8
    oos_required: true
    no_auto_promote: true
  }
  indicator_research: StrategyIndicatorResearch | null
  next_action: string
}

interface StrategyRndLoopReport {
  run_id: string
  created_at: string
  artifact_ref: string
  ledger_ref: string
  batch: StrategyRndBatchReport
  ledger_record: StrategyRndLedgerRecord
  stop_reason: "candidate_found" | "no_promote"
}

interface StrategyRndLedgerRecord {
  run_id: string
  created_at: string
  batch_id: string
  hypothesis: string
  manifest_ref: string
  indicator_report_ref: string
  artifact_ref: string
  candidate_source: "provided" | "auto_indicator_synthesis"
  outcome: "candidate_found" | "no_promote"
  trial_count: number
  accepted_count: number
  winner_candidate_id: string | null
  rejected_reasons: Array<{
    check_id: string
    count: number
  }>
}

interface StrategyIndicatorResearch {
  source_ref: string
  selected_indicators: Array<{
    indicator_id: string
    category: string
    defaults: JSONRecord
    observe: string
    proposed_use: string
  }>
  structure_edges: Array<{
    timeframe: string
    feature_id: string
    respect_rate: number
    break_rate: number
    sample_count: number
    proposed_use: string
  }>
}

interface StrategyRndCandidateReport {
  candidate_id: string
  description: string
  family: string
  parameter_count: number
  params: JSONRecord
  replay: ReplayResult
  gate: {
    accepted: boolean
    blocked_by: Array<{ check_id: string; reason: string }>
  }
}

interface TrendPullbackParams {
  side: SideFilter
  fastEma: 20 | 50
  slowEma: 50 | 200
  pullbackAtr: number
  stopAtr: number
  maxRiskAtr: number
  rewardRisk: number
  slopeLookback: number
  requireEmaStack: boolean
  indicatorFilters: IndicatorFilter[]
}

interface IndicatorFilter {
  indicatorId: string
  timeframe?: string
  op: IndicatorFilterOp
  value?: number
  min?: number
  max?: number
}

interface IndicatorFeatureStore {
  read(timeframe: string, indicatorId: string, timestamp: string): number | undefined
}

function runStrategyRndBatch(input: StrategyRndBatchInput): StrategyRndBatchReport {
  if (!input.manifestPath) {
    throw new Error("strategy R&D batch requires manifestPath")
  }
  const indicatorResearch = input.indicatorReportPath ? loadIndicatorResearch(input.indicatorReportPath) : null
  const candidates = input.candidates.length > 0
    ? input.candidates
    : input.autoCandidates && indicatorResearch
      ? synthesizeIndicatorCandidates(indicatorResearch)
      : []
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("strategy R&D batch requires at least one candidate")
  }
  if (candidates.length > 10) {
    throw new Error(`strategy R&D batch trial_count ${candidates.length} exceeds 10`)
  }

  const featureStore = input.indicatorReportPath ? loadIndicatorFeatureStore(input.indicatorReportPath) : emptyFeatureStore()
  const batch = { ...input, candidates }
  const reports = candidates.map((candidate) => runCandidate(batch, candidate, featureStore))
  const accepted = reports.filter((report) => report.gate.accepted)
  const winner = accepted.sort(compareCandidates)[0] ?? null

  return {
    batch_id: input.batchId || "strategy-rnd-batch",
    hypothesis: input.hypothesis || "",
    trial_count: candidates.length,
    accepted_count: accepted.length,
    candidate_source: input.candidates.length > 0 ? "provided" : "auto_indicator_synthesis",
    outcome: winner ? "candidate_found" : "no_promote",
    winner,
    candidates: reports,
    guardrails: {
      max_trials: 10,
      max_parameter_count: 8,
      oos_required: true,
      no_auto_promote: true,
    },
    indicator_research: indicatorResearch,
    next_action: winner
      ? "Draft a strategy policy for the winning candidate, then append replay evidence and run strategy-review before any shadow promotion."
      : "Stop this hypothesis batch; predeclare a new edge hypothesis before running more trials.",
  }
}

function runStrategyRndLoop(input: StrategyRndLoopInput): StrategyRndLoopReport {
  const createdAt = input.now || new Date().toISOString()
  const runId = input.runId || `rnd-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`
  const artifactRoot = input.artifactRoot || "./data/artifacts/strategy-rnd"
  const ledgerPath = input.ledgerPath || "./data/strategy-rnd-ledger.jsonl"
  const artifactRef = join(artifactRoot, `${safeFileName(runId)}.json`)
  const batch = runStrategyRndBatch(input)
  const ledgerRecord = buildRndLedgerRecord({
    input,
    runId,
    createdAt,
    artifactRef,
    batch,
  })

  writeJsonFile(artifactRef, {
    run_id: runId,
    created_at: createdAt,
    input: redactLoopInputForArtifact(input),
    batch,
    ledger_record: ledgerRecord,
    stop_reason: batch.outcome,
  })
  appendJsonLine(ledgerPath, ledgerRecord)

  return {
    run_id: runId,
    created_at: createdAt,
    artifact_ref: artifactRef,
    ledger_ref: ledgerPath,
    batch,
    ledger_record: ledgerRecord,
    stop_reason: batch.outcome,
  }
}

function buildRndLedgerRecord(input: {
  input: StrategyRndLoopInput
  runId: string
  createdAt: string
  artifactRef: string
  batch: StrategyRndBatchReport
}): StrategyRndLedgerRecord {
  return {
    run_id: input.runId,
    created_at: input.createdAt,
    batch_id: input.batch.batch_id,
    hypothesis: input.batch.hypothesis,
    manifest_ref: input.input.manifestPath,
    indicator_report_ref: input.input.indicatorReportPath || "",
    artifact_ref: input.artifactRef,
    candidate_source: input.batch.candidate_source,
    outcome: input.batch.outcome,
    trial_count: input.batch.trial_count,
    accepted_count: input.batch.accepted_count,
    winner_candidate_id: input.batch.winner?.candidate_id ?? null,
    rejected_reasons: summarizeRejectedReasons(input.batch),
  }
}

function summarizeRejectedReasons(batch: StrategyRndBatchReport): StrategyRndLedgerRecord["rejected_reasons"] {
  const counts = new Map<string, number>()
  for (const candidate of batch.candidates) {
    if (candidate.gate.accepted) {
      continue
    }
    for (const block of candidate.gate.blocked_by) {
      counts.set(block.check_id, (counts.get(block.check_id) || 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([check_id, count]) => ({ check_id, count }))
    .sort((a, b) => b.count - a.count || a.check_id.localeCompare(b.check_id))
}

function redactLoopInputForArtifact(input: StrategyRndLoopInput): JSONRecord {
  return {
    batchId: input.batchId,
    hypothesis: input.hypothesis,
    manifestPath: input.manifestPath,
    timeframe: input.timeframe,
    maxHoldBars: input.maxHoldBars,
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    oosSplitRatio: input.oosSplitRatio,
    indicatorReportPath: input.indicatorReportPath,
    autoCandidates: input.autoCandidates,
    candidates: input.candidates,
  }
}

function loadIndicatorResearch(path: string): StrategyIndicatorResearch {
  const report = asRecord(JSON.parse(readFileSync(path, "utf8")))
  const data = asRecord(report.data)
  const selected = asRecord(data.selected_indicators)
  return {
    source_ref: path,
    selected_indicators: Object.entries(selected).map(([indicatorId, raw]) => {
      const item = asRecord(raw)
      const category = stringField(item.category)
      return {
        indicator_id: indicatorId,
        category,
        defaults: asRecord(item.defaults),
        observe: stringField(item.observe),
        proposed_use: proposedIndicatorUse(category, stringField(item.observe)),
      }
    }),
    structure_edges: readStructureEdges(data),
  }
}

function readStructureEdges(data: JSONRecord): StrategyIndicatorResearch["structure_edges"] {
  const timeframes = asRecord(data.timeframes)
  const edges: StrategyIndicatorResearch["structure_edges"] = []
  for (const [timeframe, rawFrame] of Object.entries(timeframes)) {
    const frame = asRecord(rawFrame)
    const validation = asRecord(frame.structure_validation)
    for (const [featureId, rawStats] of Object.entries(validation)) {
      const stats = asRecord(rawStats)
      const sampleCount = Number(stats.sample_count)
      const respectRate = Number(stats.respect_rate)
      const breakRate = Number(stats.break_rate)
      if (!Number.isFinite(sampleCount) || sampleCount < 30 || !Number.isFinite(respectRate)) {
        continue
      }
      if (respectRate >= 0.9 || breakRate >= 0.1) {
        edges.push({
          timeframe,
          feature_id: featureId,
          respect_rate: round(respectRate),
          break_rate: Number.isFinite(breakRate) ? round(breakRate) : 0,
          sample_count: sampleCount,
          proposed_use: respectRate >= 0.9
            ? "use as structure-respect filter or invalidation reference; must replay before promotion"
            : "use as breakout/breakdown hypothesis seed; must replay before promotion",
        })
      }
    }
  }
  return edges.sort((a, b) => b.sample_count - a.sample_count || b.respect_rate - a.respect_rate).slice(0, 20)
}

function proposedIndicatorUse(category: string, observe: string): string {
  if (category === "trend" || category === "moving-average") {
    return `candidate trend/regime filter: ${observe}`
  }
  if (category === "momentum" || category === "timing") {
    return `candidate confirmation/timing filter: ${observe}`
  }
  if (category === "volume") {
    return `candidate participation/liquidity confirmation: ${observe}`
  }
  if (category === "level") {
    return `candidate location/invalidation feature: ${observe}`
  }
  return `candidate feature; must define exact rule and replay: ${observe}`
}

function runCandidate(input: StrategyRndBatchInput, candidate: StrategyRndCandidateInput, featureStore: IndicatorFeatureStore): StrategyRndCandidateReport {
  const family = candidate.family || "trend_pullback_v1"
  if (family !== "trend_pullback_v1") {
    throw new Error(`unsupported strategy R&D family: ${family}`)
  }
  const params = normalizeTrendPullbackParams(candidate.params || {})
  const parameterCount = candidate.parameterCount ?? countActiveParameters(candidate.params || {})
  const strategy = buildTrendPullbackCandidate(candidate.candidateId, params, featureStore)
  const replay = replayStrategy(strategy, {
    manifestPath: input.manifestPath,
    timeframe: input.timeframe,
    maxHoldBars: input.maxHoldBars,
    rewardRisk: params.rewardRisk,
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    oosSplitRatio: input.oosSplitRatio ?? 0.3,
    trialCount: input.candidates.length,
    parameterCount,
  })
  return {
    candidate_id: candidate.candidateId,
    description: candidate.description || "",
    family,
    parameter_count: parameterCount,
    params: trendPullbackParamsToJson(params),
    replay,
    gate: evaluateRndCandidate(replay, parameterCount),
  }
}

function synthesizeIndicatorCandidates(research: StrategyIndicatorResearch): StrategyRndCandidateInput[] {
  const candidates: StrategyRndCandidateInput[] = []
  for (const item of research.selected_indicators) {
    if (candidates.length >= 10) {
      break
    }
    if (item.category === "volume" && item.indicator_id === "vpci") {
      candidates.push(buildAutoCandidate("AUTO-LONG-VPCI-POS", "long trend pullback with positive VPCI", "long", [{
        indicator_id: item.indicator_id,
        op: "gt",
        value: 0,
      }]))
      candidates.push(buildAutoCandidate("AUTO-SHORT-VPCI-NEG", "short trend pullback with negative VPCI", "short", [{
        indicator_id: item.indicator_id,
        op: "lt",
        value: 0,
      }]))
      continue
    }
    if (item.category === "momentum" && item.indicator_id === "stc") {
      candidates.push(buildAutoCandidate("AUTO-LONG-STC-GT50", "long trend pullback with STC above 50", "long", [{
        indicator_id: item.indicator_id,
        op: "gt",
        value: 50,
      }]))
      candidates.push(buildAutoCandidate("AUTO-SHORT-STC-LT50", "short trend pullback with STC below 50", "short", [{
        indicator_id: item.indicator_id,
        op: "lt",
        value: 50,
      }]))
      continue
    }
    if (item.category === "momentum" && item.indicator_id === "laguerre") {
      candidates.push(buildAutoCandidate("AUTO-LONG-LAGUERRE-MID", "long trend pullback with Laguerre not overextended", "long", [{
        indicator_id: item.indicator_id,
        op: "between",
        min: 0.2,
        max: 0.85,
      }]))
      candidates.push(buildAutoCandidate("AUTO-SHORT-LAGUERRE-MID", "short trend pullback with Laguerre not washed out", "short", [{
        indicator_id: item.indicator_id,
        op: "between",
        min: 0.15,
        max: 0.8,
      }]))
    }
  }
  return candidates.slice(0, 10)
}

function buildAutoCandidate(id: string, description: string, side: "long" | "short", filters: JSONRecord[]): StrategyRndCandidateInput {
  return {
    candidateId: id,
    description,
    parameterCount: 8,
    params: {
      side,
      fast_ema: 50,
      slow_ema: 200,
      pullback_atr: 0.25,
      stop_atr: 0.5,
      max_risk_atr: 1.25,
      reward_risk: 2,
      require_ema_stack: true,
      indicator_filters: filters,
    },
  }
}

function buildTrendPullbackCandidate(strategyId: string, params: TrendPullbackParams, featureStore: IndicatorFeatureStore): ReplayStrategy {
  return {
    strategy_id: strategyId,
    default_timeframe: "4h",
    warmup_bars: Math.max(200, params.slopeLookback + 1),
    generateSignal({ candles, indicators, index, options }) {
      const candle = candles[index]
      const next = candles[index + 1]
      const fast = readEma(indicators, params.fastEma, index)
      const slow = readEma(indicators, params.slowEma, index)
      const currentAtr = indicators.atr14[index]
      if (!candle || !next || !Number.isFinite(fast) || !Number.isFinite(slow) || !Number.isFinite(currentAtr) || currentAtr <= 0) {
        return null
      }
      if (!passesIndicatorFilters(params.indicatorFilters, featureStore, options.timeframe || "4h", candle.date)) {
        return null
      }
      const side = readCandidateSide(candles, indicators, index, params)
      if (!side) {
        return null
      }
      return buildCandidateSignal({
        side,
        signal: candle,
        signalIndex: index,
        entryIndex: index + 1,
        entry: next.open,
        fast,
        currentAtr,
        params,
      })
    },
  }
}

function passesIndicatorFilters(filters: IndicatorFilter[], store: IndicatorFeatureStore, defaultTimeframe: string, timestamp: string): boolean {
  for (const filter of filters) {
    const value = store.read(filter.timeframe || defaultTimeframe, filter.indicatorId, timestamp)
    if (!Number.isFinite(value)) {
      return false
    }
    if (filter.op === "gt" && !(Number(value) > Number(filter.value))) {
      return false
    }
    if (filter.op === "lt" && !(Number(value) < Number(filter.value))) {
      return false
    }
    if (filter.op === "between" && !(Number(value) >= Number(filter.min) && Number(value) <= Number(filter.max))) {
      return false
    }
  }
  return true
}

function readCandidateSide(candles: Candle[], indicators: IndicatorSet, index: number, params: TrendPullbackParams): "long" | "short" | null {
  const candle = candles[index]
  const fast = readEma(indicators, params.fastEma, index)
  const slow = readEma(indicators, params.slowEma, index)
  const previousFast = params.slopeLookback > 0 ? readEma(indicators, params.fastEma, index - params.slopeLookback) : fast
  const longAllowed = params.side === "long" || params.side === "both"
  const shortAllowed = params.side === "short" || params.side === "both"
  const longTrend = candle.close > fast
    && (!params.requireEmaStack || fast > slow)
    && (!params.slopeLookback || fast > previousFast)
  const shortTrend = candle.close < fast
    && (!params.requireEmaStack || fast < slow)
    && (!params.slopeLookback || fast < previousFast)
  if (longAllowed && longTrend) {
    return "long"
  }
  if (shortAllowed && shortTrend) {
    return "short"
  }
  return null
}

function buildCandidateSignal(input: {
  side: "long" | "short"
  signal: Candle
  signalIndex: number
  entryIndex: number
  entry: number
  fast: number
  currentAtr: number
  params: TrendPullbackParams
}): ReplaySignal | null {
  if (input.side === "long") {
    const pulledBack = input.signal.low <= input.fast + input.params.pullbackAtr * input.currentAtr
    if (!pulledBack) {
      return null
    }
    const stop = Math.min(input.signal.low, input.fast) - input.params.stopAtr * input.currentAtr
    const risk = input.entry - stop
    if (risk <= 0 || risk > input.params.maxRiskAtr * input.currentAtr) {
      return null
    }
    return {
      side: "long",
      signal_index: input.signalIndex,
      entry_index: input.entryIndex,
      entry: input.entry,
      stop,
      target: input.entry + risk * input.params.rewardRisk,
      reason: "rnd trend pullback long",
      meta: trendPullbackParamsToJson(input.params),
    }
  }

  const pulledBack = input.signal.high >= input.fast - input.params.pullbackAtr * input.currentAtr
  if (!pulledBack) {
    return null
  }
  const stop = Math.max(input.signal.high, input.fast) + input.params.stopAtr * input.currentAtr
  const risk = stop - input.entry
  if (risk <= 0 || risk > input.params.maxRiskAtr * input.currentAtr) {
    return null
  }
  return {
    side: "short",
    signal_index: input.signalIndex,
    entry_index: input.entryIndex,
    entry: input.entry,
    stop,
    target: input.entry - risk * input.params.rewardRisk,
    reason: "rnd trend pullback short",
    meta: trendPullbackParamsToJson(input.params),
  }
}

function evaluateRndCandidate(replay: ReplayResult, parameterCount: number): StrategyRndCandidateReport["gate"] {
  const blockedBy = [...replay.gate.blocked_by]
  const proof = replay.assumptions.anti_overfit as { oos_stats?: { sample_count: number; avg_r: number; total_r: number; max_drawdown_r: number; profit_factor: number }; trial_count?: number; parameter_count?: number } | undefined
  if (!proof || !proof.oos_stats) {
    blockedBy.push({ check_id: "RND-OOS-MISSING", reason: "candidate replay must include OOS proof" })
  } else {
    if (proof.oos_stats.sample_count < 10) {
      blockedBy.push({ check_id: "RND-OOS-SAMPLE", reason: `oos sample_count ${proof.oos_stats.sample_count} is below 10` })
    }
    if (proof.oos_stats.avg_r <= 0 || proof.oos_stats.total_r <= 0) {
      blockedBy.push({ check_id: "RND-OOS-EXPECTANCY", reason: "OOS expectancy is not positive after costs" })
    }
    if (proof.oos_stats.profit_factor < 1.05) {
      blockedBy.push({ check_id: "RND-OOS-PROFIT-FACTOR", reason: `OOS profit_factor ${proof.oos_stats.profit_factor} is below 1.05` })
    }
    if (proof.oos_stats.max_drawdown_r > 10) {
      blockedBy.push({ check_id: "RND-OOS-DRAWDOWN", reason: `OOS max_drawdown_r ${proof.oos_stats.max_drawdown_r} exceeds 10R` })
    }
    if ((proof.trial_count ?? 1) > 10) {
      blockedBy.push({ check_id: "RND-SEARCH-BUDGET", reason: `trial_count ${proof.trial_count} exceeds 10` })
    }
    if ((proof.parameter_count ?? parameterCount) > 8) {
      blockedBy.push({ check_id: "RND-PARAM-COUNT", reason: `parameter_count ${proof.parameter_count ?? parameterCount} exceeds 8` })
    }
  }
  if (parameterCount > 8) {
    blockedBy.push({ check_id: "RND-PARAM-COUNT", reason: `parameter_count ${parameterCount} exceeds 8` })
  }
  return {
    accepted: blockedBy.length === 0,
    blocked_by: blockedBy,
  }
}

function normalizeTrendPullbackParams(raw: JSONRecord): TrendPullbackParams {
  return {
    side: readSide(raw.side),
    fastEma: readEmaLength(raw.fast_ema ?? raw.fastEma, 50, [20, 50]) as 20 | 50,
    slowEma: readEmaLength(raw.slow_ema ?? raw.slowEma, 200, [50, 200]) as 50 | 200,
    pullbackAtr: readPositiveNumber(raw.pullback_atr ?? raw.pullbackAtr, 0.25),
    stopAtr: readPositiveNumber(raw.stop_atr ?? raw.stopAtr, 0.5),
    maxRiskAtr: readPositiveNumber(raw.max_risk_atr ?? raw.maxRiskAtr, 1.25),
    rewardRisk: readPositiveNumber(raw.reward_risk ?? raw.rewardRisk, 2),
    slopeLookback: readNonNegativeInteger(raw.slope_lookback ?? raw.slopeLookback, 0),
    requireEmaStack: readBoolean(raw.require_ema_stack ?? raw.requireEmaStack, true),
    indicatorFilters: readIndicatorFilters(raw.indicator_filters ?? raw.indicatorFilters),
  }
}

function trendPullbackParamsToJson(params: TrendPullbackParams): JSONRecord {
  return {
    side: params.side,
    fastEma: params.fastEma,
    slowEma: params.slowEma,
    pullbackAtr: params.pullbackAtr,
    stopAtr: params.stopAtr,
    maxRiskAtr: params.maxRiskAtr,
    rewardRisk: params.rewardRisk,
    slopeLookback: params.slopeLookback,
    requireEmaStack: params.requireEmaStack,
    indicatorFilters: params.indicatorFilters.map((filter) => ({ ...filter })),
  }
}

function readIndicatorFilters(value: unknown): IndicatorFilter[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((raw) => {
    const item = asRecord(raw)
    const op = readIndicatorFilterOp(item.op)
    return {
      indicatorId: stringField(item.indicator_id ?? item.indicatorId),
      timeframe: stringField(item.timeframe) || undefined,
      op,
      value: optionalNumber(item.value),
      min: optionalNumber(item.min),
      max: optionalNumber(item.max),
    }
  }).filter((filter) => filter.indicatorId && isValidIndicatorFilter(filter))
}

function isValidIndicatorFilter(filter: IndicatorFilter): boolean {
  if (filter.op === "between") {
    return filter.min !== undefined && filter.max !== undefined
  }
  return filter.value !== undefined
}

function readIndicatorFilterOp(value: unknown): IndicatorFilterOp {
  if (value === "lt" || value === "between") {
    return value
  }
  return "gt"
}

function loadIndicatorFeatureStore(path: string): IndicatorFeatureStore {
  const report = asRecord(JSON.parse(readFileSync(path, "utf8")))
  const data = asRecord(report.data)
  const timeframes = asRecord(data.timeframes)
  const values = new Map<string, Map<string, number>>()
  for (const [timeframe, rawFrame] of Object.entries(timeframes)) {
    const frame = asRecord(rawFrame)
    const features = asRecord(frame.features)
    for (const [indicatorId, rawFeature] of Object.entries(features)) {
      const feature = asRecord(rawFeature)
      const points = Array.isArray(feature.values) ? feature.values : []
      const byTimestamp = new Map<string, number>()
      for (const rawPoint of points) {
        const point = asRecord(rawPoint)
        const timestamp = stringField(point.timestamp)
        const value = optionalNumber(point.value)
        if (timestamp && value !== undefined) {
          byTimestamp.set(timestamp, value)
        }
      }
      values.set(`${timeframe}:${indicatorId}`, byTimestamp)
    }
  }
  return {
    read(timeframe: string, indicatorId: string, timestamp: string): number | undefined {
      return values.get(`${timeframe}:${indicatorId}`)?.get(timestamp)
    },
  }
}

function emptyFeatureStore(): IndicatorFeatureStore {
  return {
    read() {
      return undefined
    },
  }
}

function readEma(indicators: IndicatorSet, length: 20 | 50 | 200, index: number): number {
  if (length === 20) {
    return indicators.ema20[index]
  }
  if (length === 50) {
    return indicators.ema50[index]
  }
  return indicators.ema200[index]
}

function compareCandidates(a: StrategyRndCandidateReport, b: StrategyRndCandidateReport): number {
  const aOos = (a.replay.assumptions.anti_overfit as { oos_stats?: { total_r?: number; avg_r?: number } } | undefined)?.oos_stats
  const bOos = (b.replay.assumptions.anti_overfit as { oos_stats?: { total_r?: number; avg_r?: number } } | undefined)?.oos_stats
  return (bOos?.total_r ?? b.replay.total_r) - (aOos?.total_r ?? a.replay.total_r)
    || (bOos?.avg_r ?? b.replay.avg_r) - (aOos?.avg_r ?? a.replay.avg_r)
}

function countActiveParameters(params: JSONRecord): number {
  return Object.values(params).reduce<number>((count, value) => {
    if (Array.isArray(value)) {
      return count + value.length
    }
    return value !== undefined && value !== null && value !== "" ? count + 1 : count
  }, 0)
}

function readSide(value: unknown): SideFilter {
  if (value === "long" || value === "short" || value === "both") {
    return value
  }
  return "both"
}

function readEmaLength(value: unknown, fallback: number, allowed: number[]): number {
  const number = Number(value)
  return allowed.includes(number) ? number : fallback
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function readNonNegativeInteger(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : fallback
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value
  }
  return fallback
}

function strategyRndBatchInputFromJson(input: JSONRecord): StrategyRndBatchInput {
  return {
    batchId: stringField(input.batch_id ?? input.batchId) || undefined,
    hypothesis: stringField(input.hypothesis) || undefined,
    manifestPath: stringField(input.manifest_path ?? input.manifestPath),
    timeframe: stringField(input.timeframe) || undefined,
    maxHoldBars: optionalNumber(input.max_hold_bars ?? input.maxHoldBars),
    feeBps: optionalNumber(input.fee_bps ?? input.feeBps),
    slippageBps: optionalNumber(input.slippage_bps ?? input.slippageBps),
    oosSplitRatio: optionalNumber(input.oos_split ?? input.oosSplitRatio),
    indicatorReportPath: stringField(input.indicator_report_path ?? input.indicatorReportPath) || undefined,
    autoCandidates: readBoolean(input.auto_candidates ?? input.autoCandidates, false),
    candidates: Array.isArray(input.candidates)
      ? input.candidates.map((candidate) => candidateFromJson(candidate as JSONRecord))
      : [],
  }
}

function strategyRndLoopInputFromJson(input: JSONRecord): StrategyRndLoopInput {
  return {
    ...strategyRndBatchInputFromJson(input),
    runId: stringField(input.run_id ?? input.runId) || undefined,
    artifactRoot: stringField(input.artifact_root ?? input.artifactRoot) || undefined,
    ledgerPath: stringField(input.ledger_path ?? input.ledgerPath) || undefined,
    now: stringField(input.now) || undefined,
  }
}

function candidateFromJson(input: JSONRecord): StrategyRndCandidateInput {
  return {
    candidateId: stringField(input.candidate_id ?? input.candidateId),
    description: stringField(input.description) || undefined,
    family: input.family === "trend_pullback_v1" ? "trend_pullback_v1" : undefined,
    parameterCount: optionalNumber(input.parameter_count ?? input.parameterCount),
    params: asRecord(input.params),
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function appendJsonLine(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value)}\n`, { flag: "a" })
}

export {
  runStrategyRndBatch,
  runStrategyRndLoop,
  strategyRndBatchInputFromJson,
  strategyRndLoopInputFromJson,
  type StrategyRndBatchInput,
  type StrategyRndBatchReport,
  type StrategyRndLoopInput,
  type StrategyRndLoopReport,
}
