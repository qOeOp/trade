import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { defaultCatalogDbPathForGeneratedPath, listCatalogStrategyRndRuns, upsertCatalogStrategyRndRun } from "../../../../../contracts/catalog-contract/src/catalog-client"
import { factorConditionsToJson } from "../../../../agent-roles/developer/strategy-family-engine/src/lib/factor-engine"
import { hashCanonical, replayDataHash } from "../../../../replay-execution-plane/compatibility/legacy-research-kernel/src/lib/replay-core"
import type { CandidateSource, StrategyRndLoopInput } from "../../../../agent-roles/developer/candidate-batch-engine/src/lib/strategy-rnd-inputs"

type JSONRecord = Record<string, unknown>

export interface StrategyRndLedgerBatchView {
  batch_id: string
  hypothesis: string
  candidate_source: CandidateSource
  outcome: "candidate_found" | "no_promote"
  trial_count: number
  accepted_count: number
  winner: { candidate_id: string } | null
  candidates: Array<{
    gate: {
      accepted: boolean
      blocked_by: Array<{ check_id: string; reason: string }>
    }
  }>
}

export interface StrategyRndLedgerRecord {
  run_id: string
  created_at: string
  batch_id: string
  hypothesis: string
  manifest_ref: string
  indicator_report_ref: string
  artifact_ref: string
  candidate_source: CandidateSource
  outcome: "candidate_found" | "no_promote"
  trial_count: number
  accepted_count: number
  winner_candidate_id: string | null
  stage: "selection_validation" | "external_validation" | "locked_holdout"
  data_hash: string
  holdout_key: string | null
  rejected_reasons: Array<{
    check_id: string
    count: number
  }>
}

interface StrategyRndLedgerStore {
  catalogDbPath?: string
  ledgerPath?: string
}

export function buildRndLedgerRecord(input: {
  input: StrategyRndLoopInput
  runId: string
  created_at: string
  artifactRef: string
  batch: StrategyRndLedgerBatchView
}): StrategyRndLedgerRecord {
  const stage = input.input.antiOverfitStage || "selection_validation"
  const dataHash = replayDataHash(
    input.input.manifestPath,
    input.input.timeframe || "4h",
    supplementalDataRefsForInput(input.input),
  )
  return {
    run_id: input.runId,
    created_at: input.created_at,
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
    stage,
    data_hash: dataHash,
    holdout_key: stage === "locked_holdout" ? hashCanonical({ stage, data_hash: dataHash }) : null,
    rejected_reasons: summarizeRejectedReasons(input.batch),
  }
}

export function summarizeRejectedReasons(batch: StrategyRndLedgerBatchView): StrategyRndLedgerRecord["rejected_reasons"] {
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

export function redactLoopInputForArtifact(input: StrategyRndLoopInput): JSONRecord {
  return {
    batch_id: input.batchId,
    hypothesis: input.hypothesis,
    manifest_path: input.manifestPath,
    timeframe: input.timeframe,
    max_hold_bars: input.maxHoldBars,
    fee_bps: input.feeBps,
    slippage_bps: input.slippageBps,
    funding_bps_per_8h: input.fundingBpsPer8h,
    oos_split: input.oosSplitRatio,
    search_trial_count: input.searchTrialCount,
    indicator_report_path: input.indicatorReportPath,
    factor_compose: input.factorCompose,
    factor_discover: input.factorDiscover,
    factor_research_options: input.factorResearchOptions ? {
      horizon_bars: input.factorResearchOptions.horizonBars,
      lookback: input.factorResearchOptions.lookback,
      min_samples: input.factorResearchOptions.minSamples,
      min_abs_ic: input.factorResearchOptions.minAbsIc,
      max_correlation: input.factorResearchOptions.maxCorrelation,
      max_selected: input.factorResearchOptions.maxSelected,
    } : undefined,
    factor_seeds: factorConditionsToJson(input.factorSeeds || []),
    max_factors_per_candidate: input.maxFactorsPerCandidate,
    candidates: input.candidates.map((candidate) => ({
      candidate_id: candidate.candidateId,
      description: candidate.description,
      family: candidate.family,
      parameter_count: candidate.parameterCount,
      params: candidate.params,
    })),
  }
}

export function safeFileName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "rd-run"
}

export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function holdoutKeyForInput(input: StrategyRndLoopInput): string {
  const dataHash = replayDataHash(
    input.manifestPath,
    input.timeframe || "4h",
    supplementalDataRefsForInput(input),
  )
  return hashCanonical({ stage: "locked_holdout", data_hash: dataHash })
}

function supplementalDataRefsForInput(input: StrategyRndLoopInput): string[] {
  const refs = input.indicatorReportPath ? [input.indicatorReportPath] : []
  for (const candidate of input.candidates || []) {
    const params = candidate.params || {}
    const benchmark = stringField(params.benchmark_manifest_path)
    if (benchmark) refs.push(benchmark)
    for (const ref of readStrings(params.supplemental_data_refs)) {
      refs.push(ref)
    }
  }
  return Array.from(new Set(refs)).sort()
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function loadRndLedger(input: string | StrategyRndLedgerStore): StrategyRndLedgerRecord[] {
  return listCatalogStrategyRndRuns({
    catalogDbPath: rndCatalogDbPath(input),
    limit: 1000,
  }) as unknown as StrategyRndLedgerRecord[]
}

export function assertRunIdUnused(input: string | StrategyRndLedgerStore, runId: string): void {
  if (loadRndLedger(input).some((record) => record.run_id === runId)) {
    throw new Error(`strategy R&D run_id already exists: ${runId}`)
  }
}

export function assertHoldoutUnused(input: string | StrategyRndLedgerStore, holdoutKey: string): void {
  if (loadRndLedger(input).some((record) => record.holdout_key === holdoutKey)) {
    throw new Error("locked holdout has already been evaluated")
  }
}

export function appendRndLedgerRecord(input: StrategyRndLedgerStore, record: StrategyRndLedgerRecord): void {
  upsertCatalogStrategyRndRun({
    catalogDbPath: rndCatalogDbPath(input),
    record: record as unknown as Record<string, unknown>,
    now: record.created_at,
  })
}

export function appendJsonLine(path: string, value: unknown): void {
  appendRndLedgerRecord({ ledgerPath: path }, value as StrategyRndLedgerRecord)
}

function rndCatalogDbPath(input: string | StrategyRndLedgerStore): string {
  if (typeof input === "string") return defaultCatalogDbPathForGeneratedPath(input)
  if (input.catalogDbPath) return input.catalogDbPath
  if (input.ledgerPath) return defaultCatalogDbPathForGeneratedPath(input.ledgerPath)
  return "./data/data_catalog.db"
}
