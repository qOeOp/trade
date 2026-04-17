#!/usr/bin/env bun

import Binance, { type BinanceRest } from "binance-api-node"

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

interface EnvStatus {
  ok: boolean
  missing: string[]
}

type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

interface FuturesAlgoOrderRequest {
  symbol: string
  side: "BUY" | "SELL"
  positionSide: Config["positionSide"]
  quantity?: string
  closePosition?: boolean
  reduceOnly?: string
  workingType: Config["workingType"]
  priceProtect: string
  type: string
  triggerPrice?: string
  price?: string
  timeInForce?: string
  activationPrice?: string
  callbackRate?: string
}

const HELP_TEXT = `Usage:
  ./scripts/main.ts --symbol BTCUSDT --position-side LONG --quantity 0.01 --stop-loss-trigger 64000 --take-profit-trigger 68000 --yes

Key flags:
  --symbol <symbol>                      Required. Example: BTCUSDT
  --position-side <BOTH|LONG|SHORT>      Default: BOTH
  --side <BUY|SELL>                      Required when --position-side BOTH
  --quantity <qty>                       Required unless --close-position true
  --close-position <true|false>
  --stop-loss-trigger <price>
  --stop-loss-limit-price <price>
  --take-profit-trigger <price>
  --take-profit-limit-price <price>
  --trailing-activation-price <price>
  --callback-rate <pct>
  --working-type <MARK_PRICE|CONTRACT_PRICE>
  --price-protect <true|false>
  --timeout <ms>                         Default: 10000
  --check-env                            Only validate BINANCE_API_KEY / BINANCE_API_SECRET
  --yes                                  Required for live protection orders
  --help                                 Show this help
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

    requireConfirmation(config.yes)
    const client = createClient(config.timeout)
    return { ok: true, data: await executeProtection(config, client) }
  } catch (error) {
    return { ok: false, error: formatError(error) }
  }
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

async function executeProtection(config: Config, client: BinanceRest) {
  const side = config.side || inferProtectiveSide(config.positionSide)
  if (!side) {
    throw new Error("--side is required when --position-side BOTH")
  }

  const created = []
  for (const leg of buildLegs(config, side)) {
    const result = await client.futuresCreateAlgoOrder(leg.request as never)
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

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
