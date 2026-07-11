#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { fetchBrkFactors, fetchDeribitDvol } from "./external-features"
import { fetchVisionFeatures, type Point, type VisionFeatures } from "./vision-archive"

type JSONRecord = Record<string, unknown>
type FetchJSON = (url: string) => Promise<unknown>

interface Config { symbol: string; timeframe: string; sinceTS: number; baseReport: string; metricsSource: "vision" | "rest"; microstructureDays: number; external: boolean }

async function runMarketFeatures(argv: string[], fetchJSON: FetchJSON = defaultFetch): Promise<JSONRecord> {
  const config = parseArgs(argv)
  const report = JSON.parse(readFileSync(config.baseReport, "utf8")) as JSONRecord
  const grid = featureGrid(report, config.timeframe)
  const endTS = Date.parse(grid.at(-1) || "")
  if (!Number.isFinite(endTS)) throw new Error("base report has no valid feature timestamps")
  const recentStart = Math.max(config.sinceTS, endTS - 29 * 86_400_000)
  const currency = config.symbol.replace(/USDT$/, "")
  const [funding, premium, market, dvolResult, onchainResult] = await Promise.all([
    fetchPaged("https://fapi.binance.com/fapi/v1/fundingRate", { symbol: config.symbol, endTime: String(endTS + timeframeMilliseconds(config.timeframe)) }, config.sinceTS, 1000, fetchJSON, "fundingTime"),
    fetchPaged("https://fapi.binance.com/fapi/v1/premiumIndexKlines", { symbol: config.symbol, interval: config.timeframe, endTime: String(endTS + timeframeMilliseconds(config.timeframe)) }, config.sinceTS, 1500, fetchJSON, "0"),
    config.metricsSource === "vision"
      ? fetchVisionFeatures(config.symbol, config.sinceTS, endTS, config.timeframe, config.microstructureDays)
      : fetchRecentMarket(config, recentStart, endTS, fetchJSON),
    safeExternal(config.external ? fetchDeribitDvol(currency, config.sinceTS, endTS) : Promise.resolve([])),
    safeExternal(config.external && currency === "BTC" ? fetchBrkFactors(config.sinceTS, endTS) : Promise.resolve({})),
  ])
  return mergeMarketFeatures(report, config.timeframe, grid, {
    funding: funding.map((row) => point(row, "fundingTime", "fundingRate")),
    premium: premium.map((row) => arrayPoint(row, 0, 4)),
    openInterest: market.openInterest,
    takerRatio: market.takerRatio,
    takerImbalance: market.takerImbalance,
    tradeConcentration: market.tradeConcentration,
    depth1PctNotional: market.depth1PctNotional,
    dvol: dvolResult.data as Point[],
    onchain: onchainResult.data as Record<string, Point[]>,
  }, { requested_since_ts: config.sinceTS, metrics_source: config.metricsSource, external_errors: [dvolResult.error, onchainResult.error].filter(Boolean), ...market.coverage })
}

async function safeExternal<T>(task: Promise<T>): Promise<{ data: T | [] | Record<string, never>; error: string | null }> {
  try { return { data: await task, error: null } }
  catch (error) { return { data: [], error: String(error) } }
}

function mergeMarketFeatures(
  report: JSONRecord,
  timeframe: string,
  grid: string[],
  input: { funding: Point[]; premium: Point[]; openInterest: Point[]; takerRatio: Point[]; takerImbalance?: Point[]; tradeConcentration?: Point[]; depth1PctNotional?: Point[]; dvol?: Point[]; onchain?: Record<string, Point[]> },
  coverage: JSONRecord = {},
): JSONRecord {
  const data = asRecord(report.data)
  const frames = asRecord(data.timeframes)
  const frame = asRecord(frames[timeframe])
  const features = asRecord(frame.features)
  Object.assign(features, {
    "crypto.funding_rate": feature("crypto.funding_rate", "funding", "confirmation", alignForward(input.funding, grid, 12 * 3_600_000)),
    "crypto.premium_index": feature("crypto.premium_index", "basis", "regime", alignForward(input.premium, grid, 5 * 3_600_000)),
    "crypto.open_interest_value": feature("crypto.open_interest_value", "open-interest", "confirmation", alignForward(input.openInterest, grid, 8 * 3_600_000)),
    "crypto.taker_buy_sell_ratio": feature("crypto.taker_buy_sell_ratio", "orderflow", "timing", alignForward(input.takerRatio, grid, 8 * 3_600_000)),
    "crypto.taker_notional_imbalance": feature("crypto.taker_notional_imbalance", "aggTrades", "timing", alignForward(input.takerImbalance || [], grid, 5 * 3_600_000)),
    "crypto.trade_concentration": feature("crypto.trade_concentration", "aggTrades", "risk", alignForward(input.tradeConcentration || [], grid, 5 * 3_600_000)),
    "crypto.depth_1pct_notional": feature("crypto.depth_1pct_notional", "bookDepth", "risk", alignForward(input.depth1PctNotional || [], grid, 5 * 3_600_000)),
    "crypto.dvol": feature("crypto.dvol", "deribit-dvol", "regime", alignForward(input.dvol || [], grid, 2 * 3_600_000)),
  })
  for (const [factorID, values] of Object.entries(input.onchain || {})) features[factorID] = feature(factorID, "brk", "regime", alignForward(values, grid, 5 * 3_600_000))
  frame.features = features
  frames[timeframe] = frame
  data.timeframes = frames
  data.market_feature_coverage = {
    ...coverage,
    capability_gaps: [
      "full_l2_queue_and_passive_fill_probability_unavailable",
      "true_liquidation_labels_unavailable",
      "exchange_netflow_requires_external_address_labels",
      "complete_historical_option_surface_unavailable",
    ],
  }
  data.market_events = { ...asRecord(data.market_events), funding: input.funding }
  return { ...report, data }
}

async function fetchRecentMarket(config: Config, start: number, end: number, fetchJSON: FetchJSON): Promise<VisionFeatures> {
  try {
    const [openInterest, takerRatio] = await Promise.all([
      fetchOnce("https://fapi.binance.com/futures/data/openInterestHist", { symbol: config.symbol, period: config.timeframe, limit: "500", startTime: String(start), endTime: String(end) }, fetchJSON),
      fetchOnce("https://fapi.binance.com/futures/data/takerlongshortRatio", { symbol: config.symbol, period: config.timeframe, limit: "500", startTime: String(start), endTime: String(end) }, fetchJSON),
    ])
    return {
      openInterest: openInterest.map((row) => point(row, "timestamp", "sumOpenInterestValue", "sumOpenInterest")),
      takerRatio: takerRatio.map((row) => point(row, "timestamp", "buySellRatio")),
      takerImbalance: [], tradeConcentration: [], depth1PctNotional: [],
      coverage: { provider: "binance-rest", recent_only_start_ts: start, history_limit_days: 30 },
    }
  } catch (error) {
    return {
      openInterest: [], takerRatio: [],
      takerImbalance: [], tradeConcentration: [], depth1PctNotional: [],
      coverage: { provider: "binance-rest", recent_only_start_ts: start, history_limit_days: 30, market_errors: [String(error)] },
    }
  }
}

function feature(factorID: string, source: string, role: string, values: Point[]): JSONRecord {
  return {
    status: values.length > 0 ? "ok" : "unsupported",
    factor_id: factorID,
    source_indicator: source,
    output: "value",
    category: "crypto-native",
    roles: [role],
    allowed_transforms: ["level", "delta", "slope", "zscore", "percentile"],
    values,
  }
}

function alignForward(points: Point[], grid: string[], maxAgeMs: number): Point[] {
  const sorted = [...points].filter((item) => Number.isFinite(item.value)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const output: Point[] = []
  let cursor = 0
  let latest: Point | undefined
  for (const timestamp of grid) {
    const time = Date.parse(timestamp)
    while (cursor < sorted.length && Date.parse(sorted[cursor].timestamp) <= time) latest = sorted[cursor++]
    if (latest && time - Date.parse(latest.timestamp) <= maxAgeMs) output.push({ timestamp, value: latest.value })
  }
  return output
}

async function fetchPaged(base: string, fixed: Record<string, string>, since: number, limit: number, fetchJSON: FetchJSON, timeKey: string): Promise<unknown[]> {
  const rows: unknown[] = []
  let cursor = since
  for (;;) {
    const page = await fetchOnce(base, { ...fixed, startTime: String(cursor), limit: String(limit) }, fetchJSON)
    rows.push(...page)
    if (page.length < limit) return rows
    const last = rowTime(page.at(-1), timeKey)
    if (!Number.isFinite(last) || last < cursor) throw new Error(`market feature pagination did not advance: ${base}`)
    cursor = last + 1
  }
}

async function fetchOnce(base: string, params: Record<string, string>, fetchJSON: FetchJSON): Promise<unknown[]> {
  const url = `${base}?${new URLSearchParams(params)}`
  const value = await fetchJSON(url)
  if (!Array.isArray(value)) throw new Error(`unexpected market feature response: ${base}`)
  return value
}

async function defaultFetch(url: string): Promise<unknown> {
  const response = await fetch(url)
  const body = await response.text()
  if (!response.ok) throw new Error(`market feature HTTP ${response.status}: ${body.slice(0, 300)} (${url})`)
  return JSON.parse(body)
}

function featureGrid(report: JSONRecord, timeframe: string): string[] {
  const features = asRecord(asRecord(asRecord(report.data).timeframes)[timeframe]).features
  for (const raw of Object.values(asRecord(features))) {
    const values = asRecord(raw).values
    if (Array.isArray(values)) return values.map((item) => stringField(asRecord(item).timestamp)).filter(Boolean)
  }
  throw new Error(`base report has no ${timeframe} feature grid`)
}

function point(raw: unknown, timeKey: string, valueKey: string, fallbackKey?: string): Point {
  const row = asRecord(raw)
  return { timestamp: new Date(Number(row[timeKey])).toISOString(), value: Number(row[valueKey] ?? row[fallbackKey || ""]) }
}
function arrayPoint(raw: unknown, timeIndex: number, valueIndex: number): Point { const row = Array.isArray(raw) ? raw : []; return { timestamp: new Date(Number(row[timeIndex])).toISOString(), value: Number(row[valueIndex]) } }
function rowTime(raw: unknown, key: string): number { return key === "0" && Array.isArray(raw) ? Number(raw[0]) : Number(asRecord(raw)[key]) }
function asRecord(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function stringField(value: unknown): string { return typeof value === "string" ? value : "" }
function timeframeMilliseconds(value: string): number {
  const match = value.match(/^(\d+)([mhd])$/)
  if (!match) throw new Error(`unsupported market feature timeframe: ${value}`)
  return Number(match[1]) * ({ m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]] || 0)
}

function parseArgs(argv: string[]): Config {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1])
  const source = values.get("--metrics-source") || "vision"
  const config: Config = { symbol: values.get("--symbol") || "", timeframe: values.get("--timeframe") || "4h", sinceTS: Number(values.get("--since-ts")), baseReport: values.get("--base-report") || "", metricsSource: source === "rest" ? "rest" : "vision", microstructureDays: Number(values.get("--microstructure-days") || 0), external: values.get("--external") !== "false" }
  if (!config.symbol || !config.baseReport || !Number.isFinite(config.sinceTS) || config.sinceTS <= 0) throw new Error("market-features requires --symbol, --since-ts and --base-report")
  if (!Number.isInteger(config.microstructureDays) || config.microstructureDays < 0 || config.microstructureDays > 7) throw new Error("--microstructure-days must be an integer from 0 to 7")
  return config
}

if (import.meta.main) {
  runMarketFeatures(process.argv.slice(2)).then((data) => process.stdout.write(`${JSON.stringify(data.ok === true ? data : { ok: true, data }, null, 2)}\n`)).catch((error) => { process.stderr.write(`${JSON.stringify({ ok: false, error: String(error) })}\n`); process.exit(1) })
}

export { alignForward, mergeMarketFeatures, runMarketFeatures }
