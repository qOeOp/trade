#!/usr/bin/env bun

import Binance, { type BinanceRest } from "binance-api-node"

interface Config {
  symbol: string
  market: "spot" | "usdm"
  timeout: number
}

interface SpotTicker {
  symbol: string
  priceChange: string
  priceChangePercent: string
  weightedAvgPrice?: string
  weightedAvg?: string
  openPrice?: string
  open: string
  highPrice?: string
  high: string
  lowPrice?: string
  low: string
  volume: string
  quoteVolume?: string
  volumeQuote?: string
  bidPrice?: string
  bestBid?: string
  bidQty?: string
  bestBidQnt?: string
  askPrice?: string
  bestAsk?: string
  askQty?: string
  bestAskQnt?: string
  count?: number
  totalTrades: number
  openTime: number
  closeTime: number
}

interface FuturesTicker {
  symbol: string
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

type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

const HELP_TEXT = `Usage:
  ./scripts/main.ts --symbol BTCUSDT --market usdm

Key flags:
  --symbol <symbol>         Required. Example: BTCUSDT
  --market <spot|usdm>      Default: usdm
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
    market: "usdm",
    timeout: 10_000,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--symbol":
        config.symbol = normalizeSymbol(readFlagValue(argv, ++index, arg))
        break
      case "--market": {
        const market = readFlagValue(argv, ++index, arg).trim().toLowerCase()
        if (market !== "spot" && market !== "usdm") {
          throw new Error(`unsupported market: ${market}`)
        }
        config.market = market
        break
      }
      case "--timeout":
        config.timeout = parsePositiveNumber(readFlagValue(argv, ++index, arg), "--timeout")
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
  if (config.market === "spot") {
    const [ticker24h, bookTicker] = await Promise.all([
      client.dailyStats({ symbol: config.symbol }) as Promise<SpotTicker>,
      client.publicRequest("GET", "/api/v3/ticker/bookTicker", { symbol: config.symbol }) as Promise<{
        symbol: string
        bidPrice: string
        bidQty: string
        askPrice: string
        askQty: string
      }>,
    ])

    return {
      exchange: "binance",
      market: config.market,
      symbol: config.symbol,
      generatedAt: nowInShanghai(),
      ticker24h: normalizeSpotTicker(ticker24h),
      bookTicker: normalizeBookTicker(bookTicker),
    }
  }

  const [tickerRows, premiumIndex, openInterest] = await Promise.all([
    client.futuresDailyStats({ symbol: config.symbol }) as Promise<FuturesTicker | FuturesTicker[]>,
    client.futuresMarkPrice({ symbol: config.symbol }) as Promise<FuturesPremiumIndex>,
    client.publicRequest("GET", "/fapi/v1/openInterest", { symbol: config.symbol }),
  ])

  const ticker = Array.isArray(tickerRows) ? tickerRows.find((item) => item.symbol === config.symbol) : tickerRows
  if (!ticker) {
    throw new Error(`symbol not found in futuresDailyStats: ${config.symbol}`)
  }

  const openInterestMap = typeof openInterest === "object" && openInterest ? (openInterest as Record<string, unknown>) : {}

  return {
    exchange: "binance",
    market: config.market,
    symbol: config.symbol,
    generatedAt: nowInShanghai(),
    ticker24h: normalizeFuturesTicker(ticker),
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
  }
}

function normalizeSpotTicker(ticker: SpotTicker) {
  return {
    symbol: ticker.symbol,
    lastPrice: ticker.askPrice || ticker.bestAsk || ticker.bidPrice || ticker.bestBid || ticker.openPrice || ticker.open,
    priceChange: ticker.priceChange,
    priceChangePercent: ticker.priceChangePercent,
    weightedAvgPrice: ticker.weightedAvgPrice || ticker.weightedAvg || "",
    openPrice: ticker.openPrice || ticker.open,
    highPrice: ticker.highPrice || ticker.high,
    lowPrice: ticker.lowPrice || ticker.low,
    volume: ticker.volume,
    quoteVolume: ticker.quoteVolume || ticker.volumeQuote || "",
    bidPrice: ticker.bidPrice || ticker.bestBid || "",
    bidQty: ticker.bidQty || ticker.bestBidQnt || "",
    askPrice: ticker.askPrice || ticker.bestAsk || "",
    askQty: ticker.askQty || ticker.bestAskQnt || "",
    tradeCount: ticker.count || ticker.totalTrades,
    openTime: ticker.openTime,
    closeTime: ticker.closeTime,
  }
}

function normalizeFuturesTicker(ticker: FuturesTicker) {
  return {
    symbol: ticker.symbol,
    lastPrice: ticker.askPrice || ticker.bidPrice || ticker.openPrice,
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
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be greater than 0`)
  }
  return parsed
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

function normalizeBookTicker(ticker: { symbol: string; bidPrice: string; bidQty: string; askPrice: string; askQty: string }) {
  return {
    symbol: ticker.symbol,
    bidPrice: ticker.bidPrice,
    bidQty: ticker.bidQty,
    askPrice: ticker.askPrice,
    askQty: ticker.askQty,
  }
}

export {
  buildSnapshot,
  parseArgs,
  run,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
