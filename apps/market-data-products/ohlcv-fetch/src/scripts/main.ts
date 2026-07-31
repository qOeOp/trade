#!/usr/bin/env bun

import Binance, { type BinanceRest } from "binance-api-node"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { nowIsoUTC } from "../../../../contracts/runtime-core/src/time"
import { resolveDatabasePathInput } from "../../../../contracts/runtime-core/src/database-environment"
import { buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../contracts/runtime-core/src/database-identity"
import {
  ensureMarketDataSchema,
  ensureOhlcvSchema,
  readLatestCandleOpenTime,
  upsertCanonicalCandles,
  upsertMarketManifest,
  type CanonicalCandle,
  type MarketManifest,
} from "../../../market-data-store/src/lib/market-data-store"

export interface Config {
  symbol: string
  exchange: string
  timeframes: string[]
  outputDir: string
  limit: number
  sinceTS: number
  marketDataDb: string
  ohlcvDb: string
  environmentId: string
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
  file?: string
  limit: number
  requested_since_ts: number
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
  output_dir?: string
  manifest_path?: string
  columns: string[]
  dedupe_key: string
  requested_since_ts?: number
  market_data_store?: MarketDataStoreWriteSummary
  timeframes: Record<string, TimeframeEntry>
}

interface MarketDataStoreWriteSummary {
  db: string
  ohlcv_db: string
  manifests: Array<{ timeframe: string; manifest_id: string; rows: number }>
  candles_upserted: number
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
  bun src/scripts/main.ts --symbol ETHUSDT
  bun src/scripts/main.ts --symbol ETH/USDT --timeframes 1d,4h,1h

Key flags:
  --symbol <symbol>             Required. Example: ETHUSDT
  --exchange <name>             Default: binance
  --timeframes <list>           Default: 1w,1d,4h,1h
  --output-dir <path>           Optional output directory
  --limit <count>               Optional fixed limit for all timeframes
  --since-ts <ms>               Optional inclusive start timestamp in ms
  --market-data-db <path>       market_data_store DB for manifests. Default: data/market_data.db
  --ohlcv-db <path>             ohlcv_store DB for canonical candles. Default: data/ohlcv.db
  --export-files                Export CSV + manifest files. Implied by --output-dir.
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

    const outputPaths = config.outputDir ? resolveOutputPaths(config.outputDir) : null
    const candleSets = await fetchAllTimeframes(client, fetchCfg, config)

    const response: FetchResponse = {
      schema_version: 2,
      source: { provider: "binance", market: "usdm_perpetual", endpoint: "fapi/v1/klines" },
      closed_candles_only: true,
      symbol: fetchCfg.symbol.manifest,
      requested_symbol: config.symbol,
      exchange: fetchCfg.exchangeID,
      requested_exchange: config.exchange,
      generated_at: nowIsoUTC(),
      columns: ["date", "timestamp", "open", "high", "low", "close", "volume"],
      dedupe_key: "timestamp",
      timeframes: {},
    }
    if (outputPaths) {
      response.output_dir = outputPaths.manifestDir
      response.manifest_path = join(outputPaths.manifestDir, "manifest.json")
    }
    if (config.sinceTS > 0) {
      response.requested_since_ts = config.sinceTS
    }

    for (const timeframe of config.timeframes) {
      const set = candleSets[timeframe]
      const entry: TimeframeEntry = {
        limit: set.limit,
        requested_since_ts: set.requested_since_ts,
        rows: set.candles.length,
        first_open_ts: set.candles.length > 0 ? set.candles[0].timestamp : 0,
        last_open_ts: set.candles.length > 0 ? set.candles[set.candles.length - 1].timestamp : 0,
        append_only: true,
        ascending_ts: true,
        content_sha256: candleContentHash(set.candles),
      }
      if (outputPaths) {
        const fileName = `${timeframe}.csv`
        entry.file = fileName
        writeCandlesCSV(join(outputPaths.fsDir, fileName), set.candles)
      }
      response.timeframes[timeframe] = entry
    }

    const storeWrite = recordMarketDataStoreIfEnabled(config, fetchCfg, response, candleSets)
    if (storeWrite) {
      response.market_data_store = storeWrite
    }
    if (outputPaths) {
      writeFileSync(join(outputPaths.fsDir, "manifest.json"), `${JSON.stringify(response, null, 2)}\n`)
    }
    return { ok: true, data: response }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function parseArgs(argv: string[]): Config {
  let exportFilesRequested = false
  const config: Config = {
    symbol: "",
    exchange: "binance",
    timeframes: orderedTimeframes("1w,1d,4h,1h"),
    outputDir: "",
    limit: 0,
    sinceTS: 0,
    marketDataDb: "data/market_data.db",
    ohlcvDb: "data/ohlcv.db",
    environmentId: "local:local",
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
      case "--export-files":
        exportFilesRequested = true
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
      case "--market-data-db":
        config.marketDataDb = readFlagValue(argv, ++i, arg)
        break
      case "--ohlcv-db":
        config.ohlcvDb = readFlagValue(argv, ++i, arg)
        break
      case "--environment-id":
        config.environmentId = readFlagValue(argv, ++i, arg)
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  if (!config.symbol.trim()) {
    throw new Error("--symbol is required")
  }
  if (exportFilesRequested && !config.outputDir) {
    throw new Error("--export-files requires --output-dir")
  }
  if (config.limit > MAX_KLINE_PAGE_SIZE && config.sinceTS <= 0) {
    throw new Error(`--limit above ${MAX_KLINE_PAGE_SIZE} requires --since-ts`)
  }
  return config
}

function recordMarketDataStoreIfEnabled(
  config: Config,
  fetchCfg: FetchConfig,
  response: FetchResponse,
  candleSets: Record<string, CandleSet>,
): MarketDataStoreWriteSummary | null {
  if (!config.marketDataDb) {
    return null
  }
  const marketDbPath = resolveDatabasePathInput(config.marketDataDb)
  const ohlcvDbPath = resolveDatabasePathInput(config.ohlcvDb)
  mkdirSync(dirname(marketDbPath), { recursive: true })
  mkdirSync(dirname(ohlcvDbPath), { recursive: true })
  const marketDb = new Database(marketDbPath)
  const ohlcvDb = new Database(ohlcvDbPath)
  try {
    ensureDatabaseIdentity(marketDb, buildDatabaseIdentity(config.environmentId, "market_data_store"))
    ensureDatabaseIdentity(ohlcvDb, buildDatabaseIdentity(config.environmentId, "ohlcv_store"))
    ensureMarketDataSchema(marketDb)
    ensureOhlcvSchema(ohlcvDb)
    const manifests: MarketDataStoreWriteSummary["manifests"] = []
    let candlesUpserted = 0
    for (const timeframe of config.timeframes) {
      const entry = response.timeframes[timeframe]
      const set = candleSets[timeframe]
      if (!entry || !set) {
        continue
      }
      const manifest = buildStoreManifest(response, fetchCfg, timeframe, entry)
      upsertMarketManifest(marketDb, manifest)
      candlesUpserted += upsertCanonicalCandles(ohlcvDb, buildStoreCandles(manifest, fetchCfg, timeframe, set.candles))
      manifests.push({
        timeframe,
        manifest_id: manifest.manifest_id,
        rows: entry.rows,
      })
    }
    return {
      db: displayPath(marketDbPath),
      ohlcv_db: displayPath(ohlcvDbPath),
      manifests,
      candles_upserted: candlesUpserted,
    }
  } finally {
    marketDb.close()
    ohlcvDb.close()
  }
}

function buildStoreManifest(
  response: FetchResponse,
  fetchCfg: FetchConfig,
  timeframe: string,
  entry: TimeframeEntry,
): MarketManifest {
  const manifestId = [
    "ohlcv",
    fetchCfg.exchangeID,
    fetchCfg.symbol.api,
    timeframe,
    entry.content_sha256.slice(0, 16),
  ].join(":")
  return {
    manifest_id: manifestId,
    dataset_kind: "ohlcv",
    source: "binance_klines",
    exchange: fetchCfg.exchangeID,
    symbol: fetchCfg.symbol.api,
    timeframe,
    first_ts: entry.first_open_ts,
    last_ts: entry.last_open_ts,
    rows: entry.rows,
    content_hash: entry.content_sha256,
    manifest_path: response.manifest_path || logicalOhlcvManifestRef(fetchCfg, timeframe, entry),
    created_at: response.generated_at,
    freshness_json: {
      closed_candles_only: response.closed_candles_only,
      append_only: entry.append_only,
      ascending_ts: entry.ascending_ts,
      display_symbol: response.symbol,
      requested_symbol: response.requested_symbol,
      store_ref: logicalOhlcvSeriesRef(fetchCfg, timeframe),
    },
  }
}

function logicalOhlcvManifestRef(fetchCfg: FetchConfig, timeframe: string, entry: TimeframeEntry): string {
  return `${logicalOhlcvSeriesRef(fetchCfg, timeframe)}/manifest/${entry.content_sha256.slice(0, 16)}`
}

function logicalOhlcvSeriesRef(fetchCfg: FetchConfig, timeframe: string): string {
  return `ohlcv_store:canonical_candle/${fetchCfg.exchangeID}/${fetchCfg.symbol.api}/${timeframe}`
}

function buildStoreCandles(
  manifest: MarketManifest,
  fetchCfg: FetchConfig,
  timeframe: string,
  candles: Candle[],
): CanonicalCandle[] {
  return candles.map((candle) => ({
    manifest_id: manifest.manifest_id,
    exchange: fetchCfg.exchangeID,
    symbol: fetchCfg.symbol.api,
    timeframe,
    open_time: candle.timestamp,
    close_time: candleCloseTimestamp(candle.timestamp, timeframe),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume),
  }))
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
  requested_since_ts: number
}

async function fetchAllTimeframes(
  client: BinanceRest,
  cfg: FetchConfig,
  config: Config,
): Promise<Record<string, CandleSet>> {
  const latestOpenTimes = readLatestOpenTimes(config.ohlcvDb, config.environmentId, cfg, config.timeframes)
  const tasks = config.timeframes.map(async (timeframe) => {
    const limit = config.limit > 0 ? config.limit : (DEFAULT_LIMITS[timeframe] ?? 300)
    const sinceTS = config.sinceTS > 0 ? config.sinceTS : nextOpenAfter(latestOpenTimes[timeframe] ?? null)
    const candles = await fetchKlines(client, cfg, timeframe, limit, sinceTS)
    return [timeframe, { candles, limit, requested_since_ts: sinceTS }] as const
  })
  const results = await Promise.all(tasks)
  return Object.fromEntries(results)
}

function readLatestOpenTimes(dbPath: string, environmentId: string, cfg: FetchConfig, timeframes: string[]): Record<string, number | null> {
  const resolved = resolveDatabasePathInput(dbPath)
  mkdirSync(dirname(resolved), { recursive: true })
  const db = new Database(resolved)
  try {
    ensureDatabaseIdentity(db, buildDatabaseIdentity(environmentId, "ohlcv_store"))
    ensureOhlcvSchema(db)
    return Object.fromEntries(timeframes.map((timeframe) => [
      timeframe,
      readLatestCandleOpenTime(db, {
        exchange: cfg.exchangeID,
        symbol: cfg.symbol.api,
        timeframe,
      }),
    ]))
  } finally {
    db.close()
  }
}

function nextOpenAfter(openTime: number | null): number {
  return typeof openTime === "number" && Number.isFinite(openTime) ? openTime + 1 : 0
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
    throw new Error("output directory is required for OHLCV file export")
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

if (import.meta.main) {
  await main()
}
