import { loadFactorFeatureStore, type FactorFeatureStore } from "./factor-engine"

function loadStrategyFeatureStore(indicatorReportPath?: string): FactorFeatureStore {
  return indicatorReportPath ? loadFactorFeatureStore(indicatorReportPath) : emptyFeatureStore()
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
