import Binance, { type BinanceRest } from "binance-api-node"

interface EnvStatus {
  ok: boolean
  missing: string[]
}

type ScriptResponse = { ok: true; data: unknown } | { ok: false; error: string; data?: unknown }
type OrderSide = "BUY" | "SELL"
type PositionSide = "BOTH" | "LONG" | "SHORT"
type WorkingType = "MARK_PRICE" | "CONTRACT_PRICE"

async function runBinanceMain(
  argv: string[],
  helpText: string,
  run: (argv: string[]) => Promise<ScriptResponse>,
): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(helpText)
    return
  }
  const response = await run(argv)
  printJSON(response)
  if (!response.ok) process.exit(1)
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

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[/:_\s-]/g, "")
}

function parseBoolean(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  throw new Error(`${name} must be true or false`)
}

function printJSON(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function requireConfirmation(confirmed: boolean, flag = "--yes"): void {
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

function readSide(value: string): OrderSide {
  const side = value.trim().toUpperCase()
  if (side !== "BUY" && side !== "SELL") throw new Error(`unsupported side: ${value}`)
  return side
}

function readPositionSide(value: string): PositionSide {
  const positionSide = value.trim().toUpperCase()
  if (positionSide !== "BOTH" && positionSide !== "LONG" && positionSide !== "SHORT") {
    throw new Error(`unsupported position side: ${value}`)
  }
  return positionSide
}

function readWorkingType(value: string): WorkingType {
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
  return ["STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET", "TRAILING_STOP_MARKET"].includes(type)
}

function requiresTimeInForce(type: string): boolean {
  return requiresPrice(type)
}

export {
  checkEnv,
  createClient,
  formatError,
  normalizeSymbol,
  parseBoolean,
  printJSON,
  readFlagValue,
  readPositionSide,
  readSide,
  readWorkingType,
  requireConfirmation,
  requiresPrice,
  requiresStopPrice,
  requiresTimeInForce,
  runBinanceMain,
  type EnvStatus,
  type PositionSide,
  type ScriptResponse,
}
