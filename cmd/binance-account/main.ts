#!/usr/bin/env node

import Binance, { type BinanceRest } from "binance-api-node"

type JSONMap = Record<string, unknown>

interface Config {
  symbol: string
  spotOnly: boolean
  futuresOnly: boolean
  checkEnv: boolean
  includeHistory: boolean
  historyLimit: number
  timeout: number
  recvWindow: number
}

interface EnvStatus {
  ok: boolean
  missing: string[]
}

interface OrderBuckets {
  regular: JSONMap[]
  protective: JSONMap[]
}

const ATTACHED_TP_SL_READ_STATUS = "unavailable_via_public_api"
const ATTACHED_TP_SL_READ_MESSAGE =
  "Binance public API does not currently return the attached TP/SL details for this OTO/OTOCO mother order."
const MANUAL_TP_SL_PROMPT =
  "Ask the user to provide the TP/SL prices they set manually for this order in the Binance app."

interface Snapshot {
  generatedAt: string
  symbolFilter: string | null
  spot: JSONMap | null
  futures: JSONMap | null
  errors: Record<string, string>
}

type CLIResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

const spotProtectiveTypes = new Set([
  "STOP_LOSS",
  "STOP_LOSS_LIMIT",
  "TAKE_PROFIT",
  "TAKE_PROFIT_LIMIT",
])

const futuresProtectiveTypes = new Set([
  "STOP",
  "STOP_MARKET",
  "TAKE_PROFIT",
  "TAKE_PROFIT_MARKET",
  "TRAILING_STOP_MARKET",
])

async function main(): Promise<void> {
  const response = await run(process.argv.slice(2))
  printJSON(response)
  if (!response.ok) {
    process.exit(1)
  }
}

function printJSON(value: unknown, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function run(argv: string[]): Promise<CLIResponse> {
  try {
    const config = parseArgs(argv)
    const envStatus = checkEnv()

    if (config.checkEnv) {
      return { ok: true, data: envStatus }
    }

    if (!envStatus.ok) {
      return {
        ok: false,
        error: "missing environment variables",
        data: envStatus,
      }
    }

    const client = Binance({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
    })

    const data = await buildSnapshot(config, client)
    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    symbol: "",
    spotOnly: false,
    futuresOnly: false,
    checkEnv: false,
    includeHistory: false,
    historyLimit: 20,
    timeout: 10,
    recvWindow: 60000,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--symbol":
        config.symbol = readFlagValue(argv, ++index, arg)
        break
      case "--spot-only":
        config.spotOnly = true
        break
      case "--futures-only":
        config.futuresOnly = true
        break
      case "--check-env":
        config.checkEnv = true
        break
      case "--include-history":
        config.includeHistory = true
        break
      case "--history-limit":
        config.historyLimit = Number(readFlagValue(argv, ++index, arg))
        break
      case "--timeout":
        config.timeout = Number(readFlagValue(argv, ++index, arg))
        break
      case "--recv-window":
        config.recvWindow = Number(readFlagValue(argv, ++index, arg))
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  if (config.spotOnly && config.futuresOnly) {
    throw new Error("--spot-only and --futures-only cannot be used together")
  }
  if (config.includeHistory && !config.symbol) {
    throw new Error("--include-history requires --symbol because Binance historical order endpoints are symbol-scoped")
  }
  if (!Number.isFinite(config.historyLimit) || config.historyLimit <= 0) {
    throw new Error("--history-limit must be greater than 0")
  }
  if (config.symbol) {
    config.symbol = config.symbol.toUpperCase()
  }

  return config
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function checkEnv(): EnvStatus {
  const required = ["BINANCE_API_KEY", "BINANCE_API_SECRET"]
  const missing = required.filter((name) => !process.env[name])
  return {
    ok: missing.length === 0,
    missing,
  }
}

async function buildSnapshot(config: Config, client: BinanceRest): Promise<Snapshot> {
  const errors: Record<string, string> = {}
  const params: { symbol?: string } = config.symbol ? { symbol: config.symbol } : {}
  const generatedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString()

  const [spot, futures] = await Promise.all([
    config.futuresOnly ? Promise.resolve(null) : buildSpotSnapshot(config, client, params, errors),
    config.spotOnly ? Promise.resolve(null) : buildFuturesSnapshot(config, client, params, errors),
  ])

  return {
    generatedAt,
    symbolFilter: config.symbol || null,
    spot,
    futures,
    errors,
  }
}

async function buildSpotSnapshot(
  config: Config,
  client: BinanceRest,
  params: { symbol?: string },
  errors: Record<string, string>,
): Promise<JSONMap> {
  const historyParams =
    config.includeHistory && config.symbol
      ? withRecvWindow(copyParamsWithLimit({ symbol: config.symbol }, config.historyLimit), config.recvWindow)
      : null

  const [account, openOrders, orderHistory] = await Promise.all([
    capture(errors, "spot.account", () => client.accountInfo()),
    capture(errors, "spot.openOrders", () => client.openOrders(withRecvWindow(params, config.recvWindow))),
    historyParams
      ? capture(errors, "spot.allOrders", () => client.allOrders(historyParams))
      : Promise.resolve<unknown>(null),
  ])

  const accountMap = asMap(account)
  const permissions = Array.isArray(accountMap.permissions)
    ? [...(accountMap.permissions as string[])]
    : []
  const rawBalances = Array.isArray(accountMap.balances) ? (accountMap.balances as JSONMap[]) : []
  const balances = rawBalances.filter(keepSpotBalance).map(normalizeSpotBalance)

  return {
    permissions,
    balances,
    openOrders: Array.isArray(openOrders)
      ? splitOrders(openOrders as JSONMap[], isSpotProtective, normalizeStandardOrder("openOrders", "standard"))
      : null,
    orderHistory:
      config.includeHistory && Array.isArray(orderHistory)
        ? splitOrders(orderHistory as JSONMap[], isSpotProtective, normalizeStandardOrder("allOrders", "standard"))
        : undefined,
  }
}

async function buildFuturesSnapshot(
  config: Config,
  client: BinanceRest,
  params: { symbol?: string },
  errors: Record<string, string>,
): Promise<JSONMap> {
  const historyParams =
    config.includeHistory && config.symbol
      ? withRecvWindow(copyParamsWithLimit({ symbol: config.symbol }, config.historyLimit), config.recvWindow)
      : null

  const [account, positions, openOrders, openAlgoOrders, orderHistory, algoHistory] = await Promise.all([
    capture(errors, "futures.account", () => client.futuresAccountInfo()),
    capture(errors, "futures.positionRisk", () => client.futuresPositionRisk(withRecvWindow(params, config.recvWindow))),
    capture(errors, "futures.openOrders", () => client.futuresOpenOrders(withRecvWindow(params, config.recvWindow))),
    capture(errors, "futures.openAlgoOrders", () =>
      client.futuresGetOpenAlgoOrders(withRecvWindow(params, config.recvWindow)),
    ),
    historyParams
      ? capture(errors, "futures.allOrders", () => client.futuresAllOrders(historyParams))
      : Promise.resolve<unknown>(null),
    historyParams
      ? capture(errors, "futures.allAlgoOrders", () => client.futuresGetAllAlgoOrders(historyParams))
      : Promise.resolve<unknown>(null),
  ])

  let buckets = Array.isArray(openOrders)
    ? splitOrders(openOrders as JSONMap[], isFuturesProtective, normalizeStandardOrder("openOrders", "standard"))
    : null
  if (Array.isArray(openAlgoOrders)) {
    buckets = appendProtectiveOrders(
      buckets,
      openAlgoOrders as JSONMap[],
      normalizeFuturesAlgoOrder("openAlgoOrders", "algo"),
    )
  }

  let historyBuckets =
    config.includeHistory && Array.isArray(orderHistory)
      ? splitOrders(orderHistory as JSONMap[], isFuturesProtective, normalizeStandardOrder("allOrders", "standard"))
      : undefined
  if (config.includeHistory && Array.isArray(algoHistory)) {
    historyBuckets = appendProtectiveOrders(
      historyBuckets ?? null,
      algoHistory as JSONMap[],
      normalizeFuturesAlgoOrder("allAlgoOrders", "algo"),
    )
  }

  const accountMap = asMap(account)
  const rawAssets = Array.isArray(accountMap.assets) ? (accountMap.assets as JSONMap[]) : []

  return {
    account: account
      ? {
          feeTier: accountMap.feeTier ?? null,
          canTrade: accountMap.canTrade ?? null,
          canDeposit: accountMap.canDeposit ?? null,
          canWithdraw: accountMap.canWithdraw ?? null,
          multiAssetsMargin: accountMap.multiAssetsMargin ?? null,
          totalWalletBalance: accountMap.totalWalletBalance,
          totalUnrealizedProfit: accountMap.totalUnrealizedProfit,
          totalMarginBalance: accountMap.totalMarginBalance,
          availableBalance: accountMap.availableBalance,
        }
      : {},
    balances: rawAssets.filter(keepFuturesAsset).map(normalizeFuturesAsset),
    positions: Array.isArray(positions) ? (positions as JSONMap[]).filter(keepPosition).map(normalizePosition) : null,
    openOrders: buckets,
    orderHistory: historyBuckets,
  }
}

async function capture<T>(
  errors: Record<string, string>,
  key: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    const value = await fn()
    delete errors[key]
    return value
  } catch (error) {
    errors[key] = formatError(key, error)
    return null
  }
}

function formatError(key: string, error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: string; responseText?: string }
    const code = candidate.code != null ? `code=${candidate.code} ` : ""
    const message = candidate.message || candidate.responseText || JSON.stringify(error)
    return `${key} failed: ${code}${message}`.trim()
  }
  return `${key} failed: ${String(error)}`
}

function withRecvWindow<T extends object>(params: T, recvWindow: number): T & { recvWindow: number } {
  return {
    ...params,
    recvWindow,
  }
}

function copyParamsWithLimit<T extends object>(params: T, limit: number): T & { limit: number } {
  return {
    ...params,
    limit,
  }
}

function keepSpotBalance(balance: JSONMap): boolean {
  return toFloat(balance.free) + toFloat(balance.locked) !== 0
}

function normalizeSpotBalance(balance: JSONMap): JSONMap {
  const free = toFloat(balance.free)
  const locked = toFloat(balance.locked)
  return {
    asset: balance.asset,
    free: balance.free,
    locked: balance.locked,
    total: (free + locked).toFixed(8),
  }
}

function keepFuturesAsset(asset: JSONMap): boolean {
  return ["walletBalance", "availableBalance", "unrealizedProfit", "marginBalance"].some(
    (field) => toFloat(asset[field]) !== 0,
  )
}

function normalizeFuturesAsset(asset: JSONMap): JSONMap {
  return {
    asset: asset.asset,
    walletBalance: asset.walletBalance,
    availableBalance: asset.availableBalance,
    marginBalance: asset.marginBalance,
    unrealizedProfit: asset.unrealizedProfit,
  }
}

function keepPosition(position: JSONMap): boolean {
  return toFloat(position.positionAmt) !== 0
}

function normalizePosition(position: JSONMap): JSONMap {
  return {
    symbol: position.symbol,
    positionSide: position.positionSide,
    positionAmt: position.positionAmt,
    entryPrice: position.entryPrice,
    breakEvenPrice: position.breakEvenPrice,
    markPrice: position.markPrice,
    unRealizedProfit: position.unRealizedProfit,
    liquidationPrice: position.liquidationPrice,
    leverage: position.leverage,
    marginType: position.marginType,
    notional: position.notional,
  }
}

function isSpotProtective(order: JSONMap): boolean {
  const type = String(order.type || "").toUpperCase()
  if (spotProtectiveTypes.has(type)) {
    return true
  }
  return order.orderListId != null && String(order.orderListId) !== "-1"
}

function isFuturesProtective(order: JSONMap): boolean {
  const type = String(firstDefined(order.type, order.orderType) || "").toUpperCase()
  if (futuresProtectiveTypes.has(type)) {
    return true
  }
  return String(order.closePosition || "").toLowerCase() === "true"
}

function normalizeStandardOrder(source: string, sourceType: string): (order: JSONMap) => JSONMap {
  return (order) => {
    const normalized: JSONMap = {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      status: order.status,
      origQty: order.origQty,
      price: order.price,
      stopPrice: order.stopPrice,
      timeInForce: order.timeInForce,
      orderId: order.orderId,
      source,
      sourceType,
    }

    copyField(order, normalized, "clientOrderId")
    copyField(order, normalized, "positionSide")
    copyField(order, normalized, "closePosition")
    copyField(order, normalized, "activatePrice")
    copyField(order, normalized, "priceRate")
    copyField(order, normalized, "reduceOnly")
    copyField(order, normalized, "workingType")
    copyField(order, normalized, "priceProtect")
    copyField(order, normalized, "origType")
    copyField(order, normalized, "executedQty")
    copyField(order, normalized, "updateTime")

    const strategyType = String(order.strategyType || "").trim().toUpperCase()
    if (strategyType) {
      normalized.strategyType = strategyType
      if (strategyType === "OTO" || strategyType === "OTOCO") {
        normalized.hasAttachedAlgoOrders = true
        normalized.attachedAlgoDetailsAvailable = false
        normalized.attachedTpSlReadStatus = ATTACHED_TP_SL_READ_STATUS
        normalized.attachedTpSlReadMessage = ATTACHED_TP_SL_READ_MESSAGE
        normalized.manualTpSlRequired = true
        normalized.manualTpSlPrompt = MANUAL_TP_SL_PROMPT
      }
    }

    return normalized
  }
}

function normalizeFuturesAlgoOrder(source: string, sourceType: string): (order: JSONMap) => JSONMap {
  return (order) => {
    const normalized: JSONMap = {
      symbol: order.symbol,
      side: order.side,
      type: firstDefined(order.orderType, order.type),
      status: firstDefined(order.algoStatus, order.status),
      origQty: firstDefined(order.quantity, order.origQty),
      price: order.price,
      stopPrice: firstDefined(order.triggerPrice, order.stopPrice),
      timeInForce: order.timeInForce,
      algoId: order.algoId,
      source,
      sourceType,
    }

    copyField(order, normalized, "clientAlgoId")
    copyField(order, normalized, "positionSide")
    copyField(order, normalized, "closePosition")
    copyField(order, normalized, "reduceOnly")
    copyField(order, normalized, "workingType")
    copyField(order, normalized, "priceProtect")
    copyField(order, normalized, "triggerTime")

    if (order.actualOrderId != null && String(order.actualOrderId) !== "") {
      normalized.actualOrderId = order.actualOrderId
    }

    return normalized
  }
}

function splitOrders(
  orders: JSONMap[],
  protective: (order: JSONMap) => boolean,
  normalize: (order: JSONMap) => JSONMap,
): OrderBuckets {
  const regular: JSONMap[] = []
  const protectiveOrders: JSONMap[] = []

  for (const order of orders) {
    const normalized = normalize(order)
    if (protective(order)) {
      protectiveOrders.push(normalized)
    } else {
      regular.push(normalized)
    }
  }

  return {
    regular,
    protective: protectiveOrders,
  }
}

function appendProtectiveOrders(
  buckets: OrderBuckets | null,
  orders: JSONMap[],
  normalize: (order: JSONMap) => JSONMap,
): OrderBuckets {
  const nextBuckets = buckets || { regular: [], protective: [] }
  for (const order of orders) {
    nextBuckets.protective.push(normalize(order))
  }
  return nextBuckets
}

function copyField(source: JSONMap, target: JSONMap, key: string): void {
  if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
    target[key] = source[key]
  }
}

function firstDefined<T>(...values: Array<T | null | undefined>): T | undefined {
  return values.find((value): value is T => value !== undefined && value !== null)
}

function toFloat(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function asMap(value: unknown): JSONMap {
  return value && typeof value === "object" ? (value as JSONMap) : {}
}

export {
  appendProtectiveOrders,
  buildSnapshot,
  capture,
  checkEnv,
  copyParamsWithLimit,
  firstDefined,
  formatError,
  isFuturesProtective,
  isSpotProtective,
  normalizeFuturesAlgoOrder,
  normalizeFuturesAsset,
  normalizePosition,
  normalizeSpotBalance,
  normalizeStandardOrder,
  parseArgs,
  run,
  splitOrders,
  withRecvWindow,
}

if (require.main === module) {
  void main()
}
