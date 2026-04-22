#!/usr/bin/env bun

import Binance, { type BinanceRest } from "binance-api-node"

type PositionSide = "BOTH" | "LONG" | "SHORT"
type OrderSide = "BUY" | "SELL"

interface Config {
  symbol: string
  positionSide: PositionSide
  reduceQuantity: string
  closePosition: boolean
  timeout: number
  recvWindow: number
  yes: boolean
  plan: boolean
  checkEnv: boolean
}

interface EnvStatus {
  ok: boolean
  missing: string[]
}

interface FuturesOrderRequest {
  symbol: string
  side: OrderSide
  type: "MARKET"
  quantity: string
  positionSide: PositionSide
}

interface PositionSnapshot {
  symbol: string
  positionSide: PositionSide
  quantity: string
  quantityAbs: number
  rawPositionAmt: string
  reduceSide: OrderSide
}

interface AdjustmentPlan {
  generatedAt: string
  market: "usdm"
  symbol: string
  positionSide: PositionSide
  currentPosition: PositionSnapshot
  reduction: {
    closePosition: boolean
    reduceQuantity: string
    remainingQuantity: string
  }
  reduceOrder: FuturesOrderRequest
}

type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

const HELP_TEXT = `Usage:
  ./scripts/main.ts --symbol BTCUSDT --position-side LONG --reduce-quantity 0.01 --plan
  ./scripts/main.ts --symbol BTCUSDT --position-side SHORT --close-position true --yes

Key flags:
  --symbol <symbol>                      Required. Example: BTCUSDT
  --position-side <BOTH|LONG|SHORT>      Default: BOTH
  --reduce-quantity <qty>                Required unless --close-position true
  --close-position <true|false>          Fully close the selected live position
  --timeout <ms>                         Default: 10000
  --recv-window <ms>                     Default: 60000
  --plan                                 Build live adjustment plan without mutating Binance state
  --check-env                            Only validate BINANCE_API_KEY / BINANCE_API_SECRET
  --yes                                  Required for live execution
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

    const client = createClient(config.timeout)
    const plan = await buildPlan(config, client)

    if (config.plan) {
      return { ok: true, data: plan }
    }

    requireConfirmation(config.yes)
    return { ok: true, data: await executeAdjustment(config, plan, client) }
  } catch (error) {
    return { ok: false, error: formatError(error) }
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    symbol: "",
    positionSide: "BOTH",
    reduceQuantity: "",
    closePosition: false,
    timeout: 10_000,
    recvWindow: 60_000,
    yes: false,
    plan: false,
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
      case "--reduce-quantity":
        config.reduceQuantity = readFlagValue(argv, ++index, arg)
        break
      case "--close-position":
        config.closePosition = parseBoolean(readFlagValue(argv, ++index, arg), "--close-position")
        break
      case "--timeout":
        config.timeout = Number(readFlagValue(argv, ++index, arg))
        break
      case "--recv-window":
        config.recvWindow = Number(readFlagValue(argv, ++index, arg))
        break
      case "--yes":
        config.yes = true
        break
      case "--plan":
        config.plan = true
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

async function buildPlan(config: Config, client: BinanceRest): Promise<AdjustmentPlan> {
  const positions = await client.futuresPositionRisk(withRecvWindow({ symbol: config.symbol }, config.recvWindow) as never)

  const livePosition = resolveLivePosition(config, positions)
  const scale = Math.max(decimalPlaces(livePosition.rawPositionAmt), decimalPlaces(config.reduceQuantity))
  const reduceQuantity = resolveReduceQuantity(config, livePosition, scale)
  const remainingQuantity = formatDecimal(livePosition.quantityAbs - Number(reduceQuantity), scale)

  return {
    generatedAt: nowInShanghai(),
    market: "usdm",
    symbol: config.symbol,
    positionSide: config.positionSide,
    currentPosition: livePosition,
    reduction: {
      closePosition: config.closePosition,
      reduceQuantity,
      remainingQuantity,
    },
    reduceOrder: {
      symbol: config.symbol,
      side: livePosition.reduceSide,
      type: "MARKET",
      quantity: reduceQuantity,
      positionSide: config.positionSide,
    },
  }
}

async function executeAdjustment(config: Config, plan: AdjustmentPlan, client: BinanceRest) {
  const reduced = await client.futuresOrder(plan.reduceOrder as never)
  const refreshedPosition = await fetchPostAdjustmentPosition(config, client)

  if (plan.reduction.remainingQuantity === "0") {
    if (refreshedPosition) {
      throw new Error(
        `expected ${config.symbol} ${config.positionSide} position to be flat after close, but live quantity is ${refreshedPosition.quantity}`,
      )
    }
    return {
      market: "usdm",
      symbol: config.symbol,
      reduced,
      remainingPosition: null,
    }
  }

  if (!refreshedPosition) {
    throw new Error("live position disappeared after partial reduction; refuse to place replacement protection")
  }
  if (!sameDirection(config.positionSide, refreshedPosition.positionSide)) {
    throw new Error(
      `live position side changed after adjustment: expected ${config.positionSide}, got ${refreshedPosition.positionSide}`,
    )
  }
  if (!roughlyEqual(Number(plan.reduction.remainingQuantity), refreshedPosition.quantityAbs)) {
    throw new Error(
      `live remaining quantity ${refreshedPosition.quantity} does not match planned remainder ${plan.reduction.remainingQuantity}`,
    )
  }

  return {
    market: "usdm",
    symbol: config.symbol,
    reduced,
    remainingPosition: refreshedPosition,
  }
}

function resolveLivePosition(config: Config, positions: unknown): PositionSnapshot {
  const candidate = findPosition(positions, config.positionSide)
  if (!candidate) {
    throw new Error(`no live ${config.positionSide} position found for ${config.symbol}`)
  }

  const rawPositionAmt = readStringField(candidate, "positionAmt")
  const quantityAbs = Math.abs(Number(rawPositionAmt))
  if (!Number.isFinite(quantityAbs) || quantityAbs <= 0) {
    throw new Error(`no live ${config.positionSide} position found for ${config.symbol}`)
  }

  if (config.positionSide === "LONG" && Number(rawPositionAmt) <= 0) {
    throw new Error(`expected live LONG position for ${config.symbol}, got ${rawPositionAmt}`)
  }
  if (config.positionSide === "SHORT" && Number(rawPositionAmt) >= 0) {
    throw new Error(`expected live SHORT position for ${config.symbol}, got ${rawPositionAmt}`)
  }

  const quantity = formatDecimal(quantityAbs, decimalPlaces(rawPositionAmt))
  return {
    symbol: config.symbol,
    positionSide: config.positionSide,
    quantity,
    quantityAbs,
    rawPositionAmt,
    reduceSide: inferReduceSide(config.positionSide, Number(rawPositionAmt)),
  }
}

function findPosition(positions: unknown, positionSide: PositionSide): Record<string, unknown> | null {
  if (!Array.isArray(positions)) {
    return null
  }
  const normalizedSide = positionSide.toUpperCase()
  const match = positions.find((item) => readStringField(item, "positionSide").toUpperCase() === normalizedSide)
  return isRecord(match) ? match : null
}

function resolveReduceQuantity(config: Config, livePosition: PositionSnapshot, scale: number): string {
  if (config.closePosition) {
    return livePosition.quantity
  }

  const reduceQuantity = Number(config.reduceQuantity)
  if (!Number.isFinite(reduceQuantity) || reduceQuantity <= 0) {
    throw new Error("--reduce-quantity must be greater than 0")
  }
  if (reduceQuantity > livePosition.quantityAbs) {
    throw new Error(
      `reduce quantity ${config.reduceQuantity} exceeds live ${config.positionSide} position ${livePosition.quantity}`,
    )
  }
  return formatDecimal(reduceQuantity, scale)
}

async function fetchPostAdjustmentPosition(
  config: Config,
  client: BinanceRest,
): Promise<PositionSnapshot | null> {
  const positions = await client.futuresPositionRisk(withRecvWindow({ symbol: config.symbol }, config.recvWindow) as never)
  try {
    return resolveLivePosition(config, positions)
  } catch {
    return null
  }
}

function validateConfig(config: Config): void {
  if (!config.symbol) {
    throw new Error("--symbol is required")
  }
  if (!config.closePosition && !config.reduceQuantity) {
    throw new Error("one of --reduce-quantity or --close-position true is required")
  }
  if (config.closePosition && config.reduceQuantity) {
    throw new Error("--reduce-quantity cannot be used with --close-position true")
  }
  if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
    throw new Error("--timeout must be greater than 0")
  }
  if (!Number.isFinite(config.recvWindow) || config.recvWindow <= 0) {
    throw new Error("--recv-window must be greater than 0")
  }
}

function inferReduceSide(positionSide: PositionSide, rawPositionAmt: number): OrderSide {
  if (positionSide === "LONG") {
    return "SELL"
  }
  if (positionSide === "SHORT") {
    return "BUY"
  }
  return rawPositionAmt > 0 ? "SELL" : "BUY"
}

function sameDirection(expected: PositionSide, actual: PositionSide): boolean {
  return expected === actual
}

function withRecvWindow<T extends Record<string, unknown>>(params: T, recvWindow: number): T & { recvWindow: number } {
  return { ...params, recvWindow }
}

function checkEnv(): EnvStatus {
  const missing = ["BINANCE_API_KEY", "BINANCE_API_SECRET"].filter((name) => !process.env[name])
  return { ok: missing.length === 0, missing }
}

function createClient(timeout: number): BinanceRest {
  return Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    timeout,
  })
}

function nowInShanghai(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00")
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[\/:_\-\s]/g, "")
}

function readPositionSide(value: string): PositionSide {
  const positionSide = value.trim().toUpperCase()
  if (positionSide !== "BOTH" && positionSide !== "LONG" && positionSide !== "SHORT") {
    throw new Error(`unsupported position side: ${value}`)
  }
  return positionSide
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
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

function decimalPlaces(value: string): number {
  const normalized = value.trim()
  const dot = normalized.indexOf(".")
  if (dot === -1) {
    return 0
  }
  return normalized.length - dot - 1
}

function formatDecimal(value: number, scale: number): string {
  const normalized = Number(value.toFixed(Math.max(scale, 0)))
  if (!Number.isFinite(normalized) || Math.abs(normalized) < 1e-12) {
    return "0"
  }
  return normalized.toFixed(Math.max(scale, 0)).replace(/\.?0+$/, "")
}

function roughlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-8
}

function printJSON(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function requireConfirmation(confirmed: boolean, flag: string = "--yes"): void {
  if (!confirmed) {
    throw new Error(`this command changes live Binance state; review --plan output and re-run with ${flag}`)
  }
}

function readStringField(value: unknown, key: string): string {
  if (!isRecord(value)) {
    return ""
  }
  const candidate = value[key]
  if (typeof candidate === "string") {
    return candidate
  }
  if (typeof candidate === "number") {
    return String(candidate)
  }
  return ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
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
  buildPlan,
  executeAdjustment,
  parseArgs,
  resolveLivePosition,
  run,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
