#!/usr/bin/env bun

import Binance, { type BinanceRest } from "binance-api-node"

interface Config {
  direction: "both" | "long" | "short"
  minQuoteVolume: number
  limitPerSide: number
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

type JSONMap = Record<string, unknown>

type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

const DEFAULT_MIN_QUOTE_VOLUME = 20_000_000
const DEFAULT_LIMIT_PER_SIDE = 10

const HELP_TEXT = `Usage:
  ./scripts/main.ts
  ./scripts/main.ts --direction long --limit-per-side 8

Key flags:
  --direction <both|long|short>   Default: both
  --min-quote-volume <amount>     Default: 20000000
  --limit-per-side <count>        Default: 10
  --timeout <ms>                  Default: 20000
  --help                          Show this help
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
    return { ok: true, data: await buildScan(config, client) }
  } catch (error) {
    return { ok: false, error: formatError(error) }
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    direction: "both",
    minQuoteVolume: DEFAULT_MIN_QUOTE_VOLUME,
    limitPerSide: DEFAULT_LIMIT_PER_SIDE,
    timeout: 20_000,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
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
      case "--limit-per-side":
        config.limitPerSide = parsePositiveNumber(readFlagValue(argv, ++index, arg), "--limit-per-side")
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

async function buildScan(config: Config, client: BinanceRest) {
  const [tradableSymbols, tickerRows] = await Promise.all([
    fetchUsdmTradableSymbols(client),
    fetchUsdmTickerRows(client),
  ])

  const { long, short, eligible } = buildCandidates(tradableSymbols, tickerRows, config)

  return {
    exchange: "binance",
    market: "usdm",
    generatedAt: nowInShanghai(),
    filters: {
      direction: config.direction,
      minQuoteVolume: config.minQuoteVolume,
      limitPerSide: config.limitPerSide,
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

async function fetchUsdmTradableSymbols(client: BinanceRest): Promise<Set<string>> {
  const payload = await client.futuresExchangeInfo()
  return extractTradableSymbols(asMap(payload).symbols)
}

async function fetchUsdmTickerRows(client: BinanceRest): Promise<Record<string, unknown>[]> {
  const payload = await client.futuresDailyStats()
  return Array.isArray(payload) ? payload.filter((item) => item && typeof item === "object") as Record<string, unknown>[] : []
}

function extractTradableSymbols(symbols: unknown): Set<string> {
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
    if (item.quoteAsset !== "USDT" || item.contractType !== "PERPETUAL") {
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
    long: long.slice(0, config.limitPerSide),
    short: short.slice(0, config.limitPerSide),
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

function asMap(value: unknown): JSONMap {
  return value && typeof value === "object" ? (value as JSONMap) : {}
}

function createClient(timeout: number): BinanceRest {
  return Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    timeout,
  })
}

function isBinanceSymbolInfo(value: unknown): value is { symbol: string; status?: string; quoteAsset?: string; contractType?: string } {
  return Boolean(value && typeof value === "object" && "symbol" in (value as JSONMap))
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

function toFloat(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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

function firstDefined<T>(...values: Array<T | null | undefined>): T | undefined {
  return values.find((value): value is T => value !== null && value !== undefined)
}

export {
  buildCandidates,
  buildScan,
  parseArgs,
  run,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
