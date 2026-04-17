#!/usr/bin/env bun

import Binance, { type BinanceRest } from "binance-api-node"

interface Config {
  symbol: string
  market: "spot" | "usdm"
  side: "BUY" | "SELL"
  type: string
  quantity: string
  quoteOrderQty: string
  price: string
  stopPrice: string
  timeInForce: string
  positionSide: "BOTH" | "LONG" | "SHORT"
  reduceOnly: boolean
  closePosition: boolean
  workingType: "MARK_PRICE" | "CONTRACT_PRICE"
  priceProtect: boolean
  activationPrice: string
  callbackRate: string
  timeout: number
}

type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

const FUTURES_PROTECTIVE_TYPES = new Set([
  "STOP",
  "STOP_MARKET",
  "TAKE_PROFIT",
  "TAKE_PROFIT_MARKET",
  "TRAILING_STOP_MARKET",
])

const HELP_TEXT = `Usage:
  ./scripts/main.ts --symbol BTCUSDT --market usdm --side BUY --type LIMIT --quantity 0.01 --price 65000

Key flags:
  --symbol <symbol>                  Required. Example: BTCUSDT
  --market <spot|usdm>               Default: usdm
  --side <BUY|SELL>                  Default: BUY
  --type <order-type>                Default: LIMIT
  --quantity <qty>                   Base quantity
  --quote-order-qty <qty>            Spot quote quantity alternative
  --price <price>                    Required for limit-style orders
  --stop-price <price>               Trigger price for stop / take-profit orders
  --position-side <BOTH|LONG|SHORT>  Futures only. Default: BOTH
  --reduce-only <true|false>         Futures only
  --close-position <true|false>      Futures protective orders only
  --working-type <MARK_PRICE|CONTRACT_PRICE>
  --price-protect <true|false>
  --timeout <ms>                     Default: 10000
  --help                             Show this help
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
    return { ok: true, data: await buildPreview(config, client) }
  } catch (error) {
    return { ok: false, error: formatError(error) }
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    symbol: "",
    market: "usdm",
    side: "BUY",
    type: "LIMIT",
    quantity: "",
    quoteOrderQty: "",
    price: "",
    stopPrice: "",
    timeInForce: "GTC",
    positionSide: "BOTH",
    reduceOnly: false,
    closePosition: false,
    workingType: "CONTRACT_PRICE",
    priceProtect: true,
    activationPrice: "",
    callbackRate: "",
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
      case "--side":
        config.side = readSide(readFlagValue(argv, ++index, arg))
        break
      case "--type":
        config.type = readFlagValue(argv, ++index, arg).trim().toUpperCase()
        break
      case "--quantity":
        config.quantity = readFlagValue(argv, ++index, arg)
        break
      case "--quote-order-qty":
        config.quoteOrderQty = readFlagValue(argv, ++index, arg)
        break
      case "--price":
        config.price = readFlagValue(argv, ++index, arg)
        break
      case "--stop-price":
      case "--trigger-price":
        config.stopPrice = readFlagValue(argv, ++index, arg)
        break
      case "--time-in-force":
        config.timeInForce = readFlagValue(argv, ++index, arg).trim().toUpperCase()
        break
      case "--position-side":
        config.positionSide = readPositionSide(readFlagValue(argv, ++index, arg))
        break
      case "--reduce-only":
        config.reduceOnly = parseBoolean(readFlagValue(argv, ++index, arg), "--reduce-only")
        break
      case "--close-position":
        config.closePosition = parseBoolean(readFlagValue(argv, ++index, arg), "--close-position")
        break
      case "--working-type":
        config.workingType = readWorkingType(readFlagValue(argv, ++index, arg))
        break
      case "--price-protect":
        config.priceProtect = parseBoolean(readFlagValue(argv, ++index, arg), "--price-protect")
        break
      case "--activation-price":
        config.activationPrice = readFlagValue(argv, ++index, arg)
        break
      case "--callback-rate":
        config.callbackRate = readFlagValue(argv, ++index, arg)
        break
      case "--timeout":
        config.timeout = Number(readFlagValue(argv, ++index, arg))
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  validateConfig(config)
  return config
}

async function buildPreview(config: Config, client: BinanceRest) {
  const execution = resolveExecution(config)
  const marketContext = await fetchMarketContext(config, client)

  return {
    exchange: "binance",
    market: config.market,
    symbol: config.symbol,
    generatedAt: nowInShanghai(),
    request: buildRequest(config),
    execution,
    marketContext,
    warnings: buildWarnings(config, execution.method),
  }
}

function resolveExecution(config: Config) {
  if (isProtectiveFuturesAlgoOrder(config)) {
    return {
      method: "futuresCreateAlgoOrder",
      skill: "binance-position-protect",
      authRequired: true,
    }
  }

  return {
    method: config.market === "spot" ? "order" : "futuresOrder",
    skill: "binance-order-place",
    authRequired: true,
  }
}

async function fetchMarketContext(config: Config, client: BinanceRest) {
  if (config.market === "spot") {
    const [tickerPrice, bookTicker] = await Promise.all([
      client.tickerPrice({ symbol: config.symbol }),
      client.bookTicker({ symbol: config.symbol }),
    ])

    return {
      lastPrice: tickerPrice.price,
      bidPrice: bookTicker.bidPrice,
      askPrice: bookTicker.askPrice,
    }
  }

  const [prices, markPrice] = await Promise.all([
    client.futuresPrices({ symbol: config.symbol }),
    client.futuresMarkPrice({ symbol: config.symbol }),
  ])

  return {
    lastPrice: prices[config.symbol] || "",
    markPrice: markPrice.markPrice,
    lastFundingRate: markPrice.lastFundingRate,
    nextFundingTime: markPrice.nextFundingTime,
  }
}

function buildRequest(config: Config) {
  return {
    symbol: config.symbol,
    side: config.side,
    type: config.type,
    quantity: config.quantity || undefined,
    quoteOrderQty: config.quoteOrderQty || undefined,
    price: config.price || undefined,
    stopPrice: config.stopPrice || undefined,
    timeInForce: config.price ? config.timeInForce : undefined,
    positionSide: config.market === "usdm" ? config.positionSide : undefined,
    reduceOnly: config.market === "usdm" ? config.reduceOnly : undefined,
    closePosition: config.market === "usdm" ? config.closePosition : undefined,
    workingType: config.market === "usdm" ? config.workingType : undefined,
    priceProtect: config.market === "usdm" ? String(config.priceProtect) : undefined,
    activationPrice: config.activationPrice || undefined,
    callbackRate: config.callbackRate || undefined,
  }
}

function buildWarnings(config: Config, method: string): string[] {
  const warnings = []
  if (method === "futuresCreateAlgoOrder" && !config.closePosition && !config.quantity) {
    warnings.push("protective futures algo orders usually need --quantity or --close-position true")
  }
  if (config.market === "usdm" && config.positionSide === "BOTH" && config.reduceOnly) {
    warnings.push("reduceOnly on BOTH mode is valid, but verify the existing net position direction before executing")
  }
  if (config.market === "spot" && config.quoteOrderQty && config.quantity) {
    warnings.push("spot orders normally use either --quantity or --quote-order-qty, not both")
  }
  return warnings
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

function parseBoolean(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase()
  switch (normalized) {
    case "1":
    case "true":
    case "yes":
    case "y":
    case "on":
      return true
    case "0":
    case "false":
    case "no":
    case "n":
    case "off":
      return false
    default:
      throw new Error(`${name} must be true or false`)
  }
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

function isProtectiveFuturesAlgoOrder(config: Config): boolean {
  return config.market === "usdm" && FUTURES_PROTECTIVE_TYPES.has(config.type) && (config.reduceOnly || config.closePosition)
}

function validateConfig(config: Config): void {
  if (!config.symbol) {
    throw new Error("--symbol is required")
  }
  if (!config.side) {
    throw new Error("--side is required")
  }
  if (!config.type) {
    throw new Error("--type is required")
  }
  if (!config.quantity && !config.quoteOrderQty && !config.closePosition) {
    throw new Error("one of --quantity, --quote-order-qty, or --close-position true is required")
  }
  if (requiresPrice(config.type) && !config.price) {
    throw new Error(`--price is required for ${config.type}`)
  }
  if (requiresStopPrice(config.type) && !config.stopPrice && !config.activationPrice) {
    throw new Error(`--stop-price is required for ${config.type}`)
  }
  if (config.market === "spot" && FUTURES_PROTECTIVE_TYPES.has(config.type)) {
    throw new Error(`spot preview does not support ${config.type}; use spot order types`)
  }
  if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
    throw new Error("--timeout must be greater than 0")
  }
}

function readSide(value: string): "BUY" | "SELL" {
  const side = value.trim().toUpperCase()
  if (side !== "BUY" && side !== "SELL") {
    throw new Error(`unsupported side: ${value}`)
  }
  return side
}

function readPositionSide(value: string): "BOTH" | "LONG" | "SHORT" {
  const positionSide = value.trim().toUpperCase()
  if (positionSide !== "BOTH" && positionSide !== "LONG" && positionSide !== "SHORT") {
    throw new Error(`unsupported position side: ${value}`)
  }
  return positionSide
}

function readWorkingType(value: string): "MARK_PRICE" | "CONTRACT_PRICE" {
  const workingType = value.trim().toUpperCase()
  if (workingType !== "MARK_PRICE" && workingType !== "CONTRACT_PRICE") {
    throw new Error(`unsupported working type: ${value}`)
  }
  return workingType
}

function requiresPrice(type: string): boolean {
  return new Set(["LIMIT", "STOP", "TAKE_PROFIT"]).has(type)
}

function requiresStopPrice(type: string): boolean {
  return FUTURES_PROTECTIVE_TYPES.has(type)
}

export {
  buildPreview,
  isProtectiveFuturesAlgoOrder,
  parseArgs,
  resolveExecution,
  run,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
