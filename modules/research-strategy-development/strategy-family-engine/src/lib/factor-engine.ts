import { readFileSync } from "node:fs"

type JSONRecord = Record<string, unknown>
type FactorTransform = "level" | "delta" | "slope" | "zscore" | "percentile"
type FactorConditionOp = "gt" | "lt" | "between"

interface FactorCondition {
  factorId: string
  timeframe?: string
  role: "regime" | "filter" | "confirmation" | "trigger" | "timing" | "risk" | "location"
  transform: FactorTransform
  lookback: number
  op: FactorConditionOp
  value?: number
  min?: number
  max?: number
}

interface FactorSeriesDefinition {
  factor_id: string
  source_indicator: string
  output: string
  category: string
  roles: string[]
  allowed_transforms: FactorTransform[]
  legacy_alias: string
}

interface FactorFeatureStore {
  definitions(): FactorSeriesDefinition[]
  series(timeframe: string, factorId: string): { timestamps: string[]; values: number[] } | undefined
  read(timeframe: string, factorId: string, timestamp: string, transform?: FactorTransform, lookback?: number): number | undefined
}

interface FactorFeatureWindow {
  firstTimestampMs: number
  lastTimestampMs: number
}

interface FactorComposableCandidate {
  candidateId: string
  description?: string
  family?: string
  parameterCount?: number
  params?: JSONRecord
}

interface FactorCompositionOptions {
  maxCandidates?: number
  maxFactorsPerCandidate?: number
  maxParameterCount?: number
}

interface FactorSeries {
  definition: FactorSeriesDefinition
  timestamps: string[]
  values: number[]
  indexByTimestamp: Map<string, number>
}

interface WindowedFactorSeries {
  timestamps: string[]
  values: number[]
  indexByTimestamp: Map<string, number>
}

function loadFactorFeatureStore(path: string): FactorFeatureStore {
  const report = asRecord(JSON.parse(readFileSync(path, "utf8")))
  const timeframes = asRecord(asRecord(report.data).timeframes)
  const series = new Map<string, FactorSeries>()
  const aliases = new Map<string, string>()

  for (const [timeframe, rawFrame] of Object.entries(timeframes)) {
    const features = asRecord(asRecord(rawFrame).features)
    for (const [rawId, rawFeature] of Object.entries(features)) {
      const feature = asRecord(rawFeature)
      if (stringField(feature.status) !== "ok") {
        continue
      }
      const factorId = stringField(feature.factor_id) || rawId
      const points = Array.isArray(feature.values) ? feature.values : []
      const timestamps: string[] = []
      const values: number[] = []
      for (const rawPoint of points) {
        const point = asRecord(rawPoint)
        const timestamp = stringField(point.timestamp)
        const value = finiteNumber(point.value)
        if (timestamp && value !== undefined) {
          timestamps.push(timestamp)
          values.push(value)
        }
      }
      const definition: FactorSeriesDefinition = {
        factor_id: factorId,
        source_indicator: stringField(feature.source_indicator) || rawId.split(".")[0],
        output: stringField(feature.output) || "value",
        category: stringField(feature.category),
        roles: readStrings(feature.roles),
        allowed_transforms: readTransforms(feature.allowed_transforms),
        legacy_alias: stringField(feature.legacy_alias),
      }
      const item: FactorSeries = {
        definition,
        timestamps,
        values,
        indexByTimestamp: new Map(timestamps.map((timestamp, index) => [timestamp, index])),
      }
      series.set(`${timeframe}:${factorId}`, item)
      if (definition.legacy_alias) {
        aliases.set(`${timeframe}:${definition.legacy_alias}`, factorId)
      }
    }
  }

  return {
    definitions() {
      const unique = new Map<string, FactorSeriesDefinition>()
      for (const item of series.values()) {
        unique.set(item.definition.factor_id, item.definition)
      }
      return Array.from(unique.values()).sort((a, b) => a.factor_id.localeCompare(b.factor_id))
    },
    series(timeframe, rawFactorId) {
      const factorId = aliases.get(`${timeframe}:${rawFactorId}`) || rawFactorId
      const item = series.get(`${timeframe}:${factorId}`)
      return item ? { timestamps: [...item.timestamps], values: [...item.values] } : undefined
    },
    read(timeframe, rawFactorId, timestamp, transform = "level", lookback = 1) {
      const factorId = aliases.get(`${timeframe}:${rawFactorId}`) || rawFactorId
      const item = series.get(`${timeframe}:${factorId}`)
      if (!item) {
        return undefined
      }
      const index = item.indexByTimestamp.get(timestamp)
      if (index === undefined) {
        return undefined
      }
      return transformFactor(item.values, index, transform, lookback)
    },
  }
}

function windowFactorFeatureStore(store: FactorFeatureStore, window: FactorFeatureWindow): FactorFeatureStore {
  const cache = new Map<string, WindowedFactorSeries | null>()

  function boundedSeries(timeframe: string, factorId: string): WindowedFactorSeries | undefined {
    const key = `${timeframe}:${factorId}`
    if (cache.has(key)) {
      return cache.get(key) || undefined
    }
    const raw = store.series(timeframe, factorId)
    if (!raw) {
      cache.set(key, null)
      return undefined
    }
    const timestamps: string[] = []
    const values: number[] = []
    raw.timestamps.forEach((timestamp, index) => {
      if (timestampInWindow(timestamp, window)) {
        timestamps.push(timestamp)
        values.push(raw.values[index])
      }
    })
    const bounded = { timestamps, values, indexByTimestamp: new Map(timestamps.map((timestamp, index) => [timestamp, index])) }
    cache.set(key, bounded)
    return bounded
  }
  return {
    definitions() {
      return store.definitions()
    },
    series(timeframe, factorId) {
      const bounded = boundedSeries(timeframe, factorId)
      return bounded ? { timestamps: [...bounded.timestamps], values: [...bounded.values] } : undefined
    },
    read(timeframe, factorId, timestamp, transform = "level", lookback = 1) {
      if (!timestampInWindow(timestamp, window)) return undefined
      const bounded = boundedSeries(timeframe, factorId)
      if (!bounded) return undefined
      const index = bounded.indexByTimestamp.get(timestamp)
      if (index === undefined) return undefined
      return transformFactor(bounded.values, index, transform, lookback)
    },
  }
}

function timestampInWindow(timestamp: string, window: FactorFeatureWindow): boolean {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) && parsed >= window.firstTimestampMs && parsed <= window.lastTimestampMs
}

function transformFactor(values: number[], index: number, transform: FactorTransform, rawLookback: number): number | undefined {
  const current = values[index]
  if (!Number.isFinite(current)) {
    return undefined
  }
  if (transform === "level") {
    return current
  }
  const lookback = Math.max(1, Math.floor(rawLookback))
  if (transform === "delta" || transform === "slope") {
    const previous = values[index - lookback]
    if (!Number.isFinite(previous)) {
      return undefined
    }
    return transform === "delta" ? current - previous : (current - previous) / lookback
  }
  const start = index - lookback + 1
  if (start < 0) {
    return undefined
  }
  const window = values.slice(start, index + 1)
  if (window.length < 2 || window.some((value) => !Number.isFinite(value))) {
    return undefined
  }
  if (transform === "percentile") {
    return window.filter((value) => value <= current).length / window.length
  }
  const mean = window.reduce((sum, value) => sum + value, 0) / window.length
  const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length
  const deviation = Math.sqrt(variance)
  return deviation > 0 ? (current - mean) / deviation : undefined
}

function passesFactorConditions(
  conditions: FactorCondition[],
  store: FactorFeatureStore,
  defaultTimeframe: string,
  timestamp: string,
): boolean {
  return conditions.every((condition) => {
    const observed = store.read(
      condition.timeframe || defaultTimeframe,
      condition.factorId,
      timestamp,
      condition.transform,
      condition.lookback,
    )
    if (!Number.isFinite(observed)) {
      return false
    }
    if (condition.op === "gt") {
      return Number(observed) > Number(condition.value)
    }
    if (condition.op === "lt") {
      return Number(observed) < Number(condition.value)
    }
    return Number(observed) >= Number(condition.min) && Number(observed) <= Number(condition.max)
  })
}

function readFactorConditions(value: unknown): FactorCondition[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((raw) => {
    const item = asRecord(raw)
    const op = readOp(item.op)
    return {
      factorId: stringField(item.factor_id),
      timeframe: stringField(item.timeframe) || undefined,
      role: readRole(item.role),
      transform: readTransform(item.transform),
      lookback: positiveInteger(item.lookback, 1),
      op,
      value: finiteNumber(item.value),
      min: finiteNumber(item.min),
      max: finiteNumber(item.max),
    }
  }).filter((condition) => condition.factorId && validCondition(condition))
}

function factorConditionsToJson(conditions: FactorCondition[]): JSONRecord[] {
  return conditions.map((condition) => ({
    factor_id: condition.factorId,
    timeframe: condition.timeframe,
    role: condition.role,
    transform: condition.transform,
    lookback: condition.lookback,
    op: condition.op,
    value: condition.value,
    min: condition.min,
    max: condition.max,
  }))
}

function composeFactorCandidates(
  bases: FactorComposableCandidate[],
  seeds: FactorCondition[],
  options: FactorCompositionOptions = {},
): FactorComposableCandidate[] {
  const maxCandidates = Math.min(10, Math.max(1, options.maxCandidates ?? 10))
  const maxFactors = Math.min(3, Math.max(1, options.maxFactorsPerCandidate ?? 2))
  const maxParameters = Math.min(8, Math.max(1, options.maxParameterCount ?? 8))
  const combinations = buildConditionCombinations(dedupeConditions(seeds), maxFactors)
  const candidates: FactorComposableCandidate[] = []

  for (const base of bases) {
    const baseParameterCount = base.parameterCount ?? countScalarParameters(base.params || {})
    for (const conditions of combinations) {
      const parameterCount = baseParameterCount + conditions.reduce((sum, condition) => sum + factorConditionParameterCount(condition), 0)
      if (parameterCount > maxParameters) {
        continue
      }
      const suffix = conditions.map(conditionSlug).join("-")
      candidates.push({
        ...base,
        candidateId: `${base.candidateId}-${suffix}`,
        description: `${base.description || base.candidateId} with ${conditions.map((condition) => condition.factorId).join(" + ")}`,
        parameterCount,
        params: {
          ...(base.params || {}),
          factor_conditions: factorConditionsToJson(conditions),
        },
      })
      if (candidates.length >= maxCandidates) {
        return candidates
      }
    }
  }
  return candidates
}

function conditionSlug(condition: FactorCondition): string {
  return safeId([
    condition.factorId,
    condition.timeframe,
    condition.transform,
    condition.lookback,
    condition.op,
    condition.value,
    condition.min,
    condition.max,
  ].filter((value) => value !== undefined).join("-"))
}

function buildConditionCombinations(conditions: FactorCondition[], maxFactors: number): FactorCondition[][] {
  const result: FactorCondition[][] = []
  function visit(start: number, current: FactorCondition[]): void {
    if (current.length > 0) {
      result.push([...current])
    }
    if (current.length >= maxFactors) {
      return
    }
    for (let index = start; index < conditions.length; index += 1) {
      const condition = conditions[index]
      if (current.some((item) => item.factorId === condition.factorId || item.role === condition.role)) {
        continue
      }
      current.push(condition)
      visit(index + 1, current)
      current.pop()
    }
  }
  visit(0, [])
  return result
}

function factorConditionParameterCount(condition: FactorCondition): number {
  const thresholds = condition.op === "between" ? 2 : 1
  return thresholds + (condition.transform === "level" ? 0 : 1)
}

function dedupeConditions(conditions: FactorCondition[]): FactorCondition[] {
  const seen = new Set<string>()
  return conditions.filter((condition) => {
    const key = JSON.stringify(factorConditionsToJson([condition])[0])
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function countScalarParameters(params: JSONRecord): number {
  return Object.values(params).filter((value) => value !== undefined && value !== null && value !== "" && !Array.isArray(value)).length
}

function validCondition(condition: FactorCondition): boolean {
  return condition.op === "between"
    ? condition.min !== undefined && condition.max !== undefined
    : condition.value !== undefined
}

function readTransforms(value: unknown): FactorTransform[] {
  if (!Array.isArray(value)) {
    return ["level", "delta", "slope", "zscore", "percentile"]
  }
  return value.map(readTransform).filter((item, index, all) => all.indexOf(item) === index)
}

function readTransform(value: unknown): FactorTransform {
  return value === "delta" || value === "slope" || value === "zscore" || value === "percentile" ? value : "level"
}

function readOp(value: unknown): FactorConditionOp {
  return value === "lt" || value === "between" ? value : "gt"
}

function readRole(value: unknown): FactorCondition["role"] {
  return value === "regime" || value === "confirmation" || value === "trigger" || value === "timing" || value === "risk" || value === "location"
    ? value
    : "filter"
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")
}

export {
  composeFactorCandidates,
  factorConditionParameterCount,
  factorConditionsToJson,
  loadFactorFeatureStore,
  passesFactorConditions,
  readFactorConditions,
  transformFactor,
  windowFactorFeatureStore,
  type FactorComposableCandidate,
  type FactorCondition,
  type FactorFeatureStore,
  type FactorFeatureWindow,
  type FactorSeriesDefinition,
  type FactorTransform,
}
