#!/usr/bin/env node

import { createClient, normalizeSymbol, nowInShanghai, parsePositiveNumber, printJSON, readFlagValue, runCLI } from "../../src/binance/shared"

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

async function main(): Promise<void> {
  const response = await run(process.argv.slice(2))
  printJSON(response)
  if (!response.ok) {
    process.exit(1)
  }
}

async function run(argv: string[]) {
  return runCLI(async () => {
    const config = parseArgs(argv)
    const client = createClient({ timeout: config.timeout })
    return buildSnapshot(config, client)
  })
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

async function buildSnapshot(config: Config, client: ReturnType<typeof createClient>) {
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

if (require.main === module) {
  void main()
}
