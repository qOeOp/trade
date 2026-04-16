import Binance, { type BinanceRest } from "binance-api-node"

type JSONMap = Record<string, unknown>

type CLIResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

interface EnvStatus {
  ok: boolean
  missing: string[]
}

interface BinanceClientOptions {
  requiresAuth?: boolean
  timeout?: number
}

const REQUIRED_ENV = ["BINANCE_API_KEY", "BINANCE_API_SECRET"]

function printJSON(value: unknown, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function runCLI(fn: () => Promise<unknown>): Promise<CLIResponse> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    return { ok: false, error: formatError(error) }
  }
}

function checkEnv(): EnvStatus {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name])
  return {
    ok: missing.length === 0,
    missing,
  }
}

function createClient(options: BinanceClientOptions = {}): BinanceRest {
  const envStatus = checkEnv()
  if (options.requiresAuth && !envStatus.ok) {
    throw new Error(`missing environment variables: ${envStatus.missing.join(", ")}`)
  }

  return Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    timeout: options.timeout,
  })
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
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

function parseNumber(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`)
  }
  return parsed
}

function parseInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`)
  }
  return parsed
}

function parsePositiveNumber(value: string, name: string): number {
  const parsed = parseNumber(value, name)
  if (parsed <= 0) {
    throw new Error(`${name} must be greater than 0`)
  }
  return parsed
}

function asMap(value: unknown): JSONMap {
  return value && typeof value === "object" ? (value as JSONMap) : {}
}

function toFloat(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isBinanceSymbolInfo(value: unknown): value is { symbol: string; status?: string; quoteAsset?: string; contractType?: string } {
  return Boolean(value && typeof value === "object" && "symbol" in (value as JSONMap))
}

function nowInShanghai(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00")
}

async function fetchJSON(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`request failed: ${response.status} ${response.statusText}`)
  }
  return response.json()
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

function requireConfirmation(confirmed: boolean, flag: string = "--yes"): void {
  if (!confirmed) {
    throw new Error(`this command changes live Binance state; re-run with ${flag} after reviewing binance-order-preview`)
  }
}

export {
  asMap,
  checkEnv,
  createClient,
  fetchJSON,
  formatError,
  isBinanceSymbolInfo,
  normalizeSymbol,
  nowInShanghai,
  parseBoolean,
  parseInteger,
  parseNumber,
  parsePositiveNumber,
  printJSON,
  readFlagValue,
  requireConfirmation,
  runCLI,
  toFloat,
}

export type {
  CLIResponse,
  EnvStatus,
  JSONMap,
}
