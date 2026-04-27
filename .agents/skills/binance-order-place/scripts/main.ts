#!/usr/bin/env bun

import { createHmac } from "node:crypto"
import Binance, { type BinanceRest } from "binance-api-node"

interface Config {
  symbol: string
  side: "BUY" | "SELL"
  type: string
  leverage: number | null
  quantity: string
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
  dryJson: boolean
  checkEnv: boolean
}

interface EnvStatus {
  ok: boolean
  missing: string[]
}

type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

interface FuturesLeverageAdjustment {
  targetLeverage: number
  previousLeverage: number | null
  changed: boolean
  result?: {
    leverage: number
    maxNotionalValue: string
    symbol: string
  }
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

interface FuturesAlgoOrderRequest {
  algoType: "CONDITIONAL"
  symbol: string
  side: Config["side"]
  type: string
  positionSide: Config["positionSide"]
  quantity?: string
  price?: string
  triggerPrice?: string
  timeInForce?: string
  workingType?: Config["workingType"]
  priceProtect?: string
}

interface BasicSymbolRules {
  priceTickSize: string
  quantityStepSize: string
  minQty: string
  minNotional: string
  referencePrice: string
}

interface SignedRequestOptions {
  apiKey: string
  apiSecret: string
  timeout: number
  fetchImpl?: typeof fetch
  httpBase?: string
}

interface ConfirmationOutcome {
  confirmedResult?: Record<string, unknown>
  confirmationWarning?: string
}

const USDM_TYPES = new Set(["LIMIT", "MARKET", "STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"])
const USDM_TIF = new Set(["GTC", "IOC", "GTX"])

const HELP_TEXT = `Usage:
  ./scripts/main.ts --symbol BTCUSDT --side BUY --type LIMIT --quantity 0.01 --price 65000 --yes

Key flags:
  --symbol <symbol>                  Required. Example: BTCUSDT
  --side <BUY|SELL>                  Default: BUY
  --type <order-type>                LIMIT/MARKET/STOP/STOP_MARKET/TAKE_PROFIT/TAKE_PROFIT_MARKET
  --leverage <1-125>                 If set, align symbol leverage before placing the order
  --quantity <qty>                   Required
  --price <price>                    Required for limit-style entry orders
  --stop-price <price>               Required for STOP / STOP_MARKET / TAKE_PROFIT / TAKE_PROFIT_MARKET
  --position-side <BOTH|LONG|SHORT>  Default: BOTH
  --reduce-only <true|false>
  --time-in-force <GTC|IOC|GTX>      Default: GTC. GTX = post-only
  --working-type <MARK_PRICE|CONTRACT_PRICE>
  --price-protect <true|false>
  --new-client-order-id <id>
  --timeout <ms>                     Default: 10000
  --test                             POST /fapi/v1/order/test
  --dry-json                         Print the final Binance request payload without sending
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
    if (config.dryJson) {
      return { ok: true, data: buildDryRun(config) }
    }
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
    await assertUsdmEntryIntent(config, client)
    await assertOrderWouldPassBasicSymbolRules(config, client)
    return { ok: true, data: await executeOrder(config, client) }
  } catch (error) {
    return { ok: false, error: formatError(error) }
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    symbol: "",
    side: "BUY",
    type: "LIMIT",
    leverage: null,
    quantity: "",
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
    dryJson: false,
    checkEnv: false,
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
      case "--leverage":
        config.leverage = readIntegerFlag(readFlagValue(argv, ++index, arg), "--leverage")
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
      case "--dry-json":
        config.dryJson = true
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
  if (config.test) {
    if (isUsdmAlgoEntryOrder(config)) {
      return {
        mode: "preview-only",
        method: "futuresCreateAlgoOrder",
        request: buildFuturesAlgoOrderRequest(config),
        warning: "Binance does not expose a test endpoint for futures algo entry orders; this payload was only validated locally",
      }
    }
    const request = buildFuturesOrderRequest(config)
    const result = await submitUsdmTestOrder(request, {
      apiKey: process.env.BINANCE_API_KEY ?? "",
      apiSecret: process.env.BINANCE_API_SECRET ?? "",
      timeout: config.timeout,
    })
    return {
      mode: "test",
      method: "futuresOrderTest",
      request,
      result,
    }
  }

  const leverageAdjustment = await ensureUsdmLeverage(config, client)
  const request = isUsdmAlgoEntryOrder(config)
    ? buildFuturesAlgoOrderRequest(config)
    : buildFuturesOrderRequest(config)
  const result = isUsdmAlgoEntryOrder(config)
    ? await client.futuresCreateAlgoOrder(cleanRequest(request) as never)
    : await client.futuresOrder(request as never)
  const confirmation = isUsdmAlgoEntryOrder(config)
    ? await confirmUsdmAlgoOrderState(config, client, result)
    : await confirmUsdmOrderState(config, client, result)
  return {
    mode: "live",
    method: isUsdmAlgoEntryOrder(config) ? "futuresCreateAlgoOrder" : "futuresOrder",
    ...(leverageAdjustment ? { leverageAdjustment } : {}),
    request,
    result,
    ...confirmation,
  }
}

function buildDryRun(config: Config) {
  return {
    method: isUsdmAlgoEntryOrder(config)
      ? "futuresCreateAlgoOrder"
      : (config.test ? "futuresOrderTest" : "futuresOrder"),
    ...(config.leverage != null
      ? {
          leverageAdjustment: {
            targetLeverage: config.leverage,
            changed: config.test ? "skipped-in-test-mode" : "unknown",
          },
        }
      : {}),
    ...(config.test && isUsdmAlgoEntryOrder(config)
      ? {
          warning: "Binance does not expose a test endpoint for futures algo entry orders; this payload was only validated locally",
        }
      : {}),
    request: isUsdmAlgoEntryOrder(config)
      ? buildFuturesAlgoOrderRequest(config)
      : buildFuturesOrderRequest(config),
  }
}

async function submitUsdmTestOrder(
  request: FuturesOrderRequest,
  options: SignedRequestOptions,
): Promise<unknown> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(request)) {
    if (value == null || value === "") {
      continue
    }
    query.set(key, String(value))
  }
  query.set("timestamp", String(Date.now()))

  const signature = createHmac("sha256", options.apiSecret)
    .update(query.toString())
    .digest("hex")
  query.set("signature", signature)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout)

  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${options.httpBase ?? "https://fapi.binance.com"}/fapi/v1/order/test?${query.toString()}`,
      {
        method: "POST",
        headers: {
          "X-MBX-APIKEY": options.apiKey,
        },
        signal: controller.signal,
      },
    )

    const raw = await response.text()
    const data = raw ? parseJSON(raw) : {}
    if (!response.ok) {
      throw new Error(readErrorMessage(data, response.status))
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

function buildFuturesOrderRequest(config: Config): FuturesOrderRequest {
  const reduceOnly = resolveReduceOnly(config)
  return {
    symbol: config.symbol,
    side: config.side,
    type: config.type,
    positionSide: config.positionSide,
    ...(config.quantity ? { quantity: config.quantity } : {}),
    ...(config.price ? { price: config.price } : {}),
    ...(config.stopPrice ? { stopPrice: config.stopPrice } : {}),
    ...(config.newClientOrderId ? { newClientOrderId: config.newClientOrderId } : {}),
    ...(requiresTimeInForce(config.type) ? { timeInForce: config.timeInForce } : {}),
    ...(reduceOnly !== undefined ? { reduceOnly } : {}),
    ...(config.stopPrice ? { workingType: config.workingType, priceProtect: String(config.priceProtect) } : {}),
  }
}

function buildFuturesAlgoOrderRequest(config: Config): FuturesAlgoOrderRequest {
  return {
    algoType: "CONDITIONAL",
    symbol: config.symbol,
    side: config.side,
    type: config.type,
    positionSide: config.positionSide,
    ...(config.quantity ? { quantity: config.quantity } : {}),
    ...(config.price ? { price: config.price } : {}),
    ...(config.stopPrice ? { triggerPrice: config.stopPrice } : {}),
    ...(requiresTimeInForce(config.type) ? { timeInForce: config.timeInForce } : {}),
    ...(config.stopPrice ? { workingType: config.workingType, priceProtect: String(config.priceProtect) } : {}),
  }
}

async function assertUsdmEntryIntent(config: Config, client: BinanceRest): Promise<void> {
  if (config.reduceOnly) {
    throw new Error("binance-order-place is open-only; reduce-only flows must use a dedicated close/adjust path")
  }

  const positions = await client.futuresPositionRisk({ symbol: config.symbol } as never)
  const currentAmt = readRelevantPositionAmt(positions, config.positionSide)

  if (wouldReduceOrFlip(config, currentAmt)) {
    throw new Error(
      `binance-order-place is open-only; current ${config.positionSide} position ${currentAmt} would be reduced or flipped by ${config.side} ${config.type}`,
    )
  }
}

async function ensureUsdmLeverage(
  config: Config,
  client: BinanceRest,
): Promise<FuturesLeverageAdjustment | undefined> {
  if (config.leverage == null) {
    return undefined
  }

  const positions = await client.futuresPositionRisk({ symbol: config.symbol } as never)
  const previousLeverage = readCurrentLeverage(positions)

  if (previousLeverage === config.leverage) {
    return {
      targetLeverage: config.leverage,
      previousLeverage,
      changed: false,
    }
  }

  const result = await client.futuresLeverage({
    symbol: config.symbol,
    leverage: config.leverage,
  })

  return {
    targetLeverage: config.leverage,
    previousLeverage,
    changed: true,
    result,
  }
}

async function confirmUsdmOrderState(
  config: Config,
  client: BinanceRest,
  placed: unknown,
): Promise<ConfirmationOutcome> {
  const getOrder = (client as BinanceRest & {
    futuresGetOrder?: (payload: { symbol: string; orderId?: number; origClientOrderId?: string }) => Promise<unknown>
  }).futuresGetOrder
  if (!getOrder) {
    return {}
  }

  const orderId = readNumberField(placed, "orderId")
  const clientOrderId = readStringField(placed, "clientOrderId")
  if (orderId == null && !clientOrderId) {
    return {}
  }

  return safeConfirmation("futures order status readback", () =>
    waitForFinalState(() =>
      getOrder({
        symbol: config.symbol,
        ...(orderId != null ? { orderId } : {}),
        ...(clientOrderId ? { origClientOrderId: clientOrderId } : {}),
      }),
    ),
  )
}

async function confirmUsdmAlgoOrderState(
  config: Config,
  client: BinanceRest,
  placed: unknown,
): Promise<ConfirmationOutcome> {
  const getAlgoOrder = (client as BinanceRest & {
    futuresGetAlgoOrder?: (payload: { symbol: string; algoId?: number; clientAlgoId?: string }) => Promise<unknown>
  }).futuresGetAlgoOrder
  const getOpenAlgoOrders = (client as BinanceRest & {
    futuresGetOpenAlgoOrders?: (payload?: { symbol?: string }) => Promise<unknown>
  }).futuresGetOpenAlgoOrders

  const algoId = readNumberField(placed, "algoId")
  const clientAlgoId = readStringField(placed, "clientAlgoId")
  if (algoId == null && !clientAlgoId) {
    return {}
  }

  return safeConfirmation("futures algo order status readback", async () => {
    if (getAlgoOrder) {
      try {
        return await waitForFinalState(() =>
          getAlgoOrder({
            symbol: config.symbol,
            ...(algoId != null ? { algoId } : {}),
            ...(clientAlgoId ? { clientAlgoId } : {}),
          }),
        )
      } catch {
        // Some newly created algo orders appear in the open list before single-order lookup is consistent.
      }
    }

    if (!getOpenAlgoOrders) {
      return undefined
    }

    const openOrders = await getOpenAlgoOrders({ symbol: config.symbol })
    if (!Array.isArray(openOrders)) {
      return undefined
    }
    const matched = openOrders.find((item) => {
      const openAlgoId = readNumberField(item, "algoId")
      const openClientAlgoId = readStringField(item, "clientAlgoId")
      return (algoId != null && openAlgoId === algoId) || (clientAlgoId && openClientAlgoId === clientAlgoId)
    })
    return asRecord(matched)
  })
}

async function waitForFinalState(read: () => Promise<unknown>): Promise<Record<string, unknown> | undefined> {
  const attempts = 4
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = await read()
    if (!needsFollowupConfirmation(snapshot) || attempt === attempts - 1) {
      return asRecord(snapshot)
    }
    await sleep(150 * (attempt + 1))
  }
  return undefined
}

async function safeConfirmation(
  label: string,
  confirm: () => Promise<Record<string, unknown> | undefined>,
): Promise<ConfirmationOutcome> {
  try {
    const confirmedResult = await confirm()
    return confirmedResult ? { confirmedResult } : {}
  } catch (error) {
    return { confirmationWarning: `${label} failed: ${formatError(error)}` }
  }
}

function needsFollowupConfirmation(snapshot: unknown): boolean {
  const status = readStringField(snapshot, "status")
  const executedQty = readStringField(snapshot, "executedQty")
  if (!status) {
    return false
  }
  return status === "NEW" && (executedQty === "" || executedQty === "0" || executedQty === "0.00")
}

async function assertOrderWouldPassBasicSymbolRules(config: Config, client: BinanceRest): Promise<void> {
  const rules = await readUsdmSymbolRules(config, client)

  if (config.quantity) {
    if (rules.minQty && compareDecimal(config.quantity, rules.minQty) < 0) {
      throw new Error(`${config.symbol} quantity ${config.quantity} is below minQty ${rules.minQty}`)
    }
    if (rules.quantityStepSize && !isAlignedToStep(config.quantity, rules.minQty || "0", rules.quantityStepSize)) {
      throw new Error(`${config.symbol} quantity ${config.quantity} does not align with stepSize ${rules.quantityStepSize}`)
    }
  }

  for (const [label, value] of [["--price", config.price], ["--stop-price", config.stopPrice]] as const) {
    if (!value || !rules.priceTickSize) {
      continue
    }
    if (!isAlignedToStep(value, "0", rules.priceTickSize)) {
      throw new Error(`${label} ${value} does not align with tickSize ${rules.priceTickSize} for ${config.symbol}`)
    }
  }

  const notional = estimateOrderNotional(config, rules.referencePrice)
  if (rules.minNotional && notional != null && notional < Number(rules.minNotional)) {
    throw new Error(
      `${config.symbol} order notional ${stripTrailingZeros(notional.toFixed(12))} is below min notional ${rules.minNotional}; increase size or choose a lower-priced symbol`,
    )
  }
}

async function readUsdmSymbolRules(config: Config, client: BinanceRest): Promise<BasicSymbolRules> {
  const [exchangeInfo, markPrice] = await Promise.all([
    client.futuresExchangeInfo(),
    config.price
      ? Promise.resolve(null)
      : client.futuresMarkPrice({ symbol: config.symbol } as never),
  ])

  const symbol = findExchangeSymbol(exchangeInfo, config.symbol)
  const priceFilter = findFilter(symbol, "PRICE_FILTER")
  const marketLotFilter = findFilter(symbol, "MARKET_LOT_SIZE")
  const lotFilter = findFilter(symbol, "LOT_SIZE")
  const minNotionalFilter = findFilter(symbol, "MIN_NOTIONAL")

  return {
    priceTickSize: readStringField(priceFilter, "tickSize"),
    quantityStepSize: readStringField(config.type === "MARKET" ? marketLotFilter ?? lotFilter : lotFilter, "stepSize"),
    minQty: readStringField(config.type === "MARKET" ? marketLotFilter ?? lotFilter : lotFilter, "minQty"),
    minNotional: readStringField(minNotionalFilter, "notional") || readStringField(minNotionalFilter, "minNotional"),
    referencePrice: markPrice?.markPrice ?? config.price ?? config.stopPrice ?? "",
  }
}

function findExchangeSymbol(exchangeInfo: unknown, symbol: string): unknown {
  if (!exchangeInfo || typeof exchangeInfo !== "object") {
    return null
  }
  const candidate = exchangeInfo as { symbols?: unknown }
  if (!Array.isArray(candidate.symbols)) {
    return null
  }
  return candidate.symbols.find((item) => readStringField(item, "symbol") === symbol) ?? null
}

function findFilter(symbolInfo: unknown, filterType: string): unknown {
  if (!symbolInfo || typeof symbolInfo !== "object") {
    return null
  }
  const candidate = symbolInfo as { filters?: unknown }
  if (!Array.isArray(candidate.filters)) {
    return null
  }
  return candidate.filters.find((item) => readStringField(item, "filterType") === filterType) ?? null
}

function estimateOrderNotional(config: Config, referencePrice: string): number | null {
  if (!config.quantity) {
    return null
  }

  const unitPrice = parsePositiveNumber(config.price || config.stopPrice || referencePrice)
  const quantity = parsePositiveNumber(config.quantity)
  if (unitPrice == null || quantity == null) {
    return null
  }
  return unitPrice * quantity
}

function readRelevantPositionAmt(
  positions: unknown,
  positionSide: Config["positionSide"],
): number {
  if (!Array.isArray(positions)) {
    return 0
  }

  if (positionSide === "BOTH") {
    const net = positions.find((item) => asPositionSide(item) === "BOTH")
    return net ? asPositionAmt(net) : 0
  }

  const hedgeLeg = positions.find((item) => asPositionSide(item) === positionSide)
  return hedgeLeg ? asPositionAmt(hedgeLeg) : 0
}

function readCurrentLeverage(positions: unknown): number | null {
  if (!Array.isArray(positions)) {
    return null
  }

  for (const item of positions) {
    const leverage = asLeverage(item)
    if (leverage != null) {
      return leverage
    }
  }

  return null
}

function wouldReduceOrFlip(config: Config, currentAmt: number): boolean {
  if (currentAmt === 0) {
    return false
  }

  if (config.positionSide === "LONG") {
    return config.side === "SELL"
  }
  if (config.positionSide === "SHORT") {
    return config.side === "BUY"
  }

  return (currentAmt > 0 && config.side === "SELL") || (currentAmt < 0 && config.side === "BUY")
}

function asPositionSide(value: unknown): string {
  if (!value || typeof value !== "object") {
    return ""
  }
  const candidate = value as { positionSide?: unknown }
  return typeof candidate.positionSide === "string" ? candidate.positionSide.toUpperCase() : ""
}

function asPositionAmt(value: unknown): number {
  if (!value || typeof value !== "object") {
    return 0
  }
  const candidate = value as { positionAmt?: unknown }
  const raw = typeof candidate.positionAmt === "string" || typeof candidate.positionAmt === "number"
    ? Number(candidate.positionAmt)
    : NaN
  return Number.isFinite(raw) ? raw : 0
}

function asLeverage(value: unknown): number | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const candidate = value as { leverage?: unknown }
  const raw = typeof candidate.leverage === "string" || typeof candidate.leverage === "number"
    ? Number(candidate.leverage)
    : NaN
  return Number.isInteger(raw) && raw > 0 ? raw : null
}

function validateConfig(config: Config): void {
  if (!config.symbol) {
    throw new Error("--symbol is required")
  }
  if (!USDM_TYPES.has(config.type)) {
    throw new Error(`order-place only supports ${Array.from(USDM_TYPES).join(", ")}; use binance-position-protect for TP/SL`)
  }
  if (!config.quantity) {
    throw new Error("order-place requires --quantity")
  }
  if (config.leverage != null && (config.leverage < 1 || config.leverage > 125)) {
    throw new Error("--leverage must be an integer between 1 and 125")
  }
  if (requiresPrice(config.type) && !config.price) {
    throw new Error(`--price is required for ${config.type}`)
  }
  if (requiresStopPrice(config.type) && !config.stopPrice) {
    throw new Error(`--stop-price is required for ${config.type}`)
  }
  if (requiresTimeInForce(config.type)) {
    if (!USDM_TIF.has(config.timeInForce)) {
      throw new Error(
        `--time-in-force ${config.timeInForce} is not valid for ${config.type}; supported: ${Array.from(USDM_TIF).join(", ")}`,
      )
    }
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
  return type === "LIMIT" || type === "STOP" || type === "TAKE_PROFIT"
}

function requiresStopPrice(type: string): boolean {
  return type === "STOP" || type === "STOP_MARKET" || type === "TAKE_PROFIT" || type === "TAKE_PROFIT_MARKET"
}

function requiresTimeInForce(type: string): boolean {
  return type === "LIMIT" || type === "STOP" || type === "TAKE_PROFIT"
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

function readIntegerFlag(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`)
  }
  return parsed
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

function parseJSON(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isUsdmAlgoEntryOrder(config: Config): boolean {
  return ["STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"].includes(config.type)
}

function cleanRequest(request: object): Record<string, string | boolean> {
  const cleaned: Record<string, string | boolean> = {}
  for (const [key, value] of Object.entries(request)) {
    if (value == null || value === "") {
      continue
    }
    if (typeof value === "string" || typeof value === "boolean") {
      cleaned[key] = value
    }
  }
  return cleaned
}

function readErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const candidate = data as { code?: unknown; msg?: unknown; message?: unknown }
    const code = candidate.code != null ? `code=${candidate.code} ` : ""
    if (typeof candidate.msg === "string") {
      return `${code}${candidate.msg}`.trim()
    }
    if (typeof candidate.message === "string") {
      return `${code}${candidate.message}`.trim()
    }
  }

  return `Binance request failed with status ${status}`
}

function readStringField(value: unknown, field: string): string {
  if (!value || typeof value !== "object") {
    return ""
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate[field] === "string" ? candidate[field] : ""
}

function parsePositiveNumber(value: string): number | null {
  if (!value) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function readNumberField(value: unknown, field: string): number | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const candidate = value as Record<string, unknown>
  const raw = typeof candidate[field] === "string" || typeof candidate[field] === "number"
    ? Number(candidate[field])
    : NaN
  return Number.isFinite(raw) ? raw : null
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined
}

function compareDecimal(left: string, right: string): number {
  const scale = Math.max(countFractionDigits(left), countFractionDigits(right))
  const leftInt = decimalToBigInt(left, scale)
  const rightInt = decimalToBigInt(right, scale)
  if (leftInt < rightInt) {
    return -1
  }
  if (leftInt > rightInt) {
    return 1
  }
  return 0
}

function isAlignedToStep(value: string, min: string, step: string): boolean {
  const stepNumber = parsePositiveNumber(step)
  if (stepNumber == null) {
    return true
  }
  const scale = Math.max(countFractionDigits(value), countFractionDigits(min), countFractionDigits(step))
  const valueInt = decimalToBigInt(value, scale)
  const minInt = decimalToBigInt(min, scale)
  const stepInt = decimalToBigInt(step, scale)
  if (stepInt === 0n || valueInt < minInt) {
    return false
  }
  return (valueInt - minInt) % stepInt === 0n
}

function countFractionDigits(value: string): number {
  const normalized = value.trim()
  const dot = normalized.indexOf(".")
  return dot === -1 ? 0 : normalized.length - dot - 1
}

function decimalToBigInt(value: string, scale: number): bigint {
  const normalized = value.trim()
  const negative = normalized.startsWith("-")
  const unsigned = negative ? normalized.slice(1) : normalized
  const [whole = "0", fraction = ""] = unsigned.split(".")
  const wholeDigits = whole.replace(/^0+(?=\d)/, "") || "0"
  const fractionDigits = (fraction + "0".repeat(scale)).slice(0, scale)
  const combined = `${wholeDigits}${fractionDigits}`.replace(/^0+(?=\d)/, "") || "0"
  const integer = BigInt(combined)
  return negative ? -integer : integer
}

function stripTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "").replace(/\.$/u, "")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export {
  assertUsdmEntryIntent,
  assertOrderWouldPassBasicSymbolRules,
  buildDryRun,
  buildFuturesAlgoOrderRequest,
  buildFuturesOrderRequest,
  ensureUsdmLeverage,
  executeOrder,
  submitUsdmTestOrder,
  readRelevantPositionAmt,
  readCurrentLeverage,
  parseArgs,
  run,
  wouldReduceOrFlip,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
