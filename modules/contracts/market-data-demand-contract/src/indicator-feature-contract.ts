import { canonicalHash } from "../../runtime-core/src/canonical-json"

export const INDICATOR_FEATURE_ARTIFACT_SCHEMA = "trade.indicator-feature-artifact.v1" as const
export const SUPPORTED_INDICATOR_SET_REFS = [
  "indicator-set:technical-default-v1",
  "indicator-set:factor-series-default-v1",
] as const

export type SupportedIndicatorSetRef = typeof SUPPORTED_INDICATOR_SET_REFS[number]

export interface IndicatorFeatureArtifact {
  schema_version: typeof INDICATOR_FEATURE_ARTIFACT_SCHEMA
  feature_set_ref: SupportedIndicatorSetRef
  source: {
    slice_ref: string
    content_sha256: string
    symbol: string
    timeframe: string
    first_open_time: number
    last_open_time: number
  }
  selected_indicators: unknown[]
  timeframe_result: Record<string, unknown>
  summary: Record<string, unknown>
  content_hash: string
}

export function buildIndicatorFeatureArtifact(input: {
  feature_set_ref: string
  source: IndicatorFeatureArtifact["source"]
  provider_report: unknown
}): IndicatorFeatureArtifact {
  const featureSetRef = supportedSet(input.feature_set_ref)
  const source = compileSource(input.source)
  const report = record(input.provider_report, "provider_report")
  const reportSymbol = normalizeSymbol(text(report.symbol, "provider_report.symbol"))
  if (reportSymbol !== source.symbol) throw new Error("indicator provider symbol drifted")
  const timeframes = record(report.timeframes, "provider_report.timeframes")
  const timeframeResult = record(timeframes[source.timeframe], `provider_report.timeframes.${source.timeframe}`)
  if (Object.keys(timeframes).length !== 1) throw new Error("indicator provider emitted undeclared timeframes")
  const selectedIndicators = array(report.selected_indicators, "provider_report.selected_indicators")
  const summary = record(report.summary, "provider_report.summary")
  const withoutHash = {
    schema_version: INDICATOR_FEATURE_ARTIFACT_SCHEMA,
    feature_set_ref: featureSetRef,
    source,
    selected_indicators: selectedIndicators,
    timeframe_result: timeframeResult,
    summary,
  }
  return { ...withoutHash, content_hash: canonicalHash(withoutHash) }
}

export function compileIndicatorFeatureArtifact(value: unknown): IndicatorFeatureArtifact {
  const input = record(value, "indicator_feature_artifact")
  exact(input, [
    "schema_version", "feature_set_ref", "source", "selected_indicators",
    "timeframe_result", "summary", "content_hash",
  ], "indicator_feature_artifact")
  if (input.schema_version !== INDICATOR_FEATURE_ARTIFACT_SCHEMA) {
    throw new Error("indicator feature artifact schema is unsupported")
  }
  const withoutHash = {
    schema_version: INDICATOR_FEATURE_ARTIFACT_SCHEMA,
    feature_set_ref: supportedSet(input.feature_set_ref),
    source: compileSource(input.source),
    selected_indicators: array(input.selected_indicators, "selected_indicators"),
    timeframe_result: record(input.timeframe_result, "timeframe_result"),
    summary: record(input.summary, "summary"),
  }
  if (!/^[a-f0-9]{64}$/.test(String(input.content_hash))
    || canonicalHash(withoutHash) !== input.content_hash) {
    throw new Error("indicator feature artifact content_hash drifted")
  }
  return { ...withoutHash, content_hash: String(input.content_hash) }
}

export function indicatorProviderArgs(featureSetRefValue: string): string[] {
  const featureSetRef = supportedSet(featureSetRefValue)
  return featureSetRef === "indicator-set:factor-series-default-v1"
    ? ["--indicators", "all", "--feature-series"]
    : ["--indicators", "all"]
}

function compileSource(value: unknown): IndicatorFeatureArtifact["source"] {
  const input = record(value, "source")
  exact(input, [
    "slice_ref", "content_sha256", "symbol", "timeframe", "first_open_time", "last_open_time",
  ], "source")
  const contentSha256 = sha256(input.content_sha256, "source.content_sha256")
  if (input.slice_ref !== `market-data://candle-slice/${contentSha256}`) {
    throw new Error("indicator feature source slice_ref drifted")
  }
  const symbol = text(input.symbol, "source.symbol")
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error("indicator feature source symbol is invalid")
  const timeframe = text(input.timeframe, "source.timeframe")
  if (!/^(?:1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d)$/.test(timeframe)) {
    throw new Error("indicator feature source timeframe is unsupported")
  }
  const firstOpenTime = timestamp(input.first_open_time, "source.first_open_time")
  const lastOpenTime = timestamp(input.last_open_time, "source.last_open_time")
  if (lastOpenTime < firstOpenTime) throw new Error("indicator feature source range is invalid")
  return {
    slice_ref: String(input.slice_ref),
    content_sha256: contentSha256,
    symbol,
    timeframe,
    first_open_time: firstOpenTime,
    last_open_time: lastOpenTime,
  }
}

function supportedSet(value: unknown): SupportedIndicatorSetRef {
  if (typeof value !== "string" || !SUPPORTED_INDICATOR_SET_REFS.includes(value as SupportedIndicatorSetRef)) {
    throw new Error("indicator_set_ref is unsupported")
  }
  return value as SupportedIndicatorSetRef
}

function normalizeSymbol(value: string): string {
  return value.toUpperCase().replaceAll("/", "").replaceAll(":", "").replaceAll("-", "").replaceAll("_", "")
    .replace(/USDTUSDT$/, "USDT")
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > 1_000) throw new Error(`${field} must be a bounded array`)
  return value
}

function exact(value: Record<string, unknown>, fields: string[], field: string): void {
  const expected = new Set(fields)
  if (Object.keys(value).some((key) => !expected.has(key)) || fields.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${field} shape drifted`)
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) throw new Error(`${field} is invalid`)
  return value
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

function timestamp(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} is invalid`)
  return Number(value)
}
