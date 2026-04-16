#!/usr/bin/env node

import { asMap, createClient, fetchJSON, isBinanceSymbolInfo, nowInShanghai, parsePositiveNumber, printJSON, readFlagValue, runCLI, toFloat } from "../../src/binance/shared"

interface Config {
  market: "spot" | "usdm"
  direction: "both" | "long" | "short"
  minQuoteVolume: number
  limit: number
  timeout: number
}

interface Candidate {
  symbol: string
  lastPrice: string
  priceChangePercent: string
  quoteVolume: string
  tradeCount: number
  score: number
  tags: string[]
}

const DEFAULT_MIN_QUOTE_VOLUME = 20_000_000
const DEFAULT_LIMIT = 10

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
    return buildScan(config, client)
  })
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    market: "usdm",
    direction: "both",
    minQuoteVolume: DEFAULT_MIN_QUOTE_VOLUME,
    limit: DEFAULT_LIMIT,
    timeout: 20_000,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--market": {
        const market = readFlagValue(argv, ++index, arg).trim().toLowerCase()
        if (market !== "spot" && market !== "usdm") {
          throw new Error(`unsupported market: ${market}`)
        }
        config.market = market
        break
      }
      case "--direction": {
        const direction = readFlagValue(argv, ++index, arg).trim().toLowerCase()
        if (direction !== "both" && direction !== "long" && direction !== "short") {
          throw new Error(`unsupported direction: ${direction}`)
        }
        config.direction = direction
        break
      }
      case "--min-quote-volume":
        config.minQuoteVolume = parsePositiveNumber(readFlagValue(argv, ++index, arg), "--min-quote-volume")
        break
      case "--limit":
        config.limit = parsePositiveNumber(readFlagValue(argv, ++index, arg), "--limit")
        break
      case "--timeout":
        config.timeout = parsePositiveNumber(readFlagValue(argv, ++index, arg), "--timeout")
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  return config
}

async function buildScan(config: Config, client: ReturnType<typeof createClient>) {
  const [tradableSymbols, tickerRows] =
    config.market === "spot"
      ? await Promise.all([fetchSpotTradableSymbols(client), fetchSpotTickerRows()])
      : await Promise.all([fetchUsdmTradableSymbols(client), fetchUsdmTickerRows(client)])

  const { long, short, eligible } = buildCandidates(tradableSymbols, tickerRows, config)

  return {
    exchange: "binance",
    market: config.market,
    generatedAt: nowInShanghai(),
    filters: {
      direction: config.direction,
      minQuoteVolume: config.minQuoteVolume,
      limit: config.limit,
    },
    summary: {
      tradableSymbols: tradableSymbols.size,
      tickerRows: tickerRows.length,
      eligibleSymbols: eligible,
    },
    candidates: {
      long,
      short,
    },
  }
}

async function fetchSpotTradableSymbols(client: ReturnType<typeof createClient>): Promise<Set<string>> {
  const payload = await client.exchangeInfo()
  return extractTradableSymbols(asMap(payload).symbols, "spot")
}

async function fetchUsdmTradableSymbols(client: ReturnType<typeof createClient>): Promise<Set<string>> {
  const payload = await client.futuresExchangeInfo()
  return extractTradableSymbols(asMap(payload).symbols, "usdm")
}

async function fetchSpotTickerRows(): Promise<Record<string, unknown>[]> {
  const payload = await fetchJSON("https://api.binance.com/api/v3/ticker/24hr")
  return Array.isArray(payload) ? payload.filter((item) => item && typeof item === "object") as Record<string, unknown>[] : []
}

async function fetchUsdmTickerRows(client: ReturnType<typeof createClient>): Promise<Record<string, unknown>[]> {
  const payload = await client.futuresDailyStats()
  return Array.isArray(payload) ? payload.filter((item) => item && typeof item === "object") as Record<string, unknown>[] : []
}

function extractTradableSymbols(symbols: unknown, market: "spot" | "usdm"): Set<string> {
  const result = new Set<string>()
  if (!Array.isArray(symbols)) {
    return result
  }

  for (const item of symbols) {
    if (!isBinanceSymbolInfo(item)) {
      continue
    }
    if (item.status !== "TRADING") {
      continue
    }
    if (market === "spot" && item.quoteAsset !== "USDT") {
      continue
    }
    if (market === "usdm" && (item.quoteAsset !== "USDT" || item.contractType !== "PERPETUAL")) {
      continue
    }
    result.add(item.symbol)
  }
  return result
}

function buildCandidates(tradableSymbols: Set<string>, tickerRows: Record<string, unknown>[], config: Config) {
  const long: Candidate[] = []
  const short: Candidate[] = []
  let eligible = 0

  for (const row of tickerRows) {
    const symbol = String(row.symbol || "")
    if (!tradableSymbols.has(symbol)) {
      continue
    }

    const quoteVolume = toFloat(firstDefined(row.quoteVolume, row.volumeQuote))
    if (quoteVolume < config.minQuoteVolume) {
      continue
    }

    const change = toFloat(row.priceChangePercent)
    const lastPrice = String(firstDefined(row.lastPrice, row.askPrice, row.bidPrice, row.openPrice, row.open) || "")
    const tradeCount = Number(firstDefined(row.count, row.totalTrades) || 0)

    eligible += 1
    const candidate: Candidate = {
      symbol,
      lastPrice,
      priceChangePercent: String(row.priceChangePercent || ""),
      quoteVolume: String(firstDefined(row.quoteVolume, row.volumeQuote) || ""),
      tradeCount,
      score: scoreCandidate(change, quoteVolume),
      tags: buildTags(change, quoteVolume),
    }

    if (change > 0 && config.direction !== "short") {
      long.push(candidate)
    }
    if (change < 0 && config.direction !== "long") {
      short.push(candidate)
    }
  }

  long.sort((left, right) => right.score - left.score)
  short.sort((left, right) => right.score - left.score)

  return {
    long: long.slice(0, config.limit),
    short: short.slice(0, config.limit),
    eligible,
  }
}

function scoreCandidate(changePercent: number, quoteVolume: number): number {
  const magnitude = Math.abs(changePercent)
  const volumeScore = Math.log10(Math.max(quoteVolume, 1))
  return Number((magnitude * 100 + volumeScore * 10).toFixed(2))
}

function buildTags(changePercent: number, quoteVolume: number): string[] {
  const tags = []
  if (quoteVolume >= 1_000_000_000) {
    tags.push("very-liquid")
  } else if (quoteVolume >= 100_000_000) {
    tags.push("liquid")
  } else {
    tags.push("tradable")
  }

  if (changePercent >= 0) {
    tags.push("trend-up-day")
  } else {
    tags.push("trend-down-day")
  }

  if (Math.abs(changePercent) >= 15) {
    tags.push("event-risk")
  }

  return tags
}

function firstDefined<T>(...values: Array<T | null | undefined>): T | undefined {
  return values.find((value): value is T => value !== null && value !== undefined)
}

export {
  buildCandidates,
  buildScan,
  parseArgs,
  run,
}

if (require.main === module) {
  void main()
}
