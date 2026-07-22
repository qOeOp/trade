import type { ReplayStrategy } from "../../../../../replay-execution-plane/compatibility/legacy-research-contracts/src/lib/legacy-research-contracts"
import type { FactorFeatureStore } from "./factor-engine"
import fundingCarry from "./rnd-families/funding-carry.family"
import fundingUnwindRiskGuard from "./rnd-families/funding-unwind-risk-guard.family"
import relativeWeaknessMomentum from "./rnd-families/relative-weakness-momentum.family"
import structureBreakoutRetest from "./rnd-families/structure-breakout-retest.family"
import timeSeriesMomentum from "./rnd-families/time-series-momentum.family"
import trendPullback from "./rnd-families/trend-pullback.family"
import volatilityCompressionBreakout from "./rnd-families/volatility-compression-breakout.family"

type JSONRecord = Record<string, unknown>

interface RndFamilyConfigured {
  strategy: ReplayStrategy
  rewardRisk: number
  params: JSONRecord
  supplementalDataRefs?: string[]
}

interface RndFamilyModule {
  id: string
  configure(strategyId: string, rawParams: JSONRecord, factorStore: FactorFeatureStore): RndFamilyConfigured
}

const registeredFamilies: RndFamilyModule[] = [
  fundingCarry,
  fundingUnwindRiskGuard,
  relativeWeaknessMomentum,
  structureBreakoutRetest,
  timeSeriesMomentum,
  trendPullback,
  volatilityCompressionBreakout,
]

let cachedFamilies: Map<string, RndFamilyModule> | null = null

function loadRndFamilies(): Map<string, RndFamilyModule> {
  if (cachedFamilies) {
    return cachedFamilies
  }
  const families = new Map<string, RndFamilyModule>()
  for (const family of registeredFamilies) {
    if (!family?.id || typeof family.configure !== "function") {
      throw new Error("invalid statically registered R&D family module")
    }
    if (families.has(family.id)) {
      throw new Error(`duplicate R&D family id: ${family.id}`)
    }
    families.set(family.id, family)
  }
  cachedFamilies = families
  return families
}

function getRndFamily(id: string): RndFamilyModule {
  const family = loadRndFamilies().get(id)
  if (!family) {
    throw new Error(`unsupported R&D family: ${id}`)
  }
  return family
}

function listRndFamilyIds(): string[] {
  return Array.from(loadRndFamilies().keys()).sort()
}

export { getRndFamily, listRndFamilyIds, type RndFamilyConfigured, type RndFamilyModule }
