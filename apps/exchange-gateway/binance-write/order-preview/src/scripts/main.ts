#!/usr/bin/env bun

import type { BinanceRest } from "binance-api-node"
import {
  createClient,
  formatError,
  normalizeSymbol,
  parseBoolean,
  readFlagValue,
  readPositionSide,
  readSide,
  readWorkingType,
  requiresPrice,
  requiresStopPrice,
  requiresTimeInForce,
  runBinanceMain,
  type ScriptResponse,
} from "../../../shared/binance-write-cli"
import { nowIsoUTC } from "../../../../../contracts/runtime-core/src/time"

interface Config {
  symbol: string
  side: "BUY" | "SELL"
  type: string
  quantity: string
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

const FUTURES_PROTECTIVE_TYPES = new Set([
  "STOP",
  "STOP_MARKET",
  "TAKE_PROFIT",
  "TAKE_PROFIT_MARKET",
  "TRAILING_STOP_MARKET",
])

const HELP_TEXT = `Usage:
  bun src/scripts/main.ts --symbol BTCUSDT --side BUY --type LIMIT --quantity 0.01 --price 65000

Key flags:
  --symbol <symbol>                  Required. Example: BTCUSDT
  --side <BUY|SELL>                  Default: BUY
  --type <order-type>                Default: LIMIT
  --quantity <qty>                   Base quantity
  --price <price>                    Required for limit-style orders
  --stop-price <price>               Trigger price for stop / take-profit orders
  --position-side <BOTH|LONG|SHORT>  Default: BOTH
  --reduce-only <true|false>
  --close-position <true|false>      Protective orders only
  --working-type <MARK_PRICE|CONTRACT_PRICE>
  --price-protect <true|false>
  --timeout <ms>                     Default: 10000
  --help                             Show this help
`

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
    side: "BUY",
    type: "LIMIT",
    quantity: "",
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
      case "--side":
        config.side = readSide(readFlagValue(argv, ++index, arg))
        break
      case "--type":
        config.type = readFlagValue(argv, ++index, arg).trim().toUpperCase()
        break
      case "--quantity":
        config.quantity = readFlagValue(argv, ++index, arg)
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
    market: "usdm",
    symbol: config.symbol,
    generated_at: nowIsoUTC(),
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
      tool: "binance-position-protect",
      authRequired: true,
    }
  }

  if (isUsdmAlgoOrder(config)) {
    return {
      method: "futuresCreateAlgoOrder",
      tool: "binance-order-place",
      authRequired: true,
    }
  }

  return {
    method: "futuresOrder",
    tool: "binance-order-place",
    authRequired: true,
  }
}

async function fetchMarketContext(config: Config, client: BinanceRest) {
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
  if (isUsdmAlgoOrder(config)) {
    return {
      algoType: "CONDITIONAL",
      symbol: config.symbol,
      side: config.side,
      type: config.type,
      quantity: config.quantity || undefined,
      price: config.price || undefined,
      triggerPrice: config.stopPrice || undefined,
      timeInForce: requiresTimeInForce(config.type) ? config.timeInForce : undefined,
      positionSide: config.positionSide,
      reduceOnly: config.reduceOnly,
      closePosition: config.closePosition,
      workingType: config.workingType,
      priceProtect: String(config.priceProtect),
      activationPrice: config.activationPrice || undefined,
      callbackRate: config.callbackRate || undefined,
    }
  }

  return {
    symbol: config.symbol,
    side: config.side,
    type: config.type,
    quantity: config.quantity || undefined,
    price: config.price || undefined,
    stopPrice: config.stopPrice || undefined,
    timeInForce: requiresTimeInForce(config.type) ? config.timeInForce : undefined,
    positionSide: config.positionSide,
    reduceOnly: config.reduceOnly,
    closePosition: config.closePosition,
    workingType: config.workingType,
    priceProtect: String(config.priceProtect),
    activationPrice: config.activationPrice || undefined,
    callbackRate: config.callbackRate || undefined,
  }
}

function buildWarnings(config: Config, method: string): string[] {
  const warnings = []
  if (method === "futuresCreateAlgoOrder" && !config.closePosition && !config.quantity) {
    warnings.push("protective futures algo orders usually need --quantity or --close-position true")
  }
  if (config.positionSide === "BOTH" && config.reduceOnly) {
    warnings.push("reduceOnly on BOTH mode is valid, but verify the existing net position direction before executing")
  }
  return warnings
}

function isProtectiveFuturesAlgoOrder(config: Config): boolean {
  return FUTURES_PROTECTIVE_TYPES.has(config.type) && (config.reduceOnly || config.closePosition)
}

function isUsdmAlgoOrder(config: Config): boolean {
  return FUTURES_PROTECTIVE_TYPES.has(config.type)
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
  if (!config.quantity && !config.closePosition) {
    throw new Error("one of --quantity or --close-position true is required")
  }
  if (requiresPrice(config.type) && !config.price) {
    throw new Error(`--price is required for ${config.type}`)
  }
  if (requiresStopPrice(config.type) && !config.stopPrice && !config.activationPrice) {
    throw new Error(`--stop-price is required for ${config.type}`)
  }
  if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
    throw new Error("--timeout must be greater than 0")
  }
}

export {
  buildPreview,
  isProtectiveFuturesAlgoOrder,
  parseArgs,
  resolveExecution,
  run,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void runBinanceMain(process.argv.slice(2), HELP_TEXT, run)
}
