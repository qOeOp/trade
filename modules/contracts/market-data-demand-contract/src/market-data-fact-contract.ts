import { canonicalHash } from "../../runtime-core/src/canonical-json"
import { SUPPORTED_INDICATOR_SET_REFS, type SupportedIndicatorSetRef } from "./indicator-feature-contract"
import { timeframeMilliseconds } from "./ohlcv-coverage-contract"

export const MARKET_DATA_FACT_REF_SCHEMA = "trade.market-data-fact-ref.v1" as const
export const MARKET_DATA_FACT_REF_SCHEMA_V2 = "trade.market-data-fact-ref.v2" as const

export type MarketDataFactProduct = "l2_book" | "ohlcv" | "indicator_set" | "funding_events"

export interface MarketDataFactRef {
  schema_version: typeof MARKET_DATA_FACT_REF_SCHEMA | typeof MARKET_DATA_FACT_REF_SCHEMA_V2
  product: MarketDataFactProduct
  venue: "binance_usdm"
  symbol: string
  requirement: {
    timeframe: string | null
    indicator_set_ref: SupportedIndicatorSetRef | null
    minimum_depth: number | null
  }
  consumer_binding: {
    demand_ids: string[]
    source_plan_hash: string
  }
  source: {
    ref: string
    content_hash: string
  }
  coverage: {
    kind: "point" | "half_open"
    start_at: string
    end_at: string | null
    completeness: "live_point" | "complete"
  }
  freshness: {
    kind: "live" | "immutable"
    as_of: string
    observed_at: string
    max_freshness_ms: number | null
    status: "fresh" | "not_applicable"
  }
  domain_authority: "none"
  fact_hash: string
}

export function buildMarketDataFactRef(
  input: Omit<MarketDataFactRef, "schema_version" | "domain_authority" | "fact_hash" | "product"> & {
    product: Exclude<MarketDataFactProduct, "funding_events">
  },
): MarketDataFactRef {
  const compiled = compileBody({
    schema_version: MARKET_DATA_FACT_REF_SCHEMA,
    ...input,
    domain_authority: "none",
  })
  return { ...compiled, fact_hash: canonicalHash(compiled) }
}

export function buildMarketDataFactRefV2(
  input: Omit<MarketDataFactRef, "schema_version" | "domain_authority" | "fact_hash">,
): MarketDataFactRef {
  const compiled = compileBody({
    schema_version: MARKET_DATA_FACT_REF_SCHEMA_V2,
    ...input,
    domain_authority: "none",
  })
  return { ...compiled, fact_hash: canonicalHash(compiled) }
}

export function compileMarketDataFactRef(value: unknown): MarketDataFactRef {
  const input = record(value, "market_data_fact_ref")
  exact(input, [
    "schema_version", "product", "venue", "symbol", "requirement", "consumer_binding",
    "source", "coverage", "freshness", "domain_authority", "fact_hash",
  ], "market_data_fact_ref")
  const { fact_hash: factHashValue, ...bodyValue } = input
  const body = compileBody(bodyValue)
  const factHash = hash(factHashValue, "fact_hash")
  if (canonicalHash(body) !== factHash) throw new Error("market data fact hash drifted")
  return { ...body, fact_hash: factHash }
}

function compileBody(value: unknown): Omit<MarketDataFactRef, "fact_hash"> {
  const input = record(value, "market_data_fact_ref")
  exact(input, [
    "schema_version", "product", "venue", "symbol", "requirement", "consumer_binding",
    "source", "coverage", "freshness", "domain_authority",
  ], "market_data_fact_ref")
  const schemaVersion = oneOf(input.schema_version, [
    MARKET_DATA_FACT_REF_SCHEMA,
    MARKET_DATA_FACT_REF_SCHEMA_V2,
  ] as const, "schema_version")
  if (input.venue !== "binance_usdm") throw new Error("market data fact venue is unsupported")
  if (input.domain_authority !== "none") throw new Error("market data fact cannot grant domain authority")
  const product = oneOf(
    input.product,
    schemaVersion === MARKET_DATA_FACT_REF_SCHEMA
      ? ["l2_book", "ohlcv", "indicator_set"] as const
      : ["l2_book", "ohlcv", "indicator_set", "funding_events"] as const,
    "product",
  )
  const symbol = text(input.symbol, "symbol", 20)
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error("market data fact symbol is invalid")

  const requirementInput = record(input.requirement, "requirement")
  exact(requirementInput, ["timeframe", "indicator_set_ref", "minimum_depth"], "requirement")
  const timeframe = nullableText(requirementInput.timeframe, "requirement.timeframe", 8)
  if (timeframe != null) timeframeMilliseconds(timeframe)
  const indicatorSetRef = nullableIndicatorSet(requirementInput.indicator_set_ref)
  const minimumDepth = nullableInteger(requirementInput.minimum_depth, 1, 100, "requirement.minimum_depth")
  if (product === "l2_book" && (timeframe != null || indicatorSetRef != null || minimumDepth == null)) {
    throw new Error("L2 fact requirement shape drifted")
  }
  if (product === "ohlcv" && (timeframe == null || indicatorSetRef != null || minimumDepth != null)) {
    throw new Error("OHLCV fact requirement shape drifted")
  }
  if (product === "indicator_set" && (timeframe == null || indicatorSetRef == null || minimumDepth != null)) {
    throw new Error("indicator fact requirement shape drifted")
  }
  if (product === "funding_events" && (timeframe != null || indicatorSetRef != null || minimumDepth != null)) {
    throw new Error("funding fact requirement shape drifted")
  }

  const bindingInput = record(input.consumer_binding, "consumer_binding")
  exact(bindingInput, ["demand_ids", "source_plan_hash"], "consumer_binding")
  const demandIds = sortedUniqueStrings(bindingInput.demand_ids, "consumer_binding.demand_ids", 100)
  if (demandIds.length === 0) throw new Error("market data fact must bind at least one demand")
  const sourcePlanHash = hash(bindingInput.source_plan_hash, "consumer_binding.source_plan_hash")

  const sourceInput = record(input.source, "source")
  exact(sourceInput, ["ref", "content_hash"], "source")
  const source = {
    ref: text(sourceInput.ref, "source.ref", 1_024),
    content_hash: hash(sourceInput.content_hash, "source.content_hash"),
  }

  const coverageInput = record(input.coverage, "coverage")
  exact(coverageInput, ["kind", "start_at", "end_at", "completeness"], "coverage")
  const coverageKind = oneOf(coverageInput.kind, ["point", "half_open"] as const, "coverage.kind")
  const coverageStart = canonicalTime(coverageInput.start_at, "coverage.start_at")
  const coverageEnd = nullableCanonicalTime(coverageInput.end_at, "coverage.end_at")
  const completeness = oneOf(coverageInput.completeness, ["live_point", "complete"] as const, "coverage.completeness")
  if (coverageKind === "point" && (coverageEnd != null || completeness !== "live_point")) {
    throw new Error("point coverage shape drifted")
  }
  if (coverageKind === "half_open"
    && (coverageEnd == null || Date.parse(coverageEnd) <= Date.parse(coverageStart) || completeness !== "complete")) {
    throw new Error("half-open coverage shape drifted")
  }

  const freshnessInput = record(input.freshness, "freshness")
  exact(freshnessInput, ["kind", "as_of", "observed_at", "max_freshness_ms", "status"], "freshness")
  const freshnessKind = oneOf(freshnessInput.kind, ["live", "immutable"] as const, "freshness.kind")
  const asOf = canonicalTime(freshnessInput.as_of, "freshness.as_of")
  const observedAt = canonicalTime(freshnessInput.observed_at, "freshness.observed_at")
  if (Date.parse(asOf) > Date.parse(observedAt)) throw new Error("market data fact is observed before its source")
  const maxFreshnessMs = nullableInteger(freshnessInput.max_freshness_ms, 100, 86_400_000, "freshness.max_freshness_ms")
  const freshnessStatus = oneOf(freshnessInput.status, ["fresh", "not_applicable"] as const, "freshness.status")
  if (freshnessKind === "live") {
    if (maxFreshnessMs == null || freshnessStatus !== "fresh"
      || Date.parse(observedAt) - Date.parse(asOf) > maxFreshnessMs) {
      throw new Error("live market data fact exceeds its consumer freshness binding")
    }
  } else if (maxFreshnessMs != null || freshnessStatus !== "not_applicable") {
    throw new Error("immutable market data fact freshness shape drifted")
  }
  if (product === "l2_book" && (coverageKind !== "point" || freshnessKind !== "live")) {
    throw new Error("L2 market data fact must be a fresh live point")
  }
  if (product !== "l2_book" && (coverageKind !== "half_open" || freshnessKind !== "immutable")) {
    throw new Error("historical market data fact must bind immutable complete coverage")
  }

  return {
    schema_version: schemaVersion,
    product,
    venue: "binance_usdm",
    symbol,
    requirement: {
      timeframe,
      indicator_set_ref: indicatorSetRef,
      minimum_depth: minimumDepth,
    },
    consumer_binding: {
      demand_ids: demandIds,
      source_plan_hash: sourcePlanHash,
    },
    source,
    coverage: {
      kind: coverageKind,
      start_at: coverageStart,
      end_at: coverageEnd,
      completeness,
    },
    freshness: {
      kind: freshnessKind,
      as_of: asOf,
      observed_at: observedAt,
      max_freshness_ms: maxFreshnessMs,
      status: freshnessStatus,
    },
    domain_authority: "none",
  }
}

function nullableIndicatorSet(value: unknown): SupportedIndicatorSetRef | null {
  if (value == null) return null
  if (typeof value !== "string" || !SUPPORTED_INDICATOR_SET_REFS.includes(value as SupportedIndicatorSetRef)) {
    throw new Error("requirement.indicator_set_ref is unsupported")
  }
  return value as SupportedIndicatorSetRef
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, fields: string[], field: string): void {
  const expected = new Set(fields)
  if (Object.keys(value).some((key) => !expected.has(key)) || fields.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${field} shape drifted`)
  }
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value as T[number])) throw new Error(`${field} is unsupported`)
  return value as T[number]
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) throw new Error(`${field} is invalid`)
  return value
}

function nullableText(value: unknown, field: string, maximum: number): string | null {
  return value == null ? null : text(value, field, maximum)
}

function hash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

function canonicalTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC time`)
  }
  return value
}

function nullableCanonicalTime(value: unknown, field: string): string | null {
  return value == null ? null : canonicalTime(value, field)
}

function nullableInteger(value: unknown, minimum: number, maximum: number, field: string): number | null {
  if (value == null) return null
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

function sortedUniqueStrings(value: unknown, field: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${field} must be a bounded array`)
  const items = value.map((item, index) => text(item, `${field}[${index}]`, 256))
  const canonical = [...new Set(items)].sort()
  if (canonical.length !== items.length || canonical.some((item, index) => item !== items[index])) {
    throw new Error(`${field} must be sorted and unique`)
  }
  return canonical
}
