#!/usr/bin/env bun

import { readFileSync } from "node:fs"

type JSONRecord = Record<string, unknown>
type Point = { timestamp: string; value: number }
type FetchJSON = (url: string) => Promise<unknown>

interface Config { symbol: string; timeframe: string; sinceTS: number; baseReport: string }

async function runMarketFeatures(argv: string[], fetchJSON: FetchJSON = defaultFetch): Promise<JSONRecord> {
  const config = parseArgs(argv)
  const report = JSON.parse(readFileSync(config.baseReport, "utf8")) as JSONRecord
  const grid = featureGrid(report, config.timeframe)
  const now = Date.now()
  const recentStart = Math.max(config.sinceTS, now - 29 * 86_400_000)
  const [funding, premium, openInterest, takerRatio] = await Promise.all([
    fetchPaged("https://fapi.binance.com/fapi/v1/fundingRate", { symbol: config.symbol }, config.sinceTS, 1000, fetchJSON, "fundingTime"),
    fetchPaged("https://fapi.binance.com/fapi/v1/premiumIndexKlines", { symbol: config.symbol, interval: config.timeframe }, config.sinceTS, 1500, fetchJSON, "0"),
    fetchOnce("https://fapi.binance.com/futures/data/openInterestHist", { symbol: config.symbol, period: config.timeframe, limit: "500", startTime: String(recentStart), endTime: String(now) }, fetchJSON),
    fetchOnce("https://fapi.binance.com/futures/data/takerlongshortRatio", { symbol: config.symbol, period: config.timeframe, limit: "500", startTime: String(recentStart), endTime: String(now) }, fetchJSON),
  ])
  return mergeMarketFeatures(report, config.timeframe, grid, {
    funding: funding.map((row) => point(row, "fundingTime", "fundingRate")),
    premium: premium.map((row) => arrayPoint(row, 0, 4)),
    openInterest: openInterest.map((row) => point(row, "timestamp", "sumOpenInterestValue", "sumOpenInterest")),
    takerRatio: takerRatio.map((row) => point(row, "timestamp", "buySellRatio")),
  }, { requested_since_ts: config.sinceTS, recent_only_start_ts: recentStart })
}

function mergeMarketFeatures(
  report: JSONRecord,
  timeframe: string,
  grid: string[],
  input: { funding: Point[]; premium: Point[]; openInterest: Point[]; takerRatio: Point[] },
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
  })
  frame.features = features
  frames[timeframe] = frame
  data.timeframes = frames
  data.market_feature_coverage = {
    ...coverage,
    open_interest_history_limit_days: 30,
    taker_ratio_history_limit_days: 30,
    aggtrades_history_limit_hours: 24,
  }
  return { ...report, data }
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

function parseArgs(argv: string[]): Config {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1])
  const config = { symbol: values.get("--symbol") || "", timeframe: values.get("--timeframe") || "4h", sinceTS: Number(values.get("--since-ts")), baseReport: values.get("--base-report") || "" }
  if (!config.symbol || !config.baseReport || !Number.isFinite(config.sinceTS) || config.sinceTS <= 0) throw new Error("market-features requires --symbol, --since-ts and --base-report")
  return config
}

if (import.meta.main) {
  runMarketFeatures(process.argv.slice(2)).then((data) => process.stdout.write(`${JSON.stringify(data.ok === true ? data : { ok: true, data }, null, 2)}\n`)).catch((error) => { process.stderr.write(`${JSON.stringify({ ok: false, error: String(error) })}\n`); process.exit(1) })
}

export { alignForward, mergeMarketFeatures, runMarketFeatures }
