#!/usr/bin/env bun

import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import Binance, { type BinanceRest } from "binance-api-node"
import { buildExchangeCommandRef } from "../../../../../contracts/protocol-fabric/src/protocol-fabric"
import {
  buildExchangeCommand,
  buildExchangeResult,
  ensureExchangeRuntimeSchema,
  recordExchangeCommand,
  recordExchangeResult,
} from "../../../../exchange-runtime-store/src/lib/exchange-runtime-store"

interface Config {
  symbol: string
  orderId: number | null
  origClientOrderId: string
  algoId: number | null
  clientAlgoId: string
  all: boolean
  algo: boolean
  yes: boolean
  timeout: number
  checkEnv: boolean
  exchangeRuntimeDb: string
  requestedByRef: string
}

interface EnvStatus {
  ok: boolean
  missing: string[]
}

type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

const HELP_TEXT = `Usage:
  bun src/scripts/main.ts --symbol BTCUSDT --order-id 123456 --yes
  bun src/scripts/main.ts --symbol BTCUSDT --algo --all --yes

Key flags:
  --symbol <symbol>                  Required. Example: BTCUSDT
  --order-id <id>                    Regular order id
  --orig-client-order-id <id>        Regular client order id
  --algo-id <id>                     Futures algo order id
  --client-algo-id <id>              Futures algo client id
  --all                              Cancel all open orders in the selected bucket
  --algo                             Use futures algo cancel endpoints
  --timeout <ms>                     Default: 10000
  --check-env                        Only validate BINANCE_API_KEY / BINANCE_API_SECRET
  --exchange-runtime-db <path>       Optional audit DB for exchange_runtime_store
  --requested-by-ref <ref>           Optional upstream job / flow ref for exchange audit
  --yes                              Required for live cancellation
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
    const envStatus = checkEnv()
    if (config.checkEnv) {
      return { ok: true, data: envStatus }
    }
    if (!envStatus.ok) {
      throw new Error(`missing environment variables: ${envStatus.missing.join(", ")}`)
    }

    requireConfirmation(config.yes)
    const client = createClient(config.timeout)
    const data = await executeCancel(config, client)
    recordExchangeAuditIfEnabled(config, data)
    return { ok: true, data: withExchangeCommandRef(config, data) }
  } catch (error) {
    return { ok: false, error: formatError(error) }
  }
}

function withExchangeCommandRef(config: Config, execution: unknown): Record<string, unknown> {
  const executionRecord = asRecord(execution)
  const result = asRecord(executionRecord.result)
  const request = buildCancelAuditRequest(config)
  const clientOrderId = readClientOrderId(request, result) || `manual:${config.symbol}:cancel`
  const exchangeRef = readExchangeRef(result) || readExchangeRef(request)
  const commandType = readStringField(executionRecord, "method") || "binance_order_cancel"
  const requestedByRef = config.requestedByRef || clientOrderId || `manual:binance-order-cancel:${config.symbol}`
  const idempotencyKey = [
    "binance_order_cancel",
    config.symbol,
    clientOrderId || exchangeRef || commandType,
    requestedByRef,
  ].join(":")
  const commandRef = `exchange_runtime_store:command/exchange-command-${sanitizeId(idempotencyKey)}`
  return {
    ...executionRecord,
    exchange_command_ref: buildExchangeCommandRef({
      command_ref: commandRef,
      client_order_id: clientOrderId,
      action: "cancel_order",
      status: "confirmed",
      idempotency_key: idempotencyKey,
      request_ref: `${commandRef}:request`,
      result_ref: `${commandRef}:result`,
      exchange_order_ids: exchangeRef ? [exchangeRef] : [],
      source_intent_ref: requestedByRef,
    }),
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    symbol: "",
    orderId: null,
    origClientOrderId: "",
    algoId: null,
    clientAlgoId: "",
    all: false,
    algo: false,
    yes: false,
    timeout: 10_000,
    checkEnv: false,
    exchangeRuntimeDb: "",
    requestedByRef: "",
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--symbol":
        config.symbol = normalizeSymbol(readFlagValue(argv, ++index, arg))
        break
      case "--order-id":
        config.orderId = Number(readFlagValue(argv, ++index, arg))
        break
      case "--orig-client-order-id":
        config.origClientOrderId = readFlagValue(argv, ++index, arg)
        break
      case "--algo-id":
        config.algoId = Number(readFlagValue(argv, ++index, arg))
        break
      case "--client-algo-id":
        config.clientAlgoId = readFlagValue(argv, ++index, arg)
        break
      case "--all":
        config.all = true
        break
      case "--algo":
        config.algo = true
        break
      case "--yes":
        config.yes = true
        break
      case "--timeout":
        config.timeout = Number(readFlagValue(argv, ++index, arg))
        break
      case "--check-env":
        config.checkEnv = true
        break
      case "--exchange-runtime-db":
        config.exchangeRuntimeDb = readFlagValue(argv, ++index, arg)
        break
      case "--requested-by-ref":
        config.requestedByRef = readFlagValue(argv, ++index, arg)
        break
      case "--close-position":
        parseBoolean(readFlagValue(argv, ++index, arg), "--close-position")
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

async function executeCancel(config: Config, client: BinanceRest) {
  if (config.algo || config.algoId || config.clientAlgoId) {
    if (config.all) {
      const result = await client.futuresCancelAllAlgoOpenOrders({ symbol: config.symbol })
      return {
        method: "futuresCancelAllAlgoOpenOrders",
        result,
      }
    }

    const result = await client.futuresCancelAlgoOrder({
      symbol: config.symbol,
      algoId: config.algoId ?? undefined,
      clientAlgoId: config.clientAlgoId || undefined,
    })
    return {
      method: "futuresCancelAlgoOrder",
      result,
    }
  }

  if (config.all) {
    const result = await client.futuresCancelAllOpenOrders({ symbol: config.symbol })
    return {
      method: "futuresCancelAllOpenOrders",
      result,
    }
  }

  const result = await client.futuresCancelOrder({
    symbol: config.symbol,
    orderId: config.orderId ?? undefined,
    origClientOrderId: config.origClientOrderId || undefined,
  })
  return {
    method: "futuresCancelOrder",
    result,
  }
}

function recordExchangeAuditIfEnabled(config: Config, execution: unknown): void {
  if (!config.exchangeRuntimeDb) {
    return
  }
  const executionRecord = asRecord(execution)
  const result = asRecord(executionRecord.result)
  const request = buildCancelAuditRequest(config)
  const clientOrderId = readClientOrderId(request, result)
  const exchangeRef = readExchangeRef(result) || readExchangeRef(request)
  const commandType = readStringField(executionRecord, "method") || "binance_order_cancel"
  const requestedByRef = config.requestedByRef || clientOrderId || `manual:binance-order-cancel:${config.symbol}`
  const idempotencyKey = [
    "binance_order_cancel",
    config.symbol,
    clientOrderId || exchangeRef || commandType,
    requestedByRef,
  ].join(":")
  const commandId = `exchange-command-${sanitizeId(idempotencyKey)}`
  mkdirSync(dirname(config.exchangeRuntimeDb), { recursive: true })
  const db = new Database(config.exchangeRuntimeDb)
  try {
    ensureExchangeRuntimeSchema(db)
    recordExchangeCommand(db, buildExchangeCommand({
      command_id: commandId,
      idempotency_key: idempotencyKey,
      market: "binance_usdm",
      symbol: config.symbol,
      command_type: commandType,
      client_order_id: clientOrderId,
      requested_by_ref: requestedByRef,
      request_json: request,
      status: "cancelled",
      created_at: new Date().toISOString(),
    }))
    recordExchangeResult(db, buildExchangeResult({
      result_id: `${commandId}:result`,
      command_id: commandId,
      exchange_ref: exchangeRef,
      result_json: result,
      received_at: new Date().toISOString(),
    }))
  } finally {
    db.close()
  }
}

function buildCancelAuditRequest(config: Config): Record<string, unknown> {
  if (config.algo || config.algoId != null || config.clientAlgoId) {
    return {
      symbol: config.symbol,
      ...(config.all ? { all: true } : {}),
      ...(config.algoId != null ? { algoId: config.algoId } : {}),
      ...(config.clientAlgoId ? { clientAlgoId: config.clientAlgoId } : {}),
    }
  }
  return {
    symbol: config.symbol,
    ...(config.all ? { all: true } : {}),
    ...(config.orderId != null ? { orderId: config.orderId } : {}),
    ...(config.origClientOrderId ? { origClientOrderId: config.origClientOrderId } : {}),
  }
}

function validateConfig(config: Config): void {
  if (!config.symbol) {
    throw new Error("--symbol is required")
  }
  if (!config.all && config.orderId == null && !config.origClientOrderId && config.algoId == null && !config.clientAlgoId) {
    throw new Error("provide --all or one identifier such as --order-id, --orig-client-order-id, --algo-id, or --client-algo-id")
  }
  if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
    throw new Error("--timeout must be greater than 0")
  }
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function readStringField(value: unknown, field: string): string {
  const candidate = asRecord(value)
  return typeof candidate[field] === "string" ? candidate[field] : ""
}

function readNumberField(value: unknown, field: string): number | null {
  const candidate = asRecord(value)
  const raw = typeof candidate[field] === "string" || typeof candidate[field] === "number"
    ? Number(candidate[field])
    : NaN
  return Number.isFinite(raw) ? raw : null
}

function readClientOrderId(...values: Record<string, unknown>[]): string {
  for (const value of values) {
    const id = readStringField(value, "origClientOrderId")
      || readStringField(value, "clientOrderId")
      || readStringField(value, "clientAlgoId")
    if (id) {
      return id
    }
  }
  return ""
}

function readExchangeRef(...values: Record<string, unknown>[]): string {
  for (const value of values) {
    const id = readNumberField(value, "orderId") ?? readNumberField(value, "algoId")
    if (id != null) {
      return String(id)
    }
  }
  return ""
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, "-").slice(0, 160)
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

export {
  executeCancel,
  parseArgs,
  recordExchangeAuditIfEnabled,
  run,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
