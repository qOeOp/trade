#!/usr/bin/env bun

import Binance, { type BinanceRest } from "binance-api-node"

interface Config {
  symbol: string
  timeout: number
  fundingLimit: number
  recentKlines: string[]
  recentKlineLimit: number
}

interface FuturesTicker {
  symbol: string
  lastPrice?: string
  priceChange: string
  priceChangePercent: string
  weightedAvgPrice: string
  openPrice: string
  highPrice: string
  lowPrice: string
  volume: string
  quoteVolume: string
  bidPrice: string
  bidQty: string
  askPrice: string
  askQty: string
  count: number
  openTime: number
  closeTime: number
}

interface FuturesPremiumIndex {
  symbol: string
  markPrice: string
  indexPrice?: string
  lastFundingRate: string
  nextFundingTime: number
  time: number
}

interface FundingRateRow {
  symbol: string
  fundingRate: string
  fundingTime: number
  markPrice?: string
}

type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

const HELP_TEXT = `Usage:
  ./scripts/main.ts --symbol BTCUSDT

Key flags:
  --symbol <symbol>         Required. Example: BTCUSDT
  --funding-limit <count>   Funding history rows. Default: 5
  --recent-klines <csv>     Optional. Example: 15m,1h,4h
  --recent-kline-limit <n>  Default: 16
  --pulse                   Shortcut for quick market pulse
  --timeout <ms>            Default: 10000
  --help                    Show this help
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT)
    return
  }

  const response = await run(argv)
  printJSON(response)
  if (!response.ok) {
    process.exit(1)
  }
}

async function run(argv: string[]): Promise<ScriptResponse> {
  try {
    const config = parseArgs(argv)
    const client = createClient(config.timeout)
    return { ok: true, data: await buildSnapshot(config, client) }
  } catch (error) {
    return { ok: false, error: formatError(error) }
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    symbol: "",
    timeout: 10_000,
    fundingLimit: 5,
    recentKlines: [],
    recentKlineLimit: 16,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--symbol":
        config.symbol = normalizeSymbol(readFlagValue(argv, ++index, arg))
        break
      case "--timeout":
        config.timeout = parsePositiveNumber(readFlagValue(argv, ++index, arg), "--timeout")
        break
      case "--funding-limit":
        config.fundingLimit = parseNonNegativeInteger(readFlagValue(argv, ++index, arg), "--funding-limit")
        break
      case "--recent-klines":
        config.recentKlines = parseRecentKlines(readFlagValue(argv, ++index, arg))
        break
      case "--recent-kline-limit":
        config.recentKlineLimit = parsePositiveNumber(readFlagValue(argv, ++index, arg), "--recent-kline-limit")
        break
      case "--pulse":
        if (config.recentKlines.length === 0) {
          config.recentKlines = ["15m", "1h", "4h"]
        }
        if (config.fundingLimit === 0) {
          config.fundingLimit = 5
        }
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  if (!config.symbol) {
    throw new Error("--symbol is required")
  }

  return config
}

async function buildSnapshot(config: Config, client: BinanceRest) {
  const [tickerRows, premiumIndex, openInterest, bookTicker, fundingRates, recentKlines] = await Promise.all([
    client.futuresDailyStats({ symbol: config.symbol }) as Promise<FuturesTicker | FuturesTicker[]>,
    client.futuresMarkPrice({ symbol: config.symbol }) as Promise<FuturesPremiumIndex>,
    client.publicRequest("GET", "/fapi/v1/openInterest", { symbol: config.symbol }),
    client.publicRequest("GET", "/fapi/v1/ticker/bookTicker", { symbol: config.symbol }) as Promise<{
      symbol: string
      bidPrice: string
      bidQty: string
      askPrice: string
      askQty: string
    }>,
    fetchFundingRates(client, config),
    fetchRecentKlines(client, config),
  ])

  const ticker = Array.isArray(tickerRows) ? tickerRows.find((item) => item.symbol === config.symbol) : tickerRows
  if (!ticker) {
    throw new Error(`symbol not found in futuresDailyStats: ${config.symbol}`)
  }

  const openInterestMap = typeof openInterest === "object" && openInterest ? (openInterest as Record<string, unknown>) : {}

  return {
    exchange: "binance",
    market: "usdm",
    symbol: config.symbol,
    generatedAt: nowInShanghai(),
    ticker24h: normalizeFuturesTicker(ticker, premiumIndex.markPrice),
    priceSnapshot: buildFuturesPriceSnapshot(ticker, premiumIndex, bookTicker),
    premiumIndex: {
      symbol: premiumIndex.symbol,
      markPrice: premiumIndex.markPrice,
      indexPrice: premiumIndex.indexPrice,
      lastFundingRate: premiumIndex.lastFundingRate,
      nextFundingTime: premiumIndex.nextFundingTime,
      time: premiumIndex.time,
    },
    openInterest: {
      symbol: String(openInterestMap.symbol || config.symbol),
      openInterest: String(openInterestMap.openInterest || ""),
      time: Number(openInterestMap.time || 0),
    },
    fundingRates,
    ...(Object.keys(recentKlines).length > 0 ? { recentKlines } : {}),
  }
}

async function fetchFundingRates(client: BinanceRest, config: Config): Promise<FundingRateRow[]> {
  if (config.fundingLimit <= 0) {
    return []
  }

  const rows = await client.publicRequest("GET", "/fapi/v1/fundingRate", {
    symbol: config.symbol,
    limit: config.fundingLimit,
  })

  if (!Array.isArray(rows)) {
    return []
  }

  return rows
    .map((row) => normalizeFundingRateRow(row, config.symbol))
    .sort((left, right) => right.fundingTime - left.fundingTime)
}

async function fetchRecentKlines(
  client: BinanceRest,
  config: Config,
): Promise<Record<string, ReturnType<typeof normalizeKlineRows>>> {
  if (config.recentKlines.length === 0) {
    return {}
  }

  const entries = await Promise.all(
    config.recentKlines.map(async (interval) => {
      const rows = await client.publicRequest("GET", "/fapi/v1/klines", {
        symbol: config.symbol,
        interval,
        limit: config.recentKlineLimit,
      })
      return [interval, normalizeKlineRows(rows, interval)] as const
    }),
  )

  return Object.fromEntries(entries)
}

function normalizeFuturesTicker(ticker: FuturesTicker, fallbackLastPrice: string = "") {
  return {
    symbol: ticker.symbol,
    lastPrice: ticker.lastPrice || fallbackLastPrice || ticker.askPrice || ticker.bidPrice || ticker.weightedAvgPrice,
    priceChange: ticker.priceChange,
    priceChangePercent: ticker.priceChangePercent,
    weightedAvgPrice: ticker.weightedAvgPrice,
    openPrice: ticker.openPrice,
    highPrice: ticker.highPrice,
    lowPrice: ticker.lowPrice,
    volume: ticker.volume,
    quoteVolume: ticker.quoteVolume,
    bidPrice: ticker.bidPrice,
    bidQty: ticker.bidQty,
    askPrice: ticker.askPrice,
    askQty: ticker.askQty,
    tradeCount: ticker.count,
    openTime: ticker.openTime,
    closeTime: ticker.closeTime,
  }
}

function buildFuturesPriceSnapshot(
  ticker: FuturesTicker,
  premiumIndex: FuturesPremiumIndex,
  bookTicker: { symbol: string; bidPrice: string; bidQty: string; askPrice: string; askQty: string },
) {
  const bestBid = bookTicker.bidPrice || ticker.bidPrice || ""
  const bestAsk = bookTicker.askPrice || ticker.askPrice || ""
  const tradePrice = ticker.lastPrice || premiumIndex.markPrice || bestAsk || bestBid || ticker.weightedAvgPrice

  return {
    symbol: ticker.symbol,
    tradePrice,
    markPrice: premiumIndex.markPrice,
    indexPrice: premiumIndex.indexPrice || "",
    bestBid,
    bestAsk,
    midPrice: midpoint(bestBid, bestAsk),
    spreadBps: spreadBps(bestBid, bestAsk),
  }
}

function midpoint(bidPrice: string, askPrice: string): string {
  const bid = Number(bidPrice)
  const ask = Number(askPrice)
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    return ""
  }
  return ((bid + ask) / 2).toFixed(8).replace(/\.?0+$/, "")
}

function spreadBps(bidPrice: string, askPrice: string): string {
  const bid = Number(bidPrice)
  const ask = Number(askPrice)
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    return ""
  }
  const mid = (bid + ask) / 2
  return (((ask - bid) / mid) * 10_000).toFixed(4).replace(/\.?0+$/, "")
}

function createClient(timeout: number): BinanceRest {
  return Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    timeout,
  })
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[\/:_\-\s]/g, "")
}

function nowInShanghai(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00")
}

function parsePositiveNumber(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function parseNonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return parsed
}

function parseRecentKlines(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => validateKlineInterval(item)),
    ),
  )
}

function validateKlineInterval(value: string): string {
  if (!/^\d+[mhdwM]$/.test(value)) {
    throw new Error(`unsupported kline interval: ${value}`)
  }
  return value
}

function normalizeFundingRateRow(row: unknown, fallbackSymbol: string): FundingRateRow {
  const map = typeof row === "object" && row ? (row as Record<string, unknown>) : {}
  return {
    symbol: String(map.symbol || fallbackSymbol),
    fundingRate: String(map.fundingRate || ""),
    fundingTime: Number(map.fundingTime || 0),
    markPrice: map.markPrice == null ? "" : String(map.markPrice),
  }
}

function normalizeKlineRows(rows: unknown, interval: string) {
  if (!Array.isArray(rows)) {
    throw new Error(`unexpected kline response for interval: ${interval}`)
  }

  return rows.map((row) => {
    if (!Array.isArray(row) || row.length < 11) {
      throw new Error(`unexpected kline row for interval: ${interval}`)
    }

    return {
      interval,
      openTime: Number(row[0]),
      open: String(row[1]),
      high: String(row[2]),
      low: String(row[3]),
      close: String(row[4]),
      volume: String(row[5]),
      closeTime: Number(row[6]),
      quoteVolume: String(row[7]),
      tradeCount: Number(row[8]),
      takerBuyBaseVolume: String(row[9]),
      takerBuyQuoteVolume: String(row[10]),
    }
  })
}

function printJSON(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function formatError(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: string; responseText?: string }
    const code = candidate.code != null ? `code=${candidate.code} ` : ""
    const message = candidate.message || candidate.responseText || JSON.stringify(error)
    return `${code}${message}`.trim()
  }
  return String(error)
}

export {
  buildSnapshot,
  parseArgs,
  run,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
