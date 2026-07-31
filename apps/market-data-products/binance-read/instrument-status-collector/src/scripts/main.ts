#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { canonicalHash } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  commitInstrumentStatusAcquisitionReceipt,
  createInstrumentStatusAcquisitionAttempt,
  createInstrumentStatusAcquisitionReceipt,
  ensureMarketDataSchema,
  instrumentStatusPayloadHash,
  readInstrumentStatusAcquisitionPayload,
  readInstrumentStatusAcquisitionReceipt,
  type InstrumentStatusAcquisitionAttempt,
  type InstrumentStatusAcquisitionReceipt,
} from "../../../../market-data-store/src/lib/market-data-store"

const EXCHANGE_INFO_ENDPOINT = "https://fapi.binance.com/fapi/v1/exchangeInfo"

interface Config {
  symbol: string
  dbPath: string
  acquisitionId: string
  timeoutMs: number
  maxAttempts: number
}

interface Dependencies {
  fetchFn?: FetchFn
  now?: () => string
  sleep?: (milliseconds: number) => Promise<void>
}

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type CollectorResponse =
  | { ok: true; data: { receipt: InstrumentStatusAcquisitionReceipt; commit_status: "created" | "existing"; observed_status: string } }
  | { ok: false; error: string; data?: { receipt: InstrumentStatusAcquisitionReceipt; commit_status: "created" | "existing" } }

export function parseArgs(argv: string[]): Config {
  let symbol = ""
  let dbPath = "data/market_data.db"
  let acquisitionId = ""
  let timeoutMs = 10_000
  let maxAttempts = 3
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--symbol") symbol = (argv[++index] ?? "").trim().toUpperCase()
    else if (arg === "--db") dbPath = argv[++index] ?? dbPath
    else if (arg === "--acquisition-id") acquisitionId = argv[++index] ?? ""
    else if (arg === "--timeout-ms") timeoutMs = positiveInteger(argv[++index], arg, 60_000)
    else if (arg === "--max-attempts") maxAttempts = positiveInteger(argv[++index], arg, 5)
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!/^[A-Z0-9]{3,32}$/.test(symbol)) throw new Error("--symbol is required and must be a Binance symbol")
  if (!acquisitionId) acquisitionId = `binance-usdm-${symbol.toLowerCase()}-${Date.now()}`
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(acquisitionId)) throw new Error("--acquisition-id is invalid")
  return { symbol, dbPath, acquisitionId, timeoutMs, maxAttempts }
}

export async function run(argv: string[], dependencies: Dependencies = {}): Promise<CollectorResponse> {
  try {
    const config = parseArgs(argv)
    const fetchFn = dependencies.fetchFn ?? fetch
    const now = dependencies.now ?? (() => new Date().toISOString())
    const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    const existing = readExistingAcquisition(config)
    if (existing) return existing
    const requestedAt = now()
    const attempts: InstrumentStatusAcquisitionAttempt[] = []
    const payloads: Record<string, string> = {}
    let observedStatus = ""

    for (let ordinal = 1; ordinal <= config.maxAttempts; ordinal += 1) {
      const startedAt = now()
      const payloadRef = `market-data-store:instrument-status-source-payload:${config.acquisitionId}:${ordinal}`
      const attemptResult = await acquireOnce({ config, fetchFn, now, startedAt, payloadRef, ordinal })
      attempts.push(attemptResult.attempt)
      if (attemptResult.payload !== null) payloads[payloadRef] = attemptResult.payload
      if (attemptResult.attempt.outcome === "succeeded") {
        observedStatus = attemptResult.observedStatus
        break
      }
      if (!attemptResult.attempt.retryable || ordinal === config.maxAttempts) break
      await sleep(100 * ordinal)
    }

    const completedAt = attempts.at(-1)!.completed_at
    const receipt = createInstrumentStatusAcquisitionReceipt({
      acquisition_id: config.acquisitionId,
      venue_id: "binance-usdm",
      symbol: config.symbol,
      source_capability: "current_snapshot_only",
      transport: "binance_usdm_rest",
      method: "GET",
      endpoint: EXCHANGE_INFO_ENDPOINT,
      request_params_hash: canonicalHash({ endpoint: EXCHANGE_INFO_ENDPOINT, symbol: config.symbol }),
      requested_coverage_start: null,
      requested_coverage_end: null,
      source_observed_through: completedAt,
      requested_at: requestedAt,
      completed_at: completedAt,
      terminal_status: attempts.at(-1)!.outcome,
      attempts,
    })
    mkdirSync(dirname(config.dbPath), { recursive: true })
    const db = new Database(config.dbPath)
    let commitStatus: "created" | "existing"
    try {
      ensureMarketDataSchema(db)
      commitStatus = commitInstrumentStatusAcquisitionReceipt(db, receipt, payloads)
    } finally {
      db.close()
    }
    if (receipt.terminal_status === "failed") {
      return { ok: false, error: `instrument status acquisition failed: ${attempts.at(-1)!.failure_class}`, data: { receipt, commit_status: commitStatus } }
    }
    return { ok: true, data: { receipt, commit_status: commitStatus, observed_status: observedStatus } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function readExistingAcquisition(config: Config): CollectorResponse | null {
  mkdirSync(dirname(config.dbPath), { recursive: true })
  const db = new Database(config.dbPath)
  try {
    ensureMarketDataSchema(db)
    const receipt = readInstrumentStatusAcquisitionReceipt(db, config.acquisitionId)
    if (!receipt) return null
    if (receipt.venue_id !== "binance-usdm" || receipt.symbol !== config.symbol
        || receipt.source_capability !== "current_snapshot_only" || receipt.endpoint !== EXCHANGE_INFO_ENDPOINT) {
      return { ok: false, error: "existing instrument status acquisition identity mismatch" }
    }
    if (receipt.terminal_status === "failed") {
      return { ok: false, error: `instrument status acquisition failed: ${receipt.attempts.at(-1)!.failure_class}`, data: { receipt, commit_status: "existing" } }
    }
    const attempt = receipt.attempts.at(-1)!
    const payload = readInstrumentStatusAcquisitionPayload(db, attempt.response_payload_ref!)
    if (!payload) return { ok: false, error: "existing instrument status acquisition payload is missing" }
    return {
      ok: true,
      data: {
        receipt,
        commit_status: "existing",
        observed_status: parseCurrentSymbolStatus(new TextDecoder().decode(payload.payload), config.symbol),
      },
    }
  } finally {
    db.close()
  }
}

async function acquireOnce(input: {
  config: Config
  fetchFn: FetchFn
  now: () => string
  startedAt: string
  payloadRef: string
  ordinal: number
}): Promise<{ attempt: InstrumentStatusAcquisitionAttempt; payload: string | null; observedStatus: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs)
  try {
    const response = await input.fetchFn(EXCHANGE_INFO_ENDPOINT, { method: "GET", signal: controller.signal })
    const payload = await response.text()
    const completedAt = input.now()
    const responseEvidence = {
      response_payload_ref: input.payloadRef,
      response_hash: instrumentStatusPayloadHash(payload),
      response_bytes: new TextEncoder().encode(payload).byteLength,
    }
    if (!response.ok) {
      const rateLimited = response.status === 429
      return {
        attempt: createInstrumentStatusAcquisitionAttempt({
          attempt_ordinal: input.ordinal,
          started_at: input.startedAt,
          completed_at: completedAt,
          outcome: "failed",
          failure_class: rateLimited ? "rate_limited" : "external_io",
          retryable: rateLimited || response.status >= 500,
          http_status: response.status,
          ...responseEvidence,
          response_record_count: null,
        }),
        payload,
        observedStatus: "",
      }
    }
    let observedStatus: string
    try {
      observedStatus = parseCurrentSymbolStatus(payload, input.config.symbol)
    } catch {
      return {
        attempt: createInstrumentStatusAcquisitionAttempt({
          attempt_ordinal: input.ordinal,
          started_at: input.startedAt,
          completed_at: completedAt,
          outcome: "failed",
          failure_class: "invalid_response",
          retryable: false,
          http_status: response.status,
          ...responseEvidence,
          response_record_count: null,
        }),
        payload,
        observedStatus: "",
      }
    }
    return {
      attempt: createInstrumentStatusAcquisitionAttempt({
        attempt_ordinal: input.ordinal,
        started_at: input.startedAt,
        completed_at: completedAt,
        outcome: "succeeded",
        failure_class: null,
        retryable: false,
        http_status: response.status,
        ...responseEvidence,
        response_record_count: 1,
      }),
      payload,
      observedStatus,
    }
  } catch (error) {
    const completedAt = input.now()
    const timedOut = error instanceof Error && error.name === "AbortError"
    return {
      attempt: createInstrumentStatusAcquisitionAttempt({
        attempt_ordinal: input.ordinal,
        started_at: input.startedAt,
        completed_at: completedAt,
        outcome: "failed",
        failure_class: timedOut ? "timeout" : "external_io",
        retryable: true,
        http_status: null,
        response_payload_ref: null,
        response_hash: null,
        response_bytes: null,
        response_record_count: null,
      }),
      payload: null,
      observedStatus: "",
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function parseCurrentSymbolStatus(payload: string, symbol: string): string {
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    throw new Error("invalid Binance exchangeInfo JSON")
  }
  const rows = value && typeof value === "object" && Array.isArray((value as { symbols?: unknown }).symbols)
    ? (value as { symbols: unknown[] }).symbols : []
  const row = rows.find((candidate) => candidate && typeof candidate === "object"
    && (candidate as { symbol?: unknown }).symbol === symbol) as { status?: unknown } | undefined
  if (!row || typeof row.status !== "string" || row.status.trim() === "") {
    throw new Error("invalid Binance exchangeInfo symbol status")
  }
  return row.status
}

function positiveInteger(value: string | undefined, flag: string, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`${flag} must be between 1 and ${maximum}`)
  return parsed
}

if (import.meta.main) {
  const response = await run(Bun.argv.slice(2))
  const stream = response.ok ? process.stdout : process.stderr
  stream.write(`${JSON.stringify(response, null, 2)}\n`)
  if (!response.ok) process.exit(1)
}
