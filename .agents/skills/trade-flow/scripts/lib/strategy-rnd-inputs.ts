import { readFactorConditions, type FactorCondition } from "./factor-engine"
import type { FactorResearchOptions } from "./factor-research"
import type { JSONRecord } from "./json"

export type CandidateSource = "provided" | "bounded_factor_composition" | "scientific_factor_discovery"

export interface StrategyRndBatchInput {
  batchId?: string
  hypothesis?: string
  manifestPath: string
  timeframe?: string
  maxHoldBars?: number
  feeBps?: number
  slippageBps?: number
  fundingBpsPer8h?: number
  oosSplitRatio?: number
  indicatorReportPath?: string
  factorCompose?: boolean
  factorDiscover?: boolean
  factorResearchOptions?: FactorResearchOptions
  factorSeeds?: FactorCondition[]
  maxFactorsPerCandidate?: number
  diagnosticMode?: boolean
  candidates: StrategyRndCandidateInput[]
  antiOverfitStage?: "selection_validation" | "external_validation" | "locked_holdout"
  parameterStability?: JSONRecord
  searchTrialCount?: number
}

export interface StrategyRndLoopInput extends StrategyRndBatchInput {
  runId?: string
  artifactRoot?: string
  ledgerPath?: string
  catalogDbPath?: string
  now?: string
}

export interface StrategyRndSignalInput {
  manifestPath: string
  indicatorReportPath?: string
  timeframe?: string
  entryPrice: number
  now?: string
  maxSignalAgeBars?: number
  candidate: StrategyRndCandidateInput
}

export interface StrategyRndCampaignHypothesisInput extends StrategyRndBatchInput {
  hypothesisId: string
  thesisCertificate?: StrategyRndHypothesisCertificate
  validationManifestPath: string
  validationIndicatorReportPath?: string
}

export interface StrategyRndHypothesisCertificate {
  edgeType?: string
  behavioralHypothesis?: string
  marketParticipants?: string
  regime?: string
  invalidation?: string
  costSensitivity?: string
  candidateUniverse?: unknown
  nullControls?: string[]
}

export interface StrategyRndCampaignInput {
  campaignId?: string
  hypotheses: StrategyRndCampaignHypothesisInput[]
  calibrationReportPath?: string
  panelReportPath?: string
  maxTotalTrials?: number
  artifactRoot?: string
  ledgerPath?: string
  catalogDbPath?: string
  now?: string
}

export interface StrategyRndCandidateInput {
  candidateId: string
  description?: string
  family?: string
  parameterCount?: number
  params?: JSONRecord
}

export function strategyRndBatchInputFromJson(input: JSONRecord): StrategyRndBatchInput {
  return {
    batchId: stringField(input.batch_id) || undefined,
    hypothesis: stringField(input.hypothesis) || undefined,
    manifestPath: stringField(input.manifest_path),
    timeframe: stringField(input.timeframe) || undefined,
    maxHoldBars: optionalNumber(input.max_hold_bars),
    feeBps: optionalNumber(input.fee_bps),
    slippageBps: optionalNumber(input.slippage_bps),
    fundingBpsPer8h: optionalNumber(input.funding_bps_per_8h),
    oosSplitRatio: optionalNumber(input.oos_split),
    antiOverfitStage: readAntiOverfitStage(input.anti_overfit_stage),
    searchTrialCount: optionalNumber(input.search_trial_count),
    indicatorReportPath: stringField(input.indicator_report_path) || undefined,
    factorCompose: readBoolean(input.factor_compose, false),
    factorDiscover: readBoolean(input.factor_discover, false),
    factorResearchOptions: factorResearchOptionsFromJson(input.factor_research_options),
    factorSeeds: readFactorConditions(input.factor_seeds),
    maxFactorsPerCandidate: optionalNumber(input.max_factors_per_candidate),
    diagnosticMode: readBoolean(input.diagnostic_mode, false),
    parameterStability: asRecord(input.parameter_stability),
    candidates: array(input.candidates).map((item) => candidateFromJson(asRecord(item))),
  }
}

export function strategyRndLoopInputFromJson(input: JSONRecord): StrategyRndLoopInput {
  return {
    ...strategyRndBatchInputFromJson(input),
    runId: stringField(input.run_id) || undefined,
    artifactRoot: stringField(input.artifact_root) || undefined,
    ledgerPath: stringField(input.ledger_path) || undefined,
    catalogDbPath: stringField(input.catalog_db_path) || undefined,
    now: stringField(input.now) || undefined,
  }
}

export function strategyRndCampaignInputFromJson(input: JSONRecord): StrategyRndCampaignInput {
  return {
    campaignId: stringField(input.campaign_id) || undefined,
    calibrationReportPath: stringField(input.calibration_report_path) || undefined,
    panelReportPath: stringField(input.panel_report_path) || undefined,
    maxTotalTrials: optionalNumber(input.max_total_trials),
    artifactRoot: stringField(input.artifact_root) || undefined,
    ledgerPath: stringField(input.ledger_path) || undefined,
    catalogDbPath: stringField(input.catalog_db_path) || undefined,
    now: stringField(input.now) || undefined,
    hypotheses: array(input.hypotheses).map((raw) => {
      const hypothesis = asRecord(raw)
      return {
        ...strategyRndBatchInputFromJson({
          ...hypothesis,
          manifest_path: hypothesis.discovery_manifest_path
        }),
        hypothesisId: stringField(hypothesis.hypothesis_id),
        thesisCertificate: hypothesisCertificateFromJson(hypothesis.thesis_certificate),
        validationManifestPath: stringField(hypothesis.validation_manifest_path),
        validationIndicatorReportPath: stringField(hypothesis.validation_indicator_report_path) || undefined,
      }
    }),
  }
}

function hypothesisCertificateFromJson(value: unknown): StrategyRndHypothesisCertificate | undefined {
  const input = asRecord(value)
  if (Object.keys(input).length === 0) {
    return undefined
  }
  return {
    edgeType: stringField(input.edge_type) || undefined,
    behavioralHypothesis: stringField(input.behavioral_hypothesis) || undefined,
    marketParticipants: stringField(input.market_participants) || undefined,
    regime: stringField(input.regime) || undefined,
    invalidation: stringField(input.invalidation) || undefined,
    costSensitivity: stringField(input.cost_sensitivity) || undefined,
    candidateUniverse: input.candidate_universe,
    nullControls: array(input.null_controls).map(stringField).filter(Boolean),
  }
}

export function strategyRndSignalInputFromJson(input: JSONRecord): StrategyRndSignalInput {
  return {
    manifestPath: stringField(input.manifest_path),
    indicatorReportPath: stringField(input.indicator_report_path) || undefined,
    timeframe: stringField(input.timeframe) || undefined,
    entryPrice: Number(input.entry_price),
    now: stringField(input.now) || undefined,
    maxSignalAgeBars: optionalNumber(input.max_signal_age_bars),
    candidate: candidateFromJson(asRecord(input.candidate)),
  }
}

function candidateFromJson(input: JSONRecord): StrategyRndCandidateInput {
  return {
    candidateId: stringField(input.candidate_id),
    description: stringField(input.description) || undefined,
    family: stringField(input.family) || undefined,
    parameterCount: optionalNumber(input.parameter_count),
    params: asRecord(input.params),
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function factorResearchOptionsFromJson(value: unknown): FactorResearchOptions {
  const input = asRecord(value)
  return {
    horizonBars: optionalNumber(input.horizon_bars),
    lookback: optionalNumber(input.lookback),
    minSamples: optionalNumber(input.min_samples),
    minAbsIc: optionalNumber(input.min_abs_ic),
    maxCorrelation: optionalNumber(input.max_correlation),
    maxSelected: optionalNumber(input.max_selected),
  }
}

function readAntiOverfitStage(value: unknown): StrategyRndBatchInput["antiOverfitStage"] {
  return value === "external_validation" || value === "locked_holdout" || value === "selection_validation" ? value : undefined
}
