import { loadCandlesFromManifest, loadManifest, replayStrategy } from "../../../../../replay-execution-plane/compatibility/legacy-research-kernel/src/lib/replay-core"
import {
  composeFactorCandidates,
  type FactorFeatureStore,
  windowFactorFeatureStore,
} from "../../../strategy-family-engine/src/lib/factor-engine"
import { researchFactorSeeds, type FactorResearchReport } from "../../../strategy-family-engine/src/lib/factor-research"
import { getRndFamily } from "../../../strategy-family-engine/src/lib/rnd-family"
import { loadStrategyFeatureStore } from "../../../strategy-family-engine/src/lib/strategy-feature-store"
import { loadFundingEvents } from "./strategy-rnd-evaluation"
import { manifestTimeWindow } from "./strategy-rnd-time-window"
import type { CandidateSource, StrategyRndBatchInput, StrategyRndCandidateInput } from "./strategy-rnd-inputs"

export function loadStrategyRndFeatureStore(indicatorReportPath?: string, manifestPath?: string, timeframe = "4h"): FactorFeatureStore {
  const store = loadStrategyFeatureStore(indicatorReportPath)
  if (!indicatorReportPath) return store
  const window = manifestPath ? manifestTimeWindow(manifestPath, timeframe) : undefined
  return window ? windowFactorFeatureStore(store, window) : store
}

export function assertUniqueCandidateIds(candidates: StrategyRndCandidateInput[]): void {
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!candidate.candidateId || seen.has(candidate.candidateId)) {
      throw new Error(`strategy R&D candidate_id must be unique: ${candidate.candidateId || "<empty>"}`)
    }
    seen.add(candidate.candidateId)
  }
}

export function resolveRndCandidates(
  input: StrategyRndBatchInput,
  factorResearch: FactorResearchReport | null,
): { candidates: StrategyRndCandidateInput[]; source: CandidateSource } {
  const bases = input.candidates
  const trialLimit = Number.isInteger(input.searchTrialCount) && Number(input.searchTrialCount) > 0 ? Number(input.searchTrialCount) : undefined
  if (!input.factorCompose) {
    return {
      candidates: trialLimit ? bases.slice(0, trialLimit) : bases,
      source: "provided",
    }
  }
  const seeds = input.factorSeeds && input.factorSeeds.length > 0 ? input.factorSeeds : factorResearch?.seeds || []
  const candidates = composeFactorCandidates(bases, seeds, {
    maxCandidates: 10,
    maxFactorsPerCandidate: input.maxFactorsPerCandidate,
    maxParameterCount: 8,
  }) as StrategyRndCandidateInput[]
  return { candidates: trialLimit ? candidates.slice(0, trialLimit) : candidates, source: factorResearch ? "scientific_factor_discovery" : "bounded_factor_composition" }
}

export function resolveCandidateCount(input: StrategyRndBatchInput): number {
  const featureStore = loadStrategyRndFeatureStore(input.indicatorReportPath, input.manifestPath, input.timeframe || "4h")
  const count = resolveRndCandidates(input, buildFactorResearch(input, featureStore)).candidates.length
  if (count === 0 && !input.factorDiscover) {
    throw new Error("strategy R&D campaign hypothesis requires at least one candidate")
  }
  return count
}

export function buildFactorResearch(input: StrategyRndBatchInput, featureStore: FactorFeatureStore): FactorResearchReport | null {
  if (!input.factorDiscover || !input.indicatorReportPath) {
    return null
  }
  if (input.candidates.length !== 1) {
    throw new Error("setup-conditioned factor discovery requires exactly one base candidate")
  }
  if (input.antiOverfitStage === "external_validation" || input.antiOverfitStage === "locked_holdout") {
    throw new Error("factor discovery is forbidden on external validation and locked holdout datasets")
  }
  const timeframe = input.timeframe || "4h"
  const featureCausality = featureStore.causality(timeframe)
  if (featureCausality?.status !== "passed") {
    throw new Error("factor discovery requires passed provider-native feature causality evidence")
  }
  const base = input.candidates[0]
  const configured = getRndFamily(base.family || "trend_pullback_v1").configure(base.candidateId, base.params || {}, featureStore)
  const setupReplay = replayStrategy(configured.strategy, {
    manifestPath: input.manifestPath,
    timeframe,
    maxHoldBars: input.maxHoldBars,
    rewardRisk: configured.rewardRisk,
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    fundingBpsPer8h: input.fundingBpsPer8h,
    fundingEvents: loadFundingEvents(input.indicatorReportPath),
  })
  const selection = purgedFactorSelectionTargets(setupReplay.trades, input.oosSplitRatio ?? 0.3)
  return researchFactorSeeds(
    featureStore,
    loadCandlesFromManifest(
      input.manifestPath,
      loadManifest(input.manifestPath),
      timeframe,
    ),
    timeframe,
    {
      ...input.factorResearchOptions,
      targets: selection.targets,
      selectionScope: selection.scope,
    },
  )
}

function purgedFactorSelectionTargets(
  trades: Array<{ signal_time: string; exit_time: string; r: number; regime: string }>,
  oosRatio: number,
): {
  targets: Array<{ timestamp: string; value: number; regime: string }>
  scope: FactorResearchReport["selection_scope"]
} {
  if (!Number.isFinite(oosRatio) || oosRatio <= 0 || oosRatio >= 1) {
    throw new Error("factor discovery requires oos_split strictly between 0 and 1")
  }
  if (trades.length < 2) {
    return {
      targets: [],
      scope: {
        method: "purged_chronological_trade_split_v1",
        purge_rule: "label_end_strictly_before_oos_start",
        train_end_at: null,
        oos_start_at: trades[0]?.signal_time ?? null,
        total_target_count: trades.length,
        selected_target_count: 0,
        purged_overlap_count: 0,
        oos_target_count: trades.length,
      },
    }
  }
  const splitIndex = Math.max(1, Math.min(trades.length - 1, Math.floor(trades.length * (1 - oosRatio))))
  const oosStart = trades[splitIndex].signal_time
  const eligibleTrain = trades.slice(0, splitIndex)
  const selected = eligibleTrain.filter((trade) => Date.parse(trade.exit_time) < Date.parse(oosStart))
  return {
    targets: selected.map((trade) => ({ timestamp: trade.signal_time, value: trade.r, regime: trade.regime })),
    scope: {
      method: "purged_chronological_trade_split_v1",
      purge_rule: "label_end_strictly_before_oos_start",
      train_end_at: selected.at(-1)?.signal_time ?? null,
      oos_start_at: oosStart,
      total_target_count: trades.length,
      selected_target_count: selected.length,
      purged_overlap_count: eligibleTrain.length - selected.length,
      oos_target_count: trades.length - splitIndex,
    },
  }
}
