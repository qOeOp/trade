import { loadCandlesFromManifest, loadManifest, replayStrategy } from "./replay-core"
import {
  composeFactorCandidates,
  type FactorFeatureStore,
} from "../../../strategy-family-engine/src/lib/factor-engine"
import { researchFactorSeeds, type FactorResearchReport } from "../../../strategy-family-engine/src/lib/factor-research"
import { getRndFamily } from "../../../strategy-family-engine/src/lib/rnd-family"
import { loadStrategyFeatureStore } from "../../../strategy-family-engine/src/lib/strategy-feature-store"
import { loadFundingEvents } from "./strategy-rnd-evaluation"
import type { CandidateSource, StrategyRndBatchInput, StrategyRndCandidateInput } from "./strategy-rnd-inputs"

export function loadStrategyRndFeatureStore(indicatorReportPath?: string): FactorFeatureStore {
  return loadStrategyFeatureStore(indicatorReportPath)
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
  const featureStore = loadStrategyRndFeatureStore(input.indicatorReportPath)
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
  const timeframe = input.timeframe || "4h"
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
      targets: setupReplay.trades.map((trade) => ({ timestamp: trade.signal_time, value: trade.r, regime: trade.regime })),
    },
  )
}
