import { loadCandlesFromManifest, loadManifest, type Candle } from "../../../../../replay-execution-plane/compatibility/replay-engine/src/lib/replay-core"
import { runStrategyRndBatch } from "./strategy-rnd-batch"
import type { StrategyRndCandidateInput } from "./strategy-rnd-inputs"

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
  marketabilityGate?: MarketabilityGateInput
  timeframe?: string
  maxHoldBars?: number
  feeBps?: number
  slippageBps?: number
  fundingBpsPer8h?: number
  oosSplitRatio?: number
  diagnosticMode?: boolean
}

interface MarketabilityGateInput {
  enabled: boolean
  minRows?: number
  minMedianQuoteVolume?: number
  maxImpactProxyBps?: number
  minScore?: number
  selectionBars?: number
  minAssets?: number
  maxAssets?: number
}

interface UniverseSelection {
  report: JSONRecord
  selectedDatasets: PanelDataset[]
}

interface PanelAssetReport {
  dataset_id: string
  symbol: string
  sample_count: number
  avg_r: number
  total_r: number
  profit_factor: number
  max_drawdown_r: number
  oos_positive: boolean
  cost_stress_positive: boolean
  negative_control_passed: boolean
  negative_control_blocked_by: string[]
  funding_event_coverage?: JSONRecord
  funding_event_count?: number
  funding_events_hash?: string | null
  marketability?: JSONRecord
}

interface PanelCandidateReport {
  candidate_id: string
  family: string
  pooled: {
    sample_count: number
    avg_r: number
    total_r: number
    positive_assets: number
    asset_count: number
  }
  negative_controls: JSONRecord
  panel_negative_controls?: JSONRecord
  marketability?: JSONRecord
  catastrophic_assets: Array<{ dataset_id: string; symbol: string; total_r: number; max_drawdown_r: number; reasons: string[] }>
  assets: PanelAssetReport[]
  gate: { accepted: boolean; blocked_by: Array<{ check_id: string; reason: string }> }
}

function runStrategyPanelRnd(input: StrategyPanelRndInput): JSONRecord {
  if (input.datasets.length < 3) throw new Error("strategy panel R&D requires at least three datasets")
  if (input.candidates.length < 1 || input.candidates.length > 10) throw new Error("strategy panel R&D requires 1-10 candidates")
  const universeSelection = buildUniverseSelection(input)
  const candidates: PanelCandidateReport[] = input.candidates.map((candidate) => {
    const candidateInput = inputForCandidate(input, candidate, universeSelection)
    if (candidate.family !== "marketability_score_v1" && candidateInput.datasets.length < 3) {
      return insufficientUniverseCandidate(candidate, universeSelection, candidateInput.datasets.length)
    }
    if (isCrossSectionalFamily(candidate.family)) {
      return runCrossSectionalCandidate(candidateInput, candidate)
    }
    if (candidate.family === "marketability_score_v1") {
      return runMarketabilityCandidate(input, candidate)
    }
    const assets = candidateInput.datasets.map((dataset) => {
      const report = runStrategyRndBatch({
        manifestPath: dataset.manifestPath,
        indicatorReportPath: dataset.indicatorReportPath,
        timeframe: candidateInput.timeframe,
        maxHoldBars: candidateInput.maxHoldBars,
        feeBps: candidateInput.feeBps,
        slippageBps: candidateInput.slippageBps,
        fundingBpsPer8h: candidateInput.fundingBpsPer8h,
        oosSplitRatio: candidateInput.oosSplitRatio,
        diagnosticMode: candidateInput.diagnosticMode,
        searchTrialCount: candidateInput.candidates.length,
        candidates: [candidate],
      })
      const replay = report.candidates[0].replay
      const negativeControls = asRecord(report.candidates[0].negative_controls)
      const negativeBlocks = array(negativeControls.blocked_by).map(asRecord)
      const assumptions = asRecord(replay.assumptions)
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
        negative_control_passed: negativeBlocks.length === 0,
        negative_control_blocked_by: negativeBlocks.map((block) => stringField(block.check_id)).filter(Boolean),
        funding_event_coverage: asRecord(assumptions.funding_event_coverage),
        funding_event_count: Number(assumptions.funding_event_count) || 0,
        funding_events_hash: stringField(assumptions.funding_events_hash) || null,
      }
    }) as PanelAssetReport[]
    const sampleCount = sum(assets.map((asset) => asset.sample_count))
    const positiveAssets = assets.filter((asset) => asset.avg_r > 0 && asset.total_r > 0).length
    const requiredPositive = Math.ceil(assets.length * 0.6)
    const negativePassedAssets = assets.filter((asset) => asset.negative_control_passed).length
    const negativeControl = {
      method: "per_asset_candidate_negative_controls",
      passed_assets: negativePassedAssets,
      required_passed_assets: requiredPositive,
      asset_count: assets.length,
    }
    const blockedBy: Array<{ check_id: string; reason: string }> = []
    const catastrophicAssets = catastrophicAssetsFrom(assets)
    if (sampleCount < 100) blockedBy.push({ check_id: "PANEL-SAMPLES", reason: `pooled sample_count ${sampleCount} is below 100` })
    if (positiveAssets < requiredPositive) blockedBy.push({ check_id: "PANEL-BREADTH", reason: `${positiveAssets}/${assets.length} assets are positive; ${requiredPositive} required` })
    if (assets.filter((asset) => asset.oos_positive).length < requiredPositive) blockedBy.push({ check_id: "PANEL-OOS", reason: "selection validation is not positive across enough assets" })
    if (assets.filter((asset) => asset.cost_stress_positive).length < requiredPositive) blockedBy.push({ check_id: "PANEL-COST", reason: "cost stress is not positive across enough assets" })
    if (!input.diagnosticMode && negativePassedAssets < requiredPositive) blockedBy.push({ check_id: "PANEL-NEGATIVE-CONTROL", reason: `${negativePassedAssets}/${assets.length} assets beat candidate negative controls; ${requiredPositive} required` })
    if (catastrophicAssets.length > 0) blockedBy.push({ check_id: "PANEL-CATASTROPHIC", reason: "at least one asset exceeds the catastrophic loss veto" })
    if (input.diagnosticMode) blockedBy.push({ check_id: "PANEL-DIAGNOSTIC-ONLY", reason: "diagnostic mode skips candidate negative controls and parameter stability; rerun survivors with diagnostic_mode=false" })
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
      negative_controls: negativeControl,
      catastrophic_assets: catastrophicAssets,
      assets,
      gate: { accepted: blockedBy.length === 0, blocked_by: blockedBy },
    }
  })
  const panelNegativeControls = input.diagnosticMode ? buildDiagnosticPanelNegativeControl(candidates) : buildPanelAssetShuffleNegativeControl(candidates)
  candidates.forEach((candidate, index) => {
    if (isCrossSectionalFamily(candidate.family) || candidate.family === "marketability_score_v1") return
    const control = panelNegativeControls[index]
    candidate.panel_negative_controls = control
    if (stringField(control.status) === "evaluated" && control.passed !== true) {
      candidate.gate.blocked_by.push({ check_id: "PANEL-ASSET-SHUFFLE", reason: "candidate pooled result does not beat cross-candidate asset shuffle negative control" })
      candidate.gate.accepted = false
    }
  })
  const acceptedCount = candidates.filter((candidate) => candidate.gate.accepted).length
  const failureSummary = input.diagnosticMode || acceptedCount > 0 ? null : panelFailureSummary(candidates)
  return {
    panel_id: input.panelId || "strategy-panel-rnd",
    hypothesis: input.hypothesis || "",
    diagnostic_mode: input.diagnosticMode === true,
    dataset_count: input.datasets.length,
    selected_dataset_count: universeSelection.selectedDatasets.length,
    universe_selection: universeSelection.report,
    trial_count: input.candidates.length,
    accepted_count: acceptedCount,
    outcome: input.diagnosticMode ? "diagnostic_only" : acceptedCount > 0 ? "candidate_found" : "no_promote",
    failure_summary: failureSummary,
    next_strategy_hypothesis_request: failureSummary ? nextStrategyHypothesisRequest(input, candidates, failureSummary) : null,
    candidates,
  }
}

function panelFailureSummary(candidates: PanelCandidateReport[]): JSONRecord {
  const blockerCounts = new Map<string, number>()
  for (const candidate of candidates) {
    for (const blocker of candidate.gate.blocked_by) {
      blockerCounts.set(blocker.check_id, (blockerCounts.get(blocker.check_id) || 0) + 1)
    }
  }
  const topBlockers = Array.from(blockerCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([checkId, count]) => ({ check_id: checkId, count }))
  return {
    primary_failure_area: panelPrimaryFailureArea(topBlockers.map((item) => item.check_id)),
    rejected_candidate_count: candidates.filter((candidate) => !candidate.gate.accepted).length,
    accepted_candidate_count: candidates.filter((candidate) => candidate.gate.accepted).length,
    top_blockers: topBlockers,
    next_system_actions: [
      "Design a new predeclared strategy hypothesis from the panel evidence; market-state filters, asset selection, holding rules, and risk geometry must be part of the candidate strategy definition, not post-hoc panel refinement.",
    ],
  }
}

function panelPrimaryFailureArea(blockerIds: string[]): string {
  const ids = new Set(blockerIds)
  if (ids.has("PANEL-CATASTROPHIC") || ids.has("PANEL-COST")) return "strategy_hypothesis_risk_design"
  if (ids.has("PANEL-BREADTH") || ids.has("PANEL-OOS")) return "strategy_hypothesis_edge_design"
  if (ids.has("PANEL-ASSET-SHUFFLE") || ids.has("PANEL-NEGATIVE-CONTROL")) return "negative_control"
  if (ids.has("PANEL-SAMPLES")) return "sample_efficiency"
  return "panel_strategy_hypothesis_design"
}

function nextStrategyHypothesisRequest(input: StrategyPanelRndInput, candidates: PanelCandidateReport[], failureSummary: JSONRecord): JSONRecord {
  return {
    schema_version: "trade-flow.next-strategy-hypothesis-request.v1",
    source: "panel_evaluator",
    panel_id: input.panelId || "strategy-panel-rnd",
    requested_surface: "panel_strategy_hypothesis",
    framing: "filters_asset_selection_and_risk_rules_are_strategy_components",
    prohibited_framing: ["panel_refinement", "posthoc_filter_patch", "reuse_failed_candidate_with_exclusions_only"],
    required_candidate_components: [
      "return_driver",
      "entry_conditions",
      "market_state_filters",
      "asset_selection_rule",
      "holding_and_exit_rules",
      "risk_geometry",
      "cost_and_funding_assumptions",
      "negative_controls",
    ],
    evidence_inputs: {
      failure_summary: failureSummary,
      candidate_evidence: candidates.map((candidate) => ({
        candidate_id: candidate.candidate_id,
        family: candidate.family,
        pooled: candidate.pooled,
        blockers: candidate.gate.blocked_by.map((blocker) => blocker.check_id),
        catastrophic_assets: candidate.catastrophic_assets.map((asset) => ({
          dataset_id: asset.dataset_id,
          symbol: asset.symbol,
          total_r: asset.total_r,
          max_drawdown_r: asset.max_drawdown_r,
          reasons: asset.reasons,
        })),
      })),
    },
  }
}

function buildUniverseSelection(input: StrategyPanelRndInput): UniverseSelection {
  const gate = input.marketabilityGate
  if (!gate?.enabled) {
    return {
      selectedDatasets: input.datasets,
      report: {
        method: "marketability_score_v1_universe_gate",
        applied: false,
        status: "not_requested",
        dataset_count: input.datasets.length,
        selected_dataset_count: input.datasets.length,
      },
    }
  }
  const minRows = positiveInteger(gate.minRows, 100)
  const minMedianQuoteVolume = positiveNumber(gate.minMedianQuoteVolume, 1_000_000)
  const maxImpactProxyBps = positiveNumber(gate.maxImpactProxyBps, 600)
  const minScore = positiveNumber(gate.minScore, 60)
  const selectionBars = positiveInteger(gate.selectionBars, minRows)
  const minAssets = positiveInteger(gate.minAssets, 3)
  const timeframe = input.timeframe || "4h"
  const scored = input.datasets.map((dataset, index) => {
    const manifest = loadManifest(dataset.manifestPath)
    const candles = loadCandlesFromManifest(dataset.manifestPath, manifest, timeframe)
    const selectionCandles = candles.slice(0, Math.min(candles.length, selectionBars))
    const symbol = stringField(manifest.symbol) || stringField(manifest.requested_symbol) || dataset.datasetId
    const marketability = summarizeMarketability(selectionCandles, {
      minRows,
      minMedianQuoteVolume,
      maxImpactProxyBps,
      minScore,
    })
    return { dataset, index, symbol, marketability, selectionLastOpen: selectionCandles[selectionCandles.length - 1]?.timestamp || null }
  })
  const passed = scored
    .filter((item) => asRecord(item.marketability).passed === true)
    .sort((a, b) => Number(asRecord(b.marketability).score) - Number(asRecord(a.marketability).score) || a.index - b.index)
  const maxAssets = positiveInteger(gate.maxAssets, passed.length || input.datasets.length)
  const selected = passed.slice(0, Math.max(0, maxAssets))
  const selectedIds = new Set(selected.map((item) => item.dataset.datasetId))
  const excluded = scored.filter((item) => !selectedIds.has(item.dataset.datasetId))
  const selectedDatasets = selected.map((item) => item.dataset)
  return {
    selectedDatasets,
    report: {
      method: "marketability_score_v1_universe_gate",
      applied: true,
      temporal_contract: "prefix_selection_window_only",
      status: selectedDatasets.length >= minAssets ? "passed" : "blocked",
      min_assets: minAssets,
      selection_bars: selectionBars,
      dataset_count: input.datasets.length,
      selected_dataset_count: selectedDatasets.length,
      excluded_dataset_count: excluded.length,
      thresholds: {
        min_rows: minRows,
        min_median_quote_volume: minMedianQuoteVolume,
        max_impact_proxy_bps: maxImpactProxyBps,
        min_score: minScore,
        max_assets: maxAssets,
      },
      selected_assets: selected.map((item) => marketabilityAssetReport(item, "selected")),
      excluded_assets: excluded.map((item) => marketabilityAssetReport(item, asRecord(item.marketability).passed === true ? "capacity_trimmed" : "failed_gate")),
    },
  }
}

function marketabilityAssetReport(item: { dataset: PanelDataset; symbol: string; marketability: JSONRecord; selectionLastOpen?: number | null }, reason: string): JSONRecord {
  const marketability = asRecord(item.marketability)
  return {
    dataset_id: item.dataset.datasetId,
    symbol: item.symbol,
    score: Number(marketability.score),
    passed: marketability.passed === true,
    blocked_by: array(marketability.blocked_by).map(String).filter(Boolean),
    selection_reason: reason,
    selection_last_open: item.selectionLastOpen ? new Date(item.selectionLastOpen).toISOString() : null,
    median_quote_volume: Number(marketability.median_quote_volume),
    impact_proxy_bps: Number(marketability.impact_proxy_bps),
  }
}

function inputForCandidate(input: StrategyPanelRndInput, candidate: StrategyRndCandidateInput, universeSelection: UniverseSelection): StrategyPanelRndInput {
  if (candidate.family === "marketability_score_v1") return input
  return {
    ...input,
    datasets: universeSelection.selectedDatasets,
  }
}

function insufficientUniverseCandidate(candidate: StrategyRndCandidateInput, universeSelection: UniverseSelection, selectedCount: number): PanelCandidateReport {
  return {
    candidate_id: candidate.candidateId,
    family: candidate.family || "trend_pullback_v1",
    pooled: {
      sample_count: 0,
      avg_r: 0,
      total_r: 0,
      positive_assets: 0,
      asset_count: selectedCount,
    },
    negative_controls: {
      method: "marketability_universe_gate",
      status: "blocked",
      reason: "fewer than three assets survived the marketability gate",
    },
    panel_negative_controls: {
      method: "marketability_universe_gate",
      status: "blocked",
      universe_selection: universeSelection.report,
    },
    marketability: universeSelection.report,
    catastrophic_assets: [],
    assets: [],
    gate: {
      accepted: false,
      blocked_by: [{
        check_id: "PANEL-MARKETABILITY-UNIVERSE",
        reason: `marketability gate selected ${selectedCount} assets; at least 3 are required for panel R&D`,
      }],
    },
  }
}

function runMarketabilityCandidate(input: StrategyPanelRndInput, candidate: StrategyRndCandidateInput): PanelCandidateReport {
  const params = asRecord(candidate.params)
  const minRows = positiveInteger(params.min_rows, 100)
  const minMedianQuoteVolume = positiveNumber(params.min_median_quote_volume, 1_000_000)
  const maxImpactProxyBps = positiveNumber(params.max_impact_proxy_bps, 600)
  const minScore = positiveNumber(params.min_score, 60)
  const requiredPassedAssets = Math.ceil(input.datasets.length * 0.8)
  const timeframe = input.timeframe || "4h"
  const assets = input.datasets.map((dataset) => {
    const manifest = loadManifest(dataset.manifestPath)
    const candles = loadCandlesFromManifest(dataset.manifestPath, manifest, timeframe)
    const symbol = stringField(manifest.symbol) || stringField(manifest.requested_symbol) || dataset.datasetId
    const marketability = summarizeMarketability(candles, {
      minRows,
      minMedianQuoteVolume,
      maxImpactProxyBps,
      minScore,
    })
    return {
      dataset_id: dataset.datasetId,
      symbol,
      sample_count: candles.length,
      avg_r: 0,
      total_r: 0,
      profit_factor: 0,
      max_drawdown_r: 0,
      oos_positive: false,
      cost_stress_positive: marketability.passed === true,
      negative_control_passed: true,
      negative_control_blocked_by: [],
      marketability,
    }
  }) as PanelAssetReport[]
  const passedAssets = assets.filter((asset) => asRecord(asset.marketability).passed === true).length
  const scores = assets.map((asset) => Number(asRecord(asset.marketability).score)).filter(Number.isFinite)
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  if (passedAssets < requiredPassedAssets) {
    blockedBy.push({ check_id: "PANEL-MARKETABILITY", reason: `${passedAssets}/${assets.length} assets pass marketability thresholds; ${requiredPassedAssets} required` })
  }
  blockedBy.push({ check_id: "PANEL-NON-TRADING-FAMILY", reason: "marketability_score_v1 is a scorer/gate, not a standalone trading strategy" })
  return {
    candidate_id: candidate.candidateId,
    family: "marketability_score_v1",
    pooled: {
      sample_count: sum(assets.map((asset) => asset.sample_count)),
      avg_r: scores.length ? round(sum(scores) / scores.length) : 0,
      total_r: 0,
      positive_assets: passedAssets,
      asset_count: assets.length,
    },
    negative_controls: {
      method: "marketability_threshold_gate",
      status: "diagnostic_only",
      passed_assets: passedAssets,
      required_passed_assets: requiredPassedAssets,
    },
    panel_negative_controls: {
      method: "marketability_score_v1",
      status: "diagnostic_only",
      min_rows: minRows,
      min_median_quote_volume: minMedianQuoteVolume,
      max_impact_proxy_bps: maxImpactProxyBps,
      min_score: minScore,
      passed_assets: passedAssets,
      required_passed_assets: requiredPassedAssets,
      median_score: quantile(scores.slice().sort((a, b) => a - b), 0.5),
    },
    marketability: {
      method: "ohlcv_marketability_proxy_v1",
      scope: "panel",
      passed_assets: passedAssets,
      required_passed_assets: requiredPassedAssets,
      score_avg: scores.length ? round(sum(scores) / scores.length) : 0,
      score_median: quantile(scores.slice().sort((a, b) => a - b), 0.5),
      note: "OHLCV proxy only; depth/order-book capacity still requires live or archived L2 data.",
    },
    catastrophic_assets: [],
    assets,
    gate: { accepted: false, blocked_by: blockedBy },
  }
}

function summarizeMarketability(candles: Candle[], thresholds: {
  minRows: number
  minMedianQuoteVolume: number
  maxImpactProxyBps: number
  minScore: number
}): JSONRecord {
  const quoteVolumes = candles.map((candle) => candle.close * candle.volume).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
  const rangePct = candles.map((candle) => candle.close > 0 ? (candle.high - candle.low) / candle.close : 0).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
  const medianQuoteVolume = quantile(quoteVolumes, 0.5)
  const p10QuoteVolume = quantile(quoteVolumes, 0.1)
  const medianRangePct = quantile(rangePct, 0.5)
  const impactProxyBps = round((medianRangePct * 10_000) / Math.sqrt(Math.max(medianQuoteVolume / 1_000_000, 0.01)))
  const rowsScore = clamp(candles.length / thresholds.minRows * 100, 0, 100)
  const volumeScore = clamp(60 + Math.log10(Math.max(medianQuoteVolume / thresholds.minMedianQuoteVolume, 0.01)) * 20, 0, 100)
  const impactScore = clamp(100 - (impactProxyBps / thresholds.maxImpactProxyBps) * 60, 0, 100)
  const rangeScore = clamp(100 - (medianRangePct / 0.12) * 100, 0, 100)
  const score = round((rowsScore * 0.2) + (volumeScore * 0.35) + (impactScore * 0.35) + (rangeScore * 0.1))
  const blockers = [
    ...(candles.length < thresholds.minRows ? ["MARKETABILITY-ROWS"] : []),
    ...(medianQuoteVolume < thresholds.minMedianQuoteVolume ? ["MARKETABILITY-QUOTE-VOLUME"] : []),
    ...(impactProxyBps > thresholds.maxImpactProxyBps ? ["MARKETABILITY-IMPACT-PROXY"] : []),
    ...(score < thresholds.minScore ? ["MARKETABILITY-SCORE"] : []),
  ]
  return {
    score,
    passed: blockers.length === 0,
    blocked_by: blockers,
    rows: candles.length,
    median_quote_volume: medianQuoteVolume,
    p10_quote_volume: p10QuoteVolume,
    median_range_pct: round(medianRangePct),
    impact_proxy_bps: impactProxyBps,
    components: {
      rows_score: round(rowsScore),
      volume_score: round(volumeScore),
      impact_score: round(impactScore),
      range_score: round(rangeScore),
    },
  }
}

interface CrossSectionalPosition {
  dataset_id: string
  symbol: string
  timestamp: number
  r: number
}

function isCrossSectionalFamily(family: string | undefined): boolean {
  return family === "cross_sectional_momentum_v1" || family === "cross_sectional_reversal_v1"
}

function runCrossSectionalCandidate(input: StrategyPanelRndInput, candidate: StrategyRndCandidateInput): PanelCandidateReport {
  const params = asRecord(candidate.params)
  const lookbackBars = positiveInteger(params.lookback_bars, 30)
  const holdBars = positiveInteger(params.hold_bars, positiveInteger(input.maxHoldBars, 6))
  const topN = Math.min(input.datasets.length, positiveInteger(params.top_n, Math.max(1, Math.floor(input.datasets.length * 0.25))))
  const bottomN = Math.min(input.datasets.length, positiveInteger(params.bottom_n, 0))
  const riskPct = positiveNumber(params.risk_pct, 0.05)
  const mode = stringField(params.mode) || (candidate.family === "cross_sectional_reversal_v1" ? "long_bottom" : "long_top")
  const panel = loadCrossSectionalPanel(input)
  const positions = simulateCrossSectionalPositions({
    panel,
    lookbackBars,
    holdBars,
    topN,
    bottomN,
    riskPct,
    mode,
    family: candidate.family || "cross_sectional_momentum_v1",
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
  })
  const assets = panel.assets.map((asset) => summarizeCrossSectionalAsset(asset, positions.filter((position) => position.dataset_id === asset.datasetId)))
  const sampleCount = sum(assets.map((asset) => asset.sample_count))
  const positiveAssets = assets.filter((asset) => asset.avg_r > 0 && asset.total_r > 0).length
  const requiredPositive = Math.ceil(assets.length * 0.6)
  const negativeControl = buildCrossSectionalRankShiftNegativeControl({
    panel,
    lookbackBars,
    holdBars,
    topN,
    bottomN,
    riskPct,
    mode,
    family: candidate.family || "cross_sectional_momentum_v1",
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    observedPositions: positions,
  })
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  const catastrophicAssets = catastrophicAssetsFrom(assets)
  if (sampleCount < 100) blockedBy.push({ check_id: "PANEL-SAMPLES", reason: `pooled sample_count ${sampleCount} is below 100` })
  if (positiveAssets < requiredPositive) blockedBy.push({ check_id: "PANEL-BREADTH", reason: `${positiveAssets}/${assets.length} assets are positive; ${requiredPositive} required` })
  if (assets.filter((asset) => asset.oos_positive).length < requiredPositive) blockedBy.push({ check_id: "PANEL-OOS", reason: "selection validation is not positive across enough assets" })
  if (assets.filter((asset) => asset.cost_stress_positive).length < requiredPositive) blockedBy.push({ check_id: "PANEL-COST", reason: "cost stress is not positive across enough assets" })
  if (stringField(negativeControl.status) === "evaluated" && negativeControl.passed !== true) blockedBy.push({ check_id: "PANEL-RANK-SHIFT", reason: "cross-sectional result does not beat rank-shift negative control" })
  if (catastrophicAssets.length > 0) blockedBy.push({ check_id: "PANEL-CATASTROPHIC", reason: "at least one asset exceeds the catastrophic loss veto" })
  if (input.diagnosticMode) blockedBy.push({ check_id: "PANEL-DIAGNOSTIC-ONLY", reason: "diagnostic mode skips promotion checks; rerun survivors with diagnostic_mode=false" })
  return {
    candidate_id: candidate.candidateId,
    family: candidate.family || "cross_sectional_momentum_v1",
    pooled: {
      sample_count: sampleCount,
      avg_r: sampleCount > 0 ? round(sum(assets.map((asset) => asset.avg_r * asset.sample_count)) / sampleCount) : 0,
      total_r: round(sum(assets.map((asset) => asset.total_r))),
      positive_assets: positiveAssets,
      asset_count: assets.length,
    },
    negative_controls: {
      method: "cross_sectional_rank_shift_controls",
      status: stringField(negativeControl.status),
      passed: negativeControl.passed === true,
      observed_total_r: negativeControl.observed_total_r,
    },
    panel_negative_controls: negativeControl,
    catastrophic_assets: catastrophicAssets,
    assets,
    gate: { accepted: blockedBy.length === 0, blocked_by: blockedBy },
  }
}

function loadCrossSectionalPanel(input: StrategyPanelRndInput): { timestamps: number[]; assets: Array<{ datasetId: string; symbol: string; candles: Candle[]; byTimestamp: Map<number, Candle> }> } {
  const timeframe = input.timeframe || "4h"
  const assets = input.datasets.map((dataset) => {
    const manifest = loadManifest(dataset.manifestPath)
    const candles = loadCandlesFromManifest(dataset.manifestPath, manifest, timeframe)
    return {
      datasetId: dataset.datasetId,
      symbol: stringField(manifest.symbol) || stringField(manifest.requested_symbol) || dataset.datasetId,
      candles,
      byTimestamp: new Map(candles.map((candle) => [candle.timestamp, candle])),
    }
  })
  const counts = new Map<number, number>()
  assets.forEach((asset) => {
    asset.candles.forEach((candle) => counts.set(candle.timestamp, (counts.get(candle.timestamp) || 0) + 1))
  })
  const timestamps = Array.from(counts.entries())
    .filter(([, count]) => count === assets.length)
    .map(([timestamp]) => timestamp)
    .sort((a, b) => a - b)
  return { timestamps, assets }
}

function simulateCrossSectionalPositions(input: {
  panel: ReturnType<typeof loadCrossSectionalPanel>
  lookbackBars: number
  holdBars: number
  topN: number
  bottomN: number
  riskPct: number
  mode: string
  family: string
  feeBps?: number
  slippageBps?: number
  rankOffset?: number
}): CrossSectionalPosition[] {
  const positions: CrossSectionalPosition[] = []
  const costPct = 2 * ((input.feeBps || 0) + (input.slippageBps || 0)) / 10000
  for (let index = input.lookbackBars; index < input.panel.timestamps.length - input.holdBars - 1; index += input.holdBars) {
    const signalTime = input.panel.timestamps[index]
    const lookbackTime = input.panel.timestamps[index - input.lookbackBars]
    const entryTime = input.panel.timestamps[index + 1]
    const exitTime = input.panel.timestamps[index + input.holdBars]
    const ranks = input.panel.assets.map((asset) => {
      const signal = asset.byTimestamp.get(signalTime)
      const lookback = asset.byTimestamp.get(lookbackTime)
      return {
        asset,
        score: signal && lookback && lookback.close > 0 ? signal.close / lookback.close - 1 : 0,
      }
    }).sort((a, b) => b.score - a.score)
    const rankOffset = nonNegativeInteger(input.rankOffset, 0)
    const longAssets = input.mode === "long_bottom" || input.family === "cross_sectional_reversal_v1"
      ? selectCircular(ranks.slice().reverse(), rankOffset, input.topN)
      : selectCircular(ranks, rankOffset, input.topN)
    const shortAssets = input.mode === "long_short" && input.bottomN > 0 ? selectCircular(ranks.slice().reverse(), rankOffset, input.bottomN) : []
    for (const ranked of longAssets) {
      const position = positionReturn(ranked.asset, entryTime, exitTime, "long", input.riskPct, costPct)
      if (position) positions.push(position)
    }
    for (const ranked of shortAssets) {
      const position = positionReturn(ranked.asset, entryTime, exitTime, "short", input.riskPct, costPct)
      if (position) positions.push(position)
    }
  }
  return positions
}

function selectCircular<T>(items: T[], offset: number, count: number): T[] {
  if (items.length === 0 || count <= 0) return []
  return Array.from({ length: Math.min(count, items.length) }, (_, index) => items[(index + offset) % items.length])
}

function positionReturn(asset: { datasetId: string; symbol: string; byTimestamp: Map<number, Candle> }, entryTime: number, exitTime: number, side: "long" | "short", riskPct: number, costPct: number): CrossSectionalPosition | null {
  const entry = asset.byTimestamp.get(entryTime)
  const exit = asset.byTimestamp.get(exitTime)
  if (!entry || !exit || entry.open <= 0) return null
  const grossPct = side === "long" ? exit.close / entry.open - 1 : entry.open / exit.close - 1
  return {
    dataset_id: asset.datasetId,
    symbol: asset.symbol,
    timestamp: entryTime,
    r: round((grossPct - costPct) / riskPct),
  }
}

function summarizeCrossSectionalAsset(asset: { datasetId: string; symbol: string }, positions: CrossSectionalPosition[]): PanelAssetReport {
  const values = positions.map((position) => position.r)
  const split = Math.floor(values.length * 0.65)
  const oos = values.slice(split)
  return {
    dataset_id: asset.datasetId,
    symbol: asset.symbol,
    sample_count: values.length,
    avg_r: values.length ? round(sum(values) / values.length) : 0,
    total_r: round(sum(values)),
    profit_factor: profitFactor(values),
    max_drawdown_r: maxDrawdown(values),
    oos_positive: oos.length > 0 && sum(oos) > 0 && sum(oos) / oos.length > 0,
    cost_stress_positive: values.length > 0 && sum(values.map((value) => value - 0.05)) > 0,
    negative_control_passed: true,
    negative_control_blocked_by: [],
  }
}

function buildCrossSectionalRankShiftNegativeControl(input: {
  panel: ReturnType<typeof loadCrossSectionalPanel>
  lookbackBars: number
  holdBars: number
  topN: number
  bottomN: number
  riskPct: number
  mode: string
  family: string
  feeBps?: number
  slippageBps?: number
  observedPositions: CrossSectionalPosition[]
}): JSONRecord {
  const observed = round(sum(input.observedPositions.map((position) => position.r)))
  if (input.observedPositions.length < 30 || input.panel.assets.length < 3) {
    return {
      method: "cross_sectional_rank_shift_v1",
      status: "not_applicable",
      reason: "requires at least 30 positions and three assets",
      observed_total_r: observed,
      passed: false,
    }
  }
  const trials = Math.min(30, Math.max(10, input.panel.assets.length * 4))
  const negativeTotals = Array.from({ length: trials }, (_, trial) => round(sum(simulateCrossSectionalPositions({
    panel: input.panel,
    lookbackBars: input.lookbackBars,
    holdBars: input.holdBars,
    topN: input.topN,
    bottomN: input.bottomN,
    riskPct: input.riskPct,
    mode: input.mode,
    family: input.family,
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    rankOffset: 1 + (trial % Math.max(1, input.panel.assets.length - 1)),
  }).map((position) => position.r)))).sort((a, b) => a - b)
  const p95 = quantile(negativeTotals, 0.95)
  return {
    method: "cross_sectional_rank_shift_v1",
    status: "evaluated",
    trials,
    observed_total_r: observed,
    median_total_r: quantile(negativeTotals, 0.5),
    p95_total_r: p95,
    empirical_p_value: round((1 + negativeTotals.filter((value) => value >= observed).length) / (negativeTotals.length + 1)),
    passed: observed > p95,
  }
}

function buildDiagnosticPanelNegativeControl(candidates: PanelCandidateReport[]): JSONRecord[] {
  return candidates.map((candidate) => ({
    method: "cross_candidate_asset_shuffle_v1",
    status: "diagnostic_skipped",
    reason: "diagnostic mode skips panel negative controls",
    observed_total_r: candidate.pooled.total_r,
    passed: false,
  }))
}

function buildPanelAssetShuffleNegativeControl(candidates: PanelCandidateReport[]): JSONRecord[] {
  const candidateCount = candidates.length
  const assetCount = candidates[0]?.assets.length ?? 0
  if (candidateCount < 2 || assetCount < 3) {
    return candidates.map((candidate) => ({
      method: "cross_candidate_asset_shuffle_v1",
      status: "not_applicable",
      reason: "requires at least two candidates and three assets",
      observed_total_r: candidate.pooled.total_r,
      passed: false,
    }))
  }
  const trials = Math.min(30, Math.max(10, candidateCount * assetCount))
  return candidates.map((candidate, candidateIndex) => {
    const negativeTotals = Array.from({ length: trials }, (_, trial) => {
      return round(sum(candidate.assets.map((_, assetIndex) => {
        const shuffledCandidate = alternateCandidateIndex(candidateIndex, assetIndex, trial, candidateCount)
        return candidates[shuffledCandidate].assets[assetIndex]?.total_r ?? 0
      })))
    }).sort((a, b) => a - b)
    const p95 = quantile(negativeTotals, 0.95)
    const empirical = round((1 + negativeTotals.filter((value) => value >= candidate.pooled.total_r).length) / (negativeTotals.length + 1))
    return {
      method: "cross_candidate_asset_shuffle_v1",
      status: "evaluated",
      trials,
      observed_total_r: candidate.pooled.total_r,
      median_total_r: quantile(negativeTotals, 0.5),
      p95_total_r: p95,
      empirical_p_value: empirical,
      passed: candidate.pooled.total_r > p95,
    }
  })
}

function strategyPanelRndInputFromJson(value: JSONRecord): StrategyPanelRndInput {
  return {
    panelId: stringField(value.panel_id) || undefined,
    hypothesis: stringField(value.hypothesis) || undefined,
    timeframe: stringField(value.timeframe) || undefined,
    maxHoldBars: optionalNumber(value.max_hold_bars),
    feeBps: optionalNumber(value.fee_bps),
    slippageBps: optionalNumber(value.slippage_bps),
    fundingBpsPer8h: optionalNumber(value.funding_bps_per_8h),
    oosSplitRatio: optionalNumber(value.oos_split),
    diagnosticMode: value.diagnostic_mode === true,
    marketabilityGate: marketabilityGateFromJson(asRecord(value.marketability_gate)),
    datasets: array(value.datasets).map((raw) => {
      const item = asRecord(raw)
      return {
        datasetId: stringField(item.dataset_id),
        manifestPath: stringField(item.manifest_path),
        indicatorReportPath: stringField(item.indicator_report_path) || undefined,
      }
    }),
    candidates: array(value.candidates).map((raw) => {
      const item = asRecord(raw)
      return {
        candidateId: stringField(item.candidate_id),
        description: stringField(item.description) || undefined,
        family: stringField(item.family) || undefined,
        parameterCount: optionalNumber(item.parameter_count),
        params: asRecord(item.params),
      }
    }),
  }
}

function marketabilityGateFromJson(value: JSONRecord): MarketabilityGateInput | undefined {
  if (Object.keys(value).length === 0) return undefined
  return {
    enabled: value.enabled === true,
    minRows: optionalNumber(value.min_rows),
    minMedianQuoteVolume: optionalNumber(value.min_median_quote_volume),
    maxImpactProxyBps: optionalNumber(value.max_impact_proxy_bps),
    minScore: optionalNumber(value.min_score),
    selectionBars: optionalNumber(value.selection_bars),
    minAssets: optionalNumber(value.min_assets),
    maxAssets: optionalNumber(value.max_assets),
  }
}

function positiveStats(stats: JSONRecord): boolean {
  return Number(stats.sample_count) > 0 && Number(stats.avg_r) > 0 && Number(stats.total_r) > 0
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function asRecord(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function stringField(value: unknown): string { return typeof value === "string" ? value.trim() : "" }
function optionalNumber(value: unknown): number | undefined { const number = Number(value); return Number.isFinite(number) ? number : undefined }
function positiveInteger(value: unknown, fallback: number): number { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback }
function nonNegativeInteger(value: unknown, fallback: number): number { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : fallback }
function positiveNumber(value: unknown, fallback: number): number { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback }
function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0) }
function round(value: number): number { return Number(value.toFixed(6)) }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)) }
function profitFactor(values: number[]): number {
  const wins = sum(values.filter((value) => value > 0))
  const losses = Math.abs(sum(values.filter((value) => value < 0)))
  if (wins === 0 && losses === 0) return 0
  return losses === 0 ? 999999 : round(wins / losses)
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
  return round(drawdown)
}
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * q) - 1))
  return round(values[index])
}
function alternateCandidateIndex(current: number, assetIndex: number, trial: number, count: number): number {
  return (current + 1 + ((assetIndex + trial) % (count - 1))) % count
}

function catastrophicAssetsFrom(assets: PanelAssetReport[]): Array<{ dataset_id: string; symbol: string; total_r: number; max_drawdown_r: number; reasons: string[] }> {
  return assets.map((asset) => ({
    dataset_id: asset.dataset_id,
    symbol: asset.symbol,
    total_r: asset.total_r,
    max_drawdown_r: asset.max_drawdown_r,
    reasons: [
      ...(asset.total_r < -10 ? ["total_r_below_minus_10"] : []),
      ...(asset.max_drawdown_r > 15 ? ["max_drawdown_r_above_15"] : []),
    ],
  })).filter((asset) => asset.reasons.length > 0)
}

export { catastrophicAssetsFrom, runStrategyPanelRnd, strategyPanelRndInputFromJson, type StrategyPanelRndInput }
