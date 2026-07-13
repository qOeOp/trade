import { loadFactorFeatureStore, type FactorFeatureStore } from "./factor-engine"

const featureStoreCache = new Map<string, FactorFeatureStore>()

function loadStrategyFeatureStore(indicatorReportPath?: string): FactorFeatureStore {
  if (!indicatorReportPath) return emptyFeatureStore()
  const cached = featureStoreCache.get(indicatorReportPath)
  if (cached) return cached
  const store = loadFactorFeatureStore(indicatorReportPath)
  featureStoreCache.set(indicatorReportPath, store)
  return store
}

function emptyFeatureStore(): FactorFeatureStore {
  return {
    definitions() {
      return []
    },
    series() {
      return undefined
    },
    read() {
      return undefined
    },
  }
}

export { emptyFeatureStore, loadStrategyFeatureStore }
