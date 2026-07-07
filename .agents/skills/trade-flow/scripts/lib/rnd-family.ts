import { readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import type { ReplayStrategy } from "./replay-core"
import type { FactorFeatureStore } from "./factor-engine"

type JSONRecord = Record<string, unknown>

interface RndFamilyConfigured {
  strategy: ReplayStrategy
  rewardRisk: number
  params: JSONRecord
}

interface RndFamilyModule {
  id: string
  configure(strategyId: string, rawParams: JSONRecord, factorStore: FactorFeatureStore): RndFamilyConfigured
}

let cachedFamilies: Map<string, RndFamilyModule> | null = null

function loadRndFamilies(): Map<string, RndFamilyModule> {
  if (cachedFamilies) {
    return cachedFamilies
  }
  const require = createRequire(import.meta.url)
  const directory = join(import.meta.dir, "rnd-families")
  const families = new Map<string, RndFamilyModule>()
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".family.ts")).sort()) {
    const loaded = require(join(directory, file)) as { default?: RndFamilyModule; family?: RndFamilyModule }
    const family = loaded.default || loaded.family
    if (!family?.id || typeof family.configure !== "function") {
      throw new Error(`invalid R&D family module: ${file}`)
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
