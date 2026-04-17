#!/usr/bin/env bun

import type { BinanceRest } from "binance-api-node"

import { createClient, normalizeSymbol, nowInShanghai, parseInteger, parsePositiveNumber, printJSON, readFlagValue, runScript, toFloat } from "./shared"

type JSONTrade = {
  aggId: number
  symbol: string
  price: string
  quantity: string
  firstId: number
  lastId: number
  timestamp: number
  isBuyerMaker: boolean
  wasBestPrice?: boolean
}

interface Config {
  symbol: string
  market: "spot" | "usdm"
  limit: number
  fromId?: number
  startTime?: number
  endTime?: number
  timeout: number
}

type SpotAggTradesRequest = Parameters<BinanceRest["aggTrades"]>[0]
type FuturesAggTradesRequest = Parameters<BinanceRest["futuresAggTrades"]>[0]

const HELP_TEXT = `Usage:
  ./scripts/main.ts --symbol BTCUSDT --market usdm --limit 500

Key flags:
  --symbol <symbol>         Required. Example: BTCUSDT
  --market <spot|usdm>      Default: usdm
  --limit <count>           Default: 500, max: 1000
  --from-id <id>            Resume from a specific aggTrade id
  --start-time <ms>         Inclusive start timestamp in ms
  --end-time <ms>           Inclusive end timestamp in ms
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

async function run(argv: string[]) {
  return runScript(async () => {
    const config = parseArgs(argv)
    const client = createClient({ timeout: config.timeout })
    return fetchAggTrades(config, client)
  })
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    symbol: "",
    market: "usdm",
    limit: 500,
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
      case "--limit":
        config.limit = parsePositiveNumber(readFlagValue(argv, ++index, arg), "--limit")
        break
      case "--from-id":
        config.fromId = parseInteger(readFlagValue(argv, ++index, arg), "--from-id")
        break
      case "--start-time":
        config.startTime = parseInteger(readFlagValue(argv, ++index, arg), "--start-time")
        break
      case "--end-time":
        config.endTime = parseInteger(readFlagValue(argv, ++index, arg), "--end-time")
        break
      case "--timeout":
        config.timeout = parsePositiveNumber(readFlagValue(argv, ++index, arg), "--timeout")
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  validateConfig(config)
  return config
}

async function fetchAggTrades(config: Config, client: ReturnType<typeof createClient>) {
  const request = buildRequest(config)
  const trades =
    config.market === "spot"
      ? await client.aggTrades(request as SpotAggTradesRequest)
      : await client.futuresAggTrades(request as FuturesAggTradesRequest)

  const normalizedTrades = trades.map(normalizeAggTrade)

  return {
    exchange: "binance",
    market: config.market,
    symbol: config.symbol,
    generatedAt: nowInShanghai(),
    request,
    summary: buildSummary(normalizedTrades),
    trades: normalizedTrades,
  }
}

function buildRequest(config: Config) {
  return {
    symbol: config.symbol,
    limit: config.limit,
    fromId: config.fromId,
    startTime: config.startTime,
    endTime: config.endTime,
  }
}

function normalizeAggTrade(trade: JSONTrade) {
  return {
    aggId: trade.aggId,
    symbol: trade.symbol,
    price: trade.price,
    quantity: trade.quantity,
    notional: (toFloat(trade.price) * toFloat(trade.quantity)).toFixed(8),
    firstId: trade.firstId,
    lastId: trade.lastId,
    timestamp: trade.timestamp,
    isBuyerMaker: trade.isBuyerMaker,
    takerSide: trade.isBuyerMaker ? "sell" : "buy",
    wasBestPrice: trade.wasBestPrice ?? null,
  }
}

function buildSummary(trades: ReturnType<typeof normalizeAggTrade>[]) {
  if (trades.length === 0) {
    return {
      count: 0,
      firstAggId: null,
      lastAggId: null,
      firstTimestamp: null,
      lastTimestamp: null,
    }
  }

  return {
    count: trades.length,
    firstAggId: trades[0].aggId,
    lastAggId: trades[trades.length - 1].aggId,
    firstTimestamp: trades[0].timestamp,
    lastTimestamp: trades[trades.length - 1].timestamp,
  }
}

function validateConfig(config: Config): void {
  if (!config.symbol) {
    throw new Error("--symbol is required")
  }
  if (!Number.isInteger(config.limit) || config.limit <= 0) {
    throw new Error("--limit must be a positive integer")
  }
  if (config.limit > 1000) {
    throw new Error("--limit cannot be greater than 1000")
  }
  if (config.fromId != null && config.fromId < 0) {
    throw new Error("--from-id must be greater than or equal to 0")
  }
  if (config.startTime != null && config.startTime < 0) {
    throw new Error("--start-time must be greater than or equal to 0")
  }
  if (config.endTime != null && config.endTime < 0) {
    throw new Error("--end-time must be greater than or equal to 0")
  }
  if (config.startTime != null && config.endTime != null && config.startTime > config.endTime) {
    throw new Error("--start-time cannot be greater than --end-time")
  }
}

export {
  buildRequest,
  buildSummary,
  fetchAggTrades,
  normalizeAggTrade,
  parseArgs,
  run,
}

if (require.main === module) {
  void main()
}
