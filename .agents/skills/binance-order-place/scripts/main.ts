#!/usr/bin/env bun

import type { BinanceRest } from "binance-api-node"

import { checkEnv, createClient, normalizeSymbol, parseBoolean, printJSON, readFlagValue, requireConfirmation, runScript } from "./shared"

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

type SpotOrderRequest = Parameters<BinanceRest["order"]>[0]
type SpotOrderTestRequest = Parameters<BinanceRest["orderTest"]>[0]
type FuturesOrderRequest = Parameters<BinanceRest["futuresOrder"]>[0]

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
    const envStatus = checkEnv()
    if (config.checkEnv) {
      return envStatus
    }
    if (!envStatus.ok) {
      throw new Error(`missing environment variables: ${envStatus.missing.join(", ")}`)
    }

    if (!config.test) {
      requireConfirmation(config.yes)
    }

    const client = createClient({ requiresAuth: true, timeout: config.timeout })
    return executeOrder(config, client)
  })
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

async function executeOrder(config: Config, client: ReturnType<typeof createClient>) {
  if (config.market === "spot") {
    const request: SpotOrderRequest & SpotOrderTestRequest = {
      symbol: config.symbol,
      side: config.side as SpotOrderRequest["side"],
      type: config.type as SpotOrderRequest["type"],
      quantity: config.quantity || undefined,
      quoteOrderQty: config.quoteOrderQty || undefined,
      price: config.price || undefined,
      newClientOrderId: config.newClientOrderId || undefined,
      timeInForce: config.price ? (config.timeInForce as SpotOrderRequest["timeInForce"]) : undefined,
    }

    const result = config.test ? await client.orderTest(request) : await client.order(request)
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
    side: config.side as FuturesOrderRequest["side"],
    type: config.type as FuturesOrderRequest["type"],
    quantity: config.quantity || undefined,
    price: config.price || undefined,
    stopPrice: config.stopPrice || undefined,
    newClientOrderId: config.newClientOrderId || undefined,
    timeInForce: config.price ? (config.timeInForce as FuturesOrderRequest["timeInForce"]) : undefined,
    positionSide: config.positionSide,
    ...(reduceOnly !== undefined ? { reduceOnly } : {}),
    ...(config.stopPrice ? { workingType: config.workingType, priceProtect: String(config.priceProtect) } : {}),
  }

  const result = await client.futuresOrder(request)
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

export {
  executeOrder,
  parseArgs,
  run,
}

if (require.main === module) {
  void main()
}
