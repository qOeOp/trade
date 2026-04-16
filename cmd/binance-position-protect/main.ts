#!/usr/bin/env node

import type { BinanceRest } from "binance-api-node"

import { checkEnv, createClient, normalizeSymbol, parseBoolean, printJSON, readFlagValue, requireConfirmation, runCLI } from "../../src/binance/shared"

interface Config {
  symbol: string
  positionSide: "BOTH" | "LONG" | "SHORT"
  side: "BUY" | "SELL" | ""
  quantity: string
  closePosition: boolean
  stopLossTrigger: string
  stopLossLimitPrice: string
  takeProfitTrigger: string
  takeProfitLimitPrice: string
  trailingActivationPrice: string
  callbackRate: string
  workingType: "MARK_PRICE" | "CONTRACT_PRICE"
  priceProtect: boolean
  timeout: number
  yes: boolean
  checkEnv: boolean
}

type FuturesAlgoOrderRequest = Parameters<BinanceRest["futuresCreateAlgoOrder"]>[0]

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

    requireConfirmation(config.yes)
    const client = createClient({ requiresAuth: true, timeout: config.timeout })
    return executeProtection(config, client)
  })
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    symbol: "",
    positionSide: "BOTH",
    side: "",
    quantity: "",
    closePosition: false,
    stopLossTrigger: "",
    stopLossLimitPrice: "",
    takeProfitTrigger: "",
    takeProfitLimitPrice: "",
    trailingActivationPrice: "",
    callbackRate: "",
    workingType: "CONTRACT_PRICE",
    priceProtect: true,
    timeout: 10_000,
    yes: false,
    checkEnv: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--symbol":
        config.symbol = normalizeSymbol(readFlagValue(argv, ++index, arg))
        break
      case "--position-side":
        config.positionSide = readPositionSide(readFlagValue(argv, ++index, arg))
        break
      case "--side":
        config.side = readSide(readFlagValue(argv, ++index, arg))
        break
      case "--quantity":
        config.quantity = readFlagValue(argv, ++index, arg)
        break
      case "--close-position":
        config.closePosition = parseBoolean(readFlagValue(argv, ++index, arg), "--close-position")
        break
      case "--stop-loss-trigger":
        config.stopLossTrigger = readFlagValue(argv, ++index, arg)
        break
      case "--stop-loss-limit-price":
        config.stopLossLimitPrice = readFlagValue(argv, ++index, arg)
        break
      case "--take-profit-trigger":
        config.takeProfitTrigger = readFlagValue(argv, ++index, arg)
        break
      case "--take-profit-limit-price":
        config.takeProfitLimitPrice = readFlagValue(argv, ++index, arg)
        break
      case "--trailing-activation-price":
        config.trailingActivationPrice = readFlagValue(argv, ++index, arg)
        break
      case "--callback-rate":
        config.callbackRate = readFlagValue(argv, ++index, arg)
        break
      case "--working-type":
        config.workingType = readWorkingType(readFlagValue(argv, ++index, arg))
        break
      case "--price-protect":
        config.priceProtect = parseBoolean(readFlagValue(argv, ++index, arg), "--price-protect")
        break
      case "--timeout":
        config.timeout = Number(readFlagValue(argv, ++index, arg))
        break
      case "--yes":
        config.yes = true
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

async function executeProtection(config: Config, client: ReturnType<typeof createClient>) {
  const side = config.side || inferProtectiveSide(config.positionSide)
  if (!side) {
    throw new Error("--side is required when --position-side BOTH")
  }

  const created = []
  for (const leg of buildLegs(config, side)) {
    const result = await client.futuresCreateAlgoOrder(leg.request)
    created.push({
      leg: leg.name,
      request: leg.request,
      result,
    })
  }

  return {
    market: "usdm",
    symbol: config.symbol,
    positionSide: config.positionSide,
    created,
  }
}

function buildLegs(config: Config, side: "BUY" | "SELL") {
  const common: Omit<FuturesAlgoOrderRequest, "type"> = {
    symbol: config.symbol,
    side: side as FuturesAlgoOrderRequest["side"],
    positionSide: config.positionSide,
    quantity: config.closePosition ? undefined : config.quantity,
    closePosition: config.closePosition || undefined,
    reduceOnly: config.closePosition ? undefined : "true",
    workingType: config.workingType,
    priceProtect: String(config.priceProtect),
  }

  const legs: Array<{ name: string; request: FuturesAlgoOrderRequest }> = []

  if (config.stopLossTrigger) {
    legs.push({
      name: "stopLoss",
      request: {
        ...common,
        type: config.stopLossLimitPrice ? "STOP" : "STOP_MARKET",
        triggerPrice: config.stopLossTrigger,
        price: config.stopLossLimitPrice || undefined,
        timeInForce: config.stopLossLimitPrice ? ("GTC" as FuturesAlgoOrderRequest["timeInForce"]) : undefined,
      },
    })
  }

  if (config.takeProfitTrigger) {
    legs.push({
      name: "takeProfit",
      request: {
        ...common,
        type: config.takeProfitLimitPrice ? "TAKE_PROFIT" : "TAKE_PROFIT_MARKET",
        triggerPrice: config.takeProfitTrigger,
        price: config.takeProfitLimitPrice || undefined,
        timeInForce: config.takeProfitLimitPrice ? ("GTC" as FuturesAlgoOrderRequest["timeInForce"]) : undefined,
      },
    })
  }

  if (config.trailingActivationPrice || config.callbackRate) {
    legs.push({
      name: "trailingStop",
      request: {
        ...common,
        type: "TRAILING_STOP_MARKET",
        activationPrice: config.trailingActivationPrice || undefined,
        callbackRate: config.callbackRate || undefined,
      },
    })
  }

  return legs
}

function validateConfig(config: Config): void {
  if (!config.symbol) {
    throw new Error("--symbol is required")
  }
  if (!config.stopLossTrigger && !config.takeProfitTrigger && !config.trailingActivationPrice && !config.callbackRate) {
    throw new Error("at least one protective leg is required")
  }
  if (!config.closePosition && !config.quantity) {
    throw new Error("--quantity is required unless --close-position true")
  }
  if ((config.trailingActivationPrice && !config.callbackRate) || (!config.trailingActivationPrice && config.callbackRate)) {
    throw new Error("--trailing-activation-price and --callback-rate must be used together")
  }
  if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
    throw new Error("--timeout must be greater than 0")
  }
}

function inferProtectiveSide(positionSide: "BOTH" | "LONG" | "SHORT"): "BUY" | "SELL" | "" {
  if (positionSide === "LONG") {
    return "SELL"
  }
  if (positionSide === "SHORT") {
    return "BUY"
  }
  return ""
}

function readPositionSide(value: string): "BOTH" | "LONG" | "SHORT" {
  const positionSide = value.trim().toUpperCase()
  if (positionSide !== "BOTH" && positionSide !== "LONG" && positionSide !== "SHORT") {
    throw new Error(`unsupported position side: ${value}`)
  }
  return positionSide
}

function readSide(value: string): "BUY" | "SELL" {
  const side = value.trim().toUpperCase()
  if (side !== "BUY" && side !== "SELL") {
    throw new Error(`unsupported side: ${value}`)
  }
  return side
}

function readWorkingType(value: string): "MARK_PRICE" | "CONTRACT_PRICE" {
  const workingType = value.trim().toUpperCase()
  if (workingType !== "MARK_PRICE" && workingType !== "CONTRACT_PRICE") {
    throw new Error(`unsupported working type: ${value}`)
  }
  return workingType
}

export {
  buildLegs,
  executeProtection,
  parseArgs,
  run,
}

if (require.main === module) {
  void main()
}
