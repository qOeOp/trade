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
  candidates: StrategyRndCandidateInput[]
  antiOverfitStage?: "selection_validation" | "external_validation" | "locked_holdout"
  parameterStability?: JSONRecord
  searchTrialCount?: number
}

export interface StrategyRndLoopInput extends StrategyRndBatchInput {
  runId?: string
  artifactRoot?: string
  ledgerPath?: string
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
  validationManifestPath: string
  validationIndicatorReportPath?: string
}

export interface StrategyRndCampaignInput {
  campaignId?: string
  hypotheses: StrategyRndCampaignHypothesisInput[]
  calibrationReportPath?: string
  maxTotalTrials?: number
  artifactRoot?: string
  ledgerPath?: string
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
    batchId: stringField(input.batch_id ?? input.batchId) || undefined,
    hypothesis: stringField(input.hypothesis) || undefined,
    manifestPath: stringField(input.manifest_path ?? input.manifestPath),
    timeframe: stringField(input.timeframe) || undefined,
    maxHoldBars: optionalNumber(input.max_hold_bars ?? input.maxHoldBars),
    feeBps: optionalNumber(input.fee_bps ?? input.feeBps),
    slippageBps: optionalNumber(input.slippage_bps ?? input.slippageBps),
    fundingBpsPer8h: optionalNumber(input.funding_bps_per_8h ?? input.fundingBpsPer8h),
    oosSplitRatio: optionalNumber(input.oos_split ?? input.oosSplitRatio),
    antiOverfitStage: readAntiOverfitStage(input.anti_overfit_stage ?? input.antiOverfitStage),
    searchTrialCount: optionalNumber(input.search_trial_count ?? input.searchTrialCount),
    indicatorReportPath: stringField(input.indicator_report_path ?? input.indicatorReportPath) || undefined,
    factorCompose: readBoolean(input.factor_compose ?? input.factorCompose, false),
    factorDiscover: readBoolean(input.factor_discover ?? input.factorDiscover, false),
    factorResearchOptions: factorResearchOptionsFromJson(input.factor_research_options ?? input.factorResearchOptions),
    factorSeeds: readFactorConditions(input.factor_seeds ?? input.factorSeeds),
    maxFactorsPerCandidate: optionalNumber(input.max_factors_per_candidate ?? input.maxFactorsPerCandidate),
    parameterStability: asRecord(input.parameter_stability ?? input.parameterStability),
    candidates: array(input.candidates).map((item) => candidateFromJson(asRecord(item))),
  }
}

export function strategyRndLoopInputFromJson(input: JSONRecord): StrategyRndLoopInput {
  return {
    ...strategyRndBatchInputFromJson(input),
    runId: stringField(input.run_id ?? input.runId) || undefined,
    artifactRoot: stringField(input.artifact_root ?? input.artifactRoot) || undefined,
    ledgerPath: stringField(input.ledger_path ?? input.ledgerPath) || undefined,
    now: stringField(input.now) || undefined,
  }
}

export function strategyRndCampaignInputFromJson(input: JSONRecord): StrategyRndCampaignInput {
  return {
    campaignId: stringField(input.campaign_id ?? input.campaignId) || undefined,
    calibrationReportPath: stringField(input.calibration_report_path ?? input.calibrationReportPath) || undefined,
    maxTotalTrials: optionalNumber(input.max_total_trials ?? input.maxTotalTrials),
    artifactRoot: stringField(input.artifact_root ?? input.artifactRoot) || undefined,
    ledgerPath: stringField(input.ledger_path ?? input.ledgerPath) || undefined,
    now: stringField(input.now) || undefined,
    hypotheses: array(input.hypotheses).map((raw) => {
      const hypothesis = asRecord(raw)
      return {
        ...strategyRndBatchInputFromJson({
          ...hypothesis,
          manifest_path: hypothesis.discovery_manifest_path
            ?? hypothesis.discoveryManifestPath
            ?? hypothesis.manifest_path
            ?? hypothesis.manifestPath,
        }),
        hypothesisId: stringField(hypothesis.hypothesis_id ?? hypothesis.hypothesisId),
        validationManifestPath: stringField(hypothesis.validation_manifest_path ?? hypothesis.validationManifestPath),
        validationIndicatorReportPath: stringField(hypothesis.validation_indicator_report_path ?? hypothesis.validationIndicatorReportPath) || undefined,
      }
    }),
  }
}

export function strategyRndSignalInputFromJson(input: JSONRecord): StrategyRndSignalInput {
  return {
    manifestPath: stringField(input.manifest_path ?? input.manifestPath),
    indicatorReportPath: stringField(input.indicator_report_path ?? input.indicatorReportPath) || undefined,
    timeframe: stringField(input.timeframe) || undefined,
    entryPrice: Number(input.entry_price ?? input.entryPrice),
    now: stringField(input.now) || undefined,
    maxSignalAgeBars: optionalNumber(input.max_signal_age_bars ?? input.maxSignalAgeBars),
    candidate: candidateFromJson(asRecord(input.candidate)),
  }
}

function candidateFromJson(input: JSONRecord): StrategyRndCandidateInput {
  return {
    candidateId: stringField(input.candidate_id ?? input.candidateId),
    description: stringField(input.description) || undefined,
    family: stringField(input.family) || undefined,
    parameterCount: optionalNumber(input.parameter_count ?? input.parameterCount),
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
    horizonBars: optionalNumber(input.horizon_bars ?? input.horizonBars),
    lookback: optionalNumber(input.lookback),
    minSamples: optionalNumber(input.min_samples ?? input.minSamples),
    minAbsIc: optionalNumber(input.min_abs_ic ?? input.minAbsIc),
    maxCorrelation: optionalNumber(input.max_correlation ?? input.maxCorrelation),
    maxSelected: optionalNumber(input.max_selected ?? input.maxSelected),
  }
}

function readAntiOverfitStage(value: unknown): StrategyRndBatchInput["antiOverfitStage"] {
  return value === "external_validation" || value === "locked_holdout" || value === "selection_validation" ? value : undefined
}
