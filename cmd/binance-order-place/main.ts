#!/usr/bin/env node

import type { BinanceRest } from "binance-api-node"

import { checkEnv, createClient, normalizeSymbol, parseBoolean, printJSON, readFlagValue, requireConfirmation, runCLI } from "../../src/binance/shared"

interface Config {
  symbol: string
  market: "spot" | "usdm"
  side: "BUY" | "SELL"
  type: string
  quantity: string
  quoteOrderQty: string
  price: string
  timeInForce: string
  positionSide: "BOTH" | "LONG" | "SHORT"
  reduceOnly: boolean
  newClientOrderId: string
  timeout: number
  yes: boolean
  test: boolean
  checkEnv: boolean
}

const SPOT_TYPES = new Set(["LIMIT", "MARKET", "LIMIT_MAKER"])
const USDM_TYPES = new Set(["LIMIT", "MARKET"])

type SpotOrderRequest = Parameters<BinanceRest["order"]>[0]
type SpotOrderTestRequest = Parameters<BinanceRest["orderTest"]>[0]
type FuturesOrderRequest = Parameters<BinanceRest["futuresOrder"]>[0]

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
    timeInForce: "GTC",
    positionSide: "BOTH",
    reduceOnly: false,
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
      case "--time-in-force":
        config.timeInForce = readFlagValue(argv, ++index, arg).trim().toUpperCase()
        break
      case "--position-side":
        config.positionSide = readPositionSide(readFlagValue(argv, ++index, arg))
        break
      case "--reduce-only":
        config.reduceOnly = parseBoolean(readFlagValue(argv, ++index, arg), "--reduce-only")
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

  const request: FuturesOrderRequest = {
    symbol: config.symbol,
    side: config.side as FuturesOrderRequest["side"],
    type: config.type as FuturesOrderRequest["type"],
    quantity: config.quantity || undefined,
    price: config.price || undefined,
    newClientOrderId: config.newClientOrderId || undefined,
    timeInForce: config.price ? (config.timeInForce as FuturesOrderRequest["timeInForce"]) : undefined,
    positionSide: config.positionSide,
    reduceOnly: config.reduceOnly ? "true" : undefined,
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
  if (config.type === "LIMIT" && !config.price) {
    throw new Error("--price is required for LIMIT")
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

export {
  executeOrder,
  parseArgs,
  run,
}

if (require.main === module) {
  void main()
}
