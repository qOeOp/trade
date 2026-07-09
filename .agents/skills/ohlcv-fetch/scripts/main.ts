#!/usr/bin/env bun

import Binance, { type BinanceRest } from "binance-api-node"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

export interface Config {
  symbol: string
  exchange: string
  timeframes: string[]
  outputDir: string
  limit: number
  sinceTS: number
}

export interface SymbolSpec {
  manifest: string
  api: string
}

export interface FetchConfig {
  exchangeID: string
  symbol: SymbolSpec
}

interface Candle {
  date: string
  timestamp: number
  open: string
  high: string
  low: string
  close: string
  volume: string
}

interface TimeframeEntry {
  file: string
  limit: number
  first_open_ts: number
  last_open_ts: number
  rows: number
  append_only: boolean
  ascending_ts: boolean
  content_sha256: string
}

interface FetchResponse {
  schema_version: 2
  source: { provider: "binance"; market: "usdm_perpetual"; endpoint: "fapi/v1/klines" }
  closed_candles_only: true
  symbol: string
  requested_symbol: string
  exchange: string
  requested_exchange: string
  generated_at: string
  output_dir: string
  manifest_path: string
  columns: string[]
  dedupe_key: string
  requested_since_ts?: number
  timeframes: Record<string, TimeframeEntry>
}

interface OutputPaths {
  fsDir: string
  manifestDir: string
}

type ScriptResponse =
  | { ok: true; data: FetchResponse }
  | { ok: false; error: string }

interface ExchangeInfoSymbol {
  symbol: string
  status?: string
}

interface ExchangeInfoPayload {
  code?: unknown
  msg?: string
  symbols?: ExchangeInfoSymbol[]
}

const DEFAULT_LIMITS: Record<string, number> = {
  "1w": 300,
  "1d": 320,
  "4h": 420,
  "1h": 520,
}

const TIMEFRAME_ORDER = ["1w", "1d", "4h", "1h"]
const MAX_KLINE_PAGE_SIZE = 1500

const HELP_TEXT = `Usage:
  ./scripts/main.ts --symbol ETHUSDT
  ./scripts/main.ts --symbol ETH/USDT --timeframes 1d,4h,1h

Key flags:
  --symbol <symbol>             Required. Example: ETHUSDT
  --exchange <name>             Default: binance
  --timeframes <list>           Default: 1w,1d,4h,1h
  --output-dir <path>           Optional output directory
  --limit <count>               Optional fixed limit for all timeframes
  --since-ts <ms>               Optional inclusive start timestamp in ms
  --help                        Show this help
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT)
    return
  }

  const response = await run(argv)
  const stream = response.ok ? process.stdout : process.stderr
  stream.write(`${JSON.stringify(response, null, 2)}\n`)
  if (!response.ok) {
    process.exit(1)
  }
}

export async function run(
  argv: string[],
  client: BinanceRest = Binance(),
): Promise<ScriptResponse> {
  try {
    const config = parseArgs(argv)
    const fetchCfg = resolveFetchConfig(config.exchange, config.symbol)

    const exchangeInfo = (await client.futuresExchangeInfo()) as ExchangeInfoPayload
    ensureSymbolSupported(exchangeInfo, fetchCfg)

    if (config.timeframes.length === 0) {
      throw new Error("no timeframes to fetch")
    }

    const outputPaths = resolveOutputPaths(config.outputDir)
    const candleSets = await fetchAllTimeframes(client, fetchCfg, config.timeframes, config.limit, config.sinceTS)

    const response: FetchResponse = {
      schema_version: 2,
      source: { provider: "binance", market: "usdm_perpetual", endpoint: "fapi/v1/klines" },
      closed_candles_only: true,
      symbol: fetchCfg.symbol.manifest,
      requested_symbol: config.symbol,
      exchange: fetchCfg.exchangeID,
      requested_exchange: config.exchange,
      generated_at: nowInShanghai(),
      output_dir: outputPaths.manifestDir,
      manifest_path: join(outputPaths.manifestDir, "manifest.json"),
      columns: ["date", "timestamp", "open", "high", "low", "close", "volume"],
      dedupe_key: "timestamp",
      timeframes: {},
    }
    if (config.sinceTS > 0) {
      response.requested_since_ts = config.sinceTS
    }

    for (const timeframe of config.timeframes) {
      const set = candleSets[timeframe]
      const fileName = `${timeframe}.csv`
      const entry: TimeframeEntry = {
        file: fileName,
        limit: set.limit,
        rows: set.candles.length,
        first_open_ts: set.candles.length > 0 ? set.candles[0].timestamp : 0,
        last_open_ts: set.candles.length > 0 ? set.candles[set.candles.length - 1].timestamp : 0,
        append_only: true,
        ascending_ts: true,
        content_sha256: candleContentHash(set.candles),
      }
      writeCandlesCSV(join(outputPaths.fsDir, fileName), set.candles)
      response.timeframes[timeframe] = entry
    }

    writeFileSync(join(outputPaths.fsDir, "manifest.json"), `${JSON.stringify(response, null, 2)}\n`)
    return { ok: true, data: response }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function parseArgs(argv: string[]): Config {
  const config: Config = {
    symbol: "",
    exchange: "binance",
    timeframes: orderedTimeframes("1w,1d,4h,1h"),
    outputDir: "",
    limit: 0,
    sinceTS: 0,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case "--symbol":
        config.symbol = readFlagValue(argv, ++i, arg)
        break
      case "--exchange":
        config.exchange = readFlagValue(argv, ++i, arg).toLowerCase()
        break
      case "--timeframes":
        config.timeframes = orderedTimeframes(readFlagValue(argv, ++i, arg))
        break
      case "--output-dir":
        config.outputDir = readFlagValue(argv, ++i, arg)
        break
      case "--limit": {
        const value = Number(readFlagValue(argv, ++i, arg))
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("--limit cannot be negative")
        }
        config.limit = value
        break
      }
      case "--since-ts": {
        const value = Number(readFlagValue(argv, ++i, arg))
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("--since-ts cannot be negative")
        }
        config.sinceTS = value
        break
      }
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  if (!config.symbol.trim()) {
    throw new Error("--symbol is required")
  }
  if (config.limit > MAX_KLINE_PAGE_SIZE && config.sinceTS <= 0) {
    throw new Error(`--limit above ${MAX_KLINE_PAGE_SIZE} requires --since-ts`)
  }
  return config
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

export function orderedTimeframes(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(",")) {
    const tf = part.trim()
    if (tf) seen.add(tf)
  }
  const ordered: string[] = []
  for (const tf of TIMEFRAME_ORDER) {
    if (seen.has(tf)) {
      ordered.push(tf)
      seen.delete(tf)
    }
  }
  for (const tf of seen) {
    ordered.push(tf)
  }
  return ordered
}

export function resolveFetchConfig(exchangeID: string, rawSymbol: string): FetchConfig {
  if (exchangeID !== "binance" && exchangeID !== "binanceusdm") {
    throw new Error(`only Binance USD-M is supported; unsupported exchange: ${exchangeID}`)
  }
  return { exchangeID: "binanceusdm", symbol: resolveSymbolSpec(rawSymbol) }
}

function resolveSymbolSpec(rawSymbol: string): SymbolSpec {
  const trimmed = rawSymbol.trim().toUpperCase()
  if (!trimmed) {
    throw new Error("symbol cannot be empty")
  }
  if (trimmed.includes(":") || !trimmed.includes("/")) {
    return { manifest: trimmed, api: resolveAPISymbol(trimmed) }
  }
  const [base, quote] = trimmed.split("/", 2)
  return { manifest: `${base}/${quote}:${quote}`, api: `${base}${quote}` }
}

function resolveAPISymbol(rawSymbol: string): string {
  let baseQuote = rawSymbol.trim().toUpperCase()
  if (baseQuote.includes(":")) {
    baseQuote = baseQuote.split(":", 2)[0]
  }
  if (baseQuote.includes("/")) {
    const [base, quote] = baseQuote.split("/", 2)
    return `${base}${quote}`
  }
  return baseQuote
}

export function ensureSymbolSupported(
  payload: ExchangeInfoPayload,
  cfg: { exchangeID: string; symbol: SymbolSpec },
): void {
  if (payload.code !== undefined && payload.code !== null) {
    throw new Error(`${cfg.exchangeID} does not support symbol: ${cfg.symbol.manifest}`)
  }
  const symbols = payload.symbols ?? []
  for (const entry of symbols) {
    if (entry.symbol !== cfg.symbol.api) continue
    if (entry.status && entry.status !== "TRADING") {
      throw new Error(
        `${cfg.exchangeID} symbol not tradable: ${cfg.symbol.manifest} (${entry.status})`,
      )
    }
    return
  }
  throw new Error(`${cfg.exchangeID} does not support symbol: ${cfg.symbol.manifest}`)
}

interface CandleSet {
  candles: Candle[]
  limit: number
}

async function fetchAllTimeframes(
  client: BinanceRest,
  cfg: FetchConfig,
  timeframes: string[],
  limitOverride: number,
  sinceTS: number,
): Promise<Record<string, CandleSet>> {
  const tasks = timeframes.map(async (timeframe) => {
    const limit = limitOverride > 0 ? limitOverride : (DEFAULT_LIMITS[timeframe] ?? 300)
    const candles = await fetchKlines(client, cfg, timeframe, limit, sinceTS)
    return [timeframe, { candles, limit }] as const
  })
  const results = await Promise.all(tasks)
  return Object.fromEntries(results)
}

export async function fetchKlines(
  client: BinanceRest,
  cfg: FetchConfig,
  interval: string,
  limit: number,
  sinceTS: number,
): Promise<Candle[]> {
  const target = Math.max(1, limit)
  const fetchTarget = target + 1
  const byTimestamp = new Map<number, Candle>()
  let cursor = sinceTS

  while (byTimestamp.size < fetchTarget) {
    const pageLimit = Math.min(MAX_KLINE_PAGE_SIZE, fetchTarget - byTimestamp.size)
    const payload: { symbol: string; interval: string; limit: number; startTime?: number } = {
      symbol: cfg.symbol.api,
      interval,
      limit: pageLimit,
    }
    if (cursor > 0) payload.startTime = cursor

    const raw = (await client.futuresCandles(payload)) as unknown as RawCandle[]
    if (raw.length === 0) {
      break
    }
    for (const row of raw) {
      byTimestamp.set(row.openTime, toCandle(row))
    }

    const lastOpenTime = Math.max(...raw.map((row) => row.openTime))
    if (cursor > 0 && lastOpenTime < cursor) {
      throw new Error(`${cfg.symbol.manifest} ${interval} pagination did not advance`)
    }
    cursor = lastOpenTime + 1
    if (raw.length < pageLimit) {
      break
    }
  }

  const now = Date.now()
  const candles = Array.from(byTimestamp.values())
    .filter((candle) => candleCloseTimestamp(candle.timestamp, interval) <= now)
    .sort((a, b) => a.timestamp - b.timestamp)
  const selected = sinceTS > 0 ? candles.slice(0, target) : candles.slice(-target)
  if (selected.length === 0) {
    throw new Error(`${cfg.symbol.manifest} ${interval} returned no OHLCV data`)
  }
  return selected
}

export function candleCloseTimestamp(openTimestamp: number, interval: string): number {
  const monthly = interval.match(/^(\d+)M$/)
  if (monthly) {
    const date = new Date(openTimestamp)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + Number(monthly[1]), 1)
  }
  const match = interval.match(/^(\d+)([mhdw])$/)
  if (!match) {
    throw new Error(`unsupported timeframe for closed-candle verification: ${interval}`)
  }
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]] || 0
  return openTimestamp + Number(match[1]) * unit
}

function candleContentHash(candles: Candle[]): string {
  return createHash("sha256").update(candlesCsv(candles)).digest("hex")
}

function toCandle(row: RawCandle): Candle {
  return {
    date: formatRFC3339UTC(row.openTime),
    timestamp: row.openTime,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  }
}

interface RawCandle {
  openTime: number
  open: string
  high: string
  low: string
  close: string
  volume: string
}

function resolveOutputPaths(raw: string): OutputPaths {
  const trimmed = raw.trim()
  if (!trimmed) {
    const tempDir = mkdtempSync(join(tmpdir(), "ohlcv-fetch-"))
    return { fsDir: tempDir, manifestDir: displayPath(tempDir) }
  }
  const expanded = trimmed.replace(/\$([A-Z_][A-Z0-9_]*)/gi, (_, name: string) => process.env[name] ?? "")
  const fsDir = resolve(expanded)
  mkdirSync(fsDir, { recursive: true })
  return {
    fsDir,
    manifestDir: displayPath(fsDir),
  }
}

function displayPath(path: string): string {
  return relative(process.cwd(), path) || "."
}

function writeCandlesCSV(path: string, candles: Candle[]): void {
  writeFileSync(path, candlesCsv(candles))
}

function candlesCsv(candles: Candle[]): string {
  const lines: string[] = ["date,timestamp,open,high,low,close,volume"]
  for (const c of candles) {
    lines.push(`${c.date},${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`)
  }
  return `${lines.join("\n")}\n`
}

export function formatRFC3339UTC(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")
}

function nowInShanghai(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00")
}

if (import.meta.main) {
  await main()
}
