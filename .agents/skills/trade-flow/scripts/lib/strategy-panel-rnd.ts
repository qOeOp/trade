import { runStrategyRndBatch, type StrategyRndCandidateInput } from "./strategy-rnd"

type JSONRecord = Record<string, unknown>

interface PanelDataset {
  datasetId: string
  manifestPath: string
  indicatorReportPath?: string
}

interface StrategyPanelRndInput {
  panelId?: string
  hypothesis?: string
  datasets: PanelDataset[]
  candidates: StrategyRndCandidateInput[]
  timeframe?: string
  maxHoldBars?: number
  feeBps?: number
  slippageBps?: number
  fundingBpsPer8h?: number
  oosSplitRatio?: number
}

function runStrategyPanelRnd(input: StrategyPanelRndInput): JSONRecord {
  if (input.datasets.length < 3) throw new Error("strategy panel R&D requires at least three datasets")
  if (input.candidates.length < 1 || input.candidates.length > 10) throw new Error("strategy panel R&D requires 1-10 candidates")
  const candidates = input.candidates.map((candidate) => {
    const assets = input.datasets.map((dataset) => {
      const report = runStrategyRndBatch({
        manifestPath: dataset.manifestPath,
        indicatorReportPath: dataset.indicatorReportPath,
        timeframe: input.timeframe,
        maxHoldBars: input.maxHoldBars,
        feeBps: input.feeBps,
        slippageBps: input.slippageBps,
        fundingBpsPer8h: input.fundingBpsPer8h,
        oosSplitRatio: input.oosSplitRatio,
        searchTrialCount: input.candidates.length,
        candidates: [candidate],
      })
      const replay = report.candidates[0].replay
      const oos = asRecord(asRecord(replay.assumptions).anti_overfit).oos_stats
      const cost = asRecord(asRecord(asRecord(replay.assumptions).robustness).cost_stress).stats
      return {
        dataset_id: dataset.datasetId,
        symbol: replay.symbol,
        sample_count: replay.sample_count,
        avg_r: replay.avg_r,
        total_r: replay.total_r,
        profit_factor: replay.profit_factor,
        max_drawdown_r: replay.max_drawdown_r,
        oos_positive: positiveStats(asRecord(oos)),
        cost_stress_positive: positiveStats(asRecord(cost)),
      }
    })
    const sampleCount = sum(assets.map((asset) => asset.sample_count))
    const positiveAssets = assets.filter((asset) => asset.avg_r > 0 && asset.total_r > 0).length
    const requiredPositive = Math.ceil(assets.length * 0.6)
    const blockedBy: Array<{ check_id: string; reason: string }> = []
    if (sampleCount < 100) blockedBy.push({ check_id: "PANEL-SAMPLES", reason: `pooled sample_count ${sampleCount} is below 100` })
    if (positiveAssets < requiredPositive) blockedBy.push({ check_id: "PANEL-BREADTH", reason: `${positiveAssets}/${assets.length} assets are positive; ${requiredPositive} required` })
    if (assets.filter((asset) => asset.oos_positive).length < requiredPositive) blockedBy.push({ check_id: "PANEL-OOS", reason: "selection validation is not positive across enough assets" })
    if (assets.filter((asset) => asset.cost_stress_positive).length < requiredPositive) blockedBy.push({ check_id: "PANEL-COST", reason: "cost stress is not positive across enough assets" })
    if (assets.some((asset) => asset.total_r < -10 || asset.max_drawdown_r > 15)) blockedBy.push({ check_id: "PANEL-CATASTROPHIC", reason: "at least one asset exceeds the catastrophic loss veto" })
    return {
      candidate_id: candidate.candidateId,
      family: candidate.family || "trend_pullback_v1",
      pooled: {
        sample_count: sampleCount,
        avg_r: sampleCount > 0 ? round(sum(assets.map((asset) => asset.avg_r * asset.sample_count)) / sampleCount) : 0,
        total_r: round(sum(assets.map((asset) => asset.total_r))),
        positive_assets: positiveAssets,
        asset_count: assets.length,
      },
      assets,
      gate: { accepted: blockedBy.length === 0, blocked_by: blockedBy },
    }
  })
  return {
    panel_id: input.panelId || "strategy-panel-rnd",
    hypothesis: input.hypothesis || "",
    dataset_count: input.datasets.length,
    trial_count: input.candidates.length,
    outcome: candidates.some((candidate) => candidate.gate.accepted) ? "candidate_found" : "no_promote",
    candidates,
  }
}

function strategyPanelRndInputFromJson(value: JSONRecord): StrategyPanelRndInput {
  return {
    panelId: stringField(value.panel_id ?? value.panelId) || undefined,
    hypothesis: stringField(value.hypothesis) || undefined,
    timeframe: stringField(value.timeframe) || undefined,
    maxHoldBars: optionalNumber(value.max_hold_bars ?? value.maxHoldBars),
    feeBps: optionalNumber(value.fee_bps ?? value.feeBps),
    slippageBps: optionalNumber(value.slippage_bps ?? value.slippageBps),
    fundingBpsPer8h: optionalNumber(value.funding_bps_per_8h ?? value.fundingBpsPer8h),
    oosSplitRatio: optionalNumber(value.oos_split ?? value.oosSplitRatio),
    datasets: array(value.datasets).map((raw) => {
      const item = asRecord(raw)
      return {
        datasetId: stringField(item.dataset_id ?? item.datasetId),
        manifestPath: stringField(item.manifest_path ?? item.manifestPath),
        indicatorReportPath: stringField(item.indicator_report_path ?? item.indicatorReportPath) || undefined,
      }
    }),
    candidates: array(value.candidates).map((raw) => {
      const item = asRecord(raw)
      return {
        candidateId: stringField(item.candidate_id ?? item.candidateId),
        description: stringField(item.description) || undefined,
        family: stringField(item.family) || undefined,
        parameterCount: optionalNumber(item.parameter_count ?? item.parameterCount),
        params: asRecord(item.params),
      }
    }),
  }
}

function positiveStats(stats: JSONRecord): boolean {
  return Number(stats.sample_count) > 0 && Number(stats.avg_r) > 0 && Number(stats.total_r) > 0
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function asRecord(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function stringField(value: unknown): string { return typeof value === "string" ? value.trim() : "" }
function optionalNumber(value: unknown): number | undefined { const number = Number(value); return Number.isFinite(number) ? number : undefined }
function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0) }
function round(value: number): number { return Number(value.toFixed(6)) }

export { runStrategyPanelRnd, strategyPanelRndInputFromJson, type StrategyPanelRndInput }
