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
  workingType: "MARK_PRICE" | "CONTRACT_PRICE"
  priceProtect: boolean
  newClientOrderId: string
  timeout: number
  yes: boolean
  test: boolean
  checkEnv: boolean
}

interface EnvStatus {
  ok: boolean
  missing: string[]
}

type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

interface SpotOrderRequest {
  symbol: string
  side: Config["side"]
  type: string
  quantity?: string
  quoteOrderQty?: string
  price?: string
  newClientOrderId?: string
  timeInForce?: string
}

interface FuturesOrderRequest {
  symbol: string
  side: Config["side"]
  type: string
  quantity?: string
  price?: string
  stopPrice?: string
  newClientOrderId?: string
  timeInForce?: string
  positionSide: Config["positionSide"]
  reduceOnly?: string
  workingType?: Config["workingType"]
  priceProtect?: string
}

const SPOT_TYPES = new Set(["LIMIT", "MARKET", "LIMIT_MAKER"])
const USDM_TYPES = new Set(["LIMIT", "MARKET", "STOP", "STOP_MARKET"])

const HELP_TEXT = `Usage:
  ./scripts/main.ts --symbol BTCUSDT --market usdm --side BUY --type LIMIT --quantity 0.01 --price 65000 --yes

Key flags:
  --symbol <symbol>                  Required. Example: BTCUSDT
  --market <spot|usdm>               Default: usdm
  --side <BUY|SELL>                  Default: BUY
  --type <order-type>                Spot: LIMIT/MARKET/LIMIT_MAKER; USDM: LIMIT/MARKET/STOP/STOP_MARKET
  --quantity <qty>                   Required unless using --quote-order-qty
  --quote-order-qty <qty>            Spot only alternative
  --price <price>                    Required for limit-style orders
  --stop-price <price>               Required for STOP / STOP_MARKET
  --position-side <BOTH|LONG|SHORT>  Futures only. Default: BOTH
  --reduce-only <true|false>         Futures only
  --working-type <MARK_PRICE|CONTRACT_PRICE>
  --price-protect <true|false>
  --new-client-order-id <id>
  --timeout <ms>                     Default: 10000
  --test                             Spot only dry-run via orderTest
  --check-env                        Only validate BINANCE_API_KEY / BINANCE_API_SECRET
  --yes                              Required for live orders
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
    const envStatus = checkEnv()
    if (config.checkEnv) {
      return { ok: true, data: envStatus }
    }
    if (!envStatus.ok) {
      throw new Error(`missing environment variables: ${envStatus.missing.join(", ")}`)
    }

    if (!config.test) {
      requireConfirmation(config.yes)
    }

    const client = createClient(config.timeout)
    return { ok: true, data: await executeOrder(config, client) }
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
    workingType: "CONTRACT_PRICE",
    priceProtect: true,
    newClientOrderId: "",
    timeout: 10_000,
    yes: false,
    test: false,
    checkEnv: false,
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
      case "--working-type":
        config.workingType = readWorkingType(readFlagValue(argv, ++index, arg))
        break
      case "--price-protect":
        config.priceProtect = parseBoolean(readFlagValue(argv, ++index, arg), "--price-protect")
        break
      case "--new-client-order-id":
        config.newClientOrderId = readFlagValue(argv, ++index, arg)
        break
      case "--timeout":
        config.timeout = Number(readFlagValue(argv, ++index, arg))
        break
      case "--yes":
        config.yes = true
        break
      case "--test":
        config.test = true
        break
      case "--check-env":
        config.checkEnv = true
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  if (!config.checkEnv) {
    validateConfig(config)
  }

  return config
}

async function executeOrder(config: Config, client: BinanceRest) {
  if (config.market === "spot") {
    const request: SpotOrderRequest = {
      symbol: config.symbol,
      side: config.side,
      type: config.type,
      quantity: config.quantity || undefined,
      quoteOrderQty: config.quoteOrderQty || undefined,
      price: config.price || undefined,
      newClientOrderId: config.newClientOrderId || undefined,
      timeInForce: config.price ? config.timeInForce : undefined,
    }

    const result = config.test ? await client.orderTest(request as never) : await client.order(request as never)
    return {
      market: config.market,
      mode: config.test ? "test" : "live",
      method: config.test ? "orderTest" : "order",
      request,
      result,
    }
  }

  const reduceOnly = resolveReduceOnly(config)

  const request: FuturesOrderRequest = {
    symbol: config.symbol,
    side: config.side,
    type: config.type,
    quantity: config.quantity || undefined,
    price: config.price || undefined,
    stopPrice: config.stopPrice || undefined,
    newClientOrderId: config.newClientOrderId || undefined,
    timeInForce: config.price ? config.timeInForce : undefined,
    positionSide: config.positionSide,
    ...(reduceOnly !== undefined ? { reduceOnly } : {}),
    ...(config.stopPrice ? { workingType: config.workingType, priceProtect: String(config.priceProtect) } : {}),
  }

  const result = await client.futuresOrder(request as never)
  return {
    market: config.market,
    mode: "live",
    method: "futuresOrder",
    request,
    result,
  }
}

function validateConfig(config: Config): void {
  if (!config.symbol) {
    throw new Error("--symbol is required")
  }
  if (!config.quantity && !config.quoteOrderQty) {
    throw new Error("one of --quantity or --quote-order-qty is required")
  }
  if (config.market === "spot" && !SPOT_TYPES.has(config.type)) {
    throw new Error(`spot order-place only supports ${Array.from(SPOT_TYPES).join(", ")}`)
  }
  if (config.market === "usdm" && !USDM_TYPES.has(config.type)) {
    throw new Error(`usdm order-place only supports ${Array.from(USDM_TYPES).join(", ")}; use binance-position-protect for TP/SL`)
  }
  if (config.market === "usdm" && config.quoteOrderQty) {
    throw new Error("--quote-order-qty is only supported for spot")
  }
  if (requiresPrice(config.type) && !config.price) {
    throw new Error(`--price is required for ${config.type}`)
  }
  if (requiresStopPrice(config.type) && !config.stopPrice) {
    throw new Error(`--stop-price is required for ${config.type}`)
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
  return type === "LIMIT" || type === "LIMIT_MAKER" || type === "STOP"
}

function requiresStopPrice(type: string): boolean {
  return type === "STOP" || type === "STOP_MARKET"
}

function resolveReduceOnly(config: Config): string | undefined {
  if (config.positionSide !== "BOTH") {
    return undefined
  }
  return config.reduceOnly ? "true" : "false"
}

function checkEnv(): EnvStatus {
  const missing = ["BINANCE_API_KEY", "BINANCE_API_SECRET"].filter((name) => !process.env[name])
  return {
    ok: missing.length === 0,
    missing,
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

function requireConfirmation(confirmed: boolean, flag: string = "--yes"): void {
  if (!confirmed) {
    throw new Error(`this command changes live Binance state; re-run with ${flag} after reviewing binance-order-preview`)
  }
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
  executeOrder,
  parseArgs,
  run,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
