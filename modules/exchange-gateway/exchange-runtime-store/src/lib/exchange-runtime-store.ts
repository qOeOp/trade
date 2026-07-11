import { Database } from "bun:sqlite"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

export const EXCHANGE_COMMAND_STATUSES = ["planned", "submitted", "confirmed", "failed", "cancelled"] as const
export type ExchangeCommandStatus = typeof EXCHANGE_COMMAND_STATUSES[number]

export interface ExchangeCommand {
  command_id: string
  idempotency_key: string
  market: string
  symbol?: string
  command_type: string
  client_order_id?: string
  requested_by_ref: string
  request_json: JSONRecord
  status: ExchangeCommandStatus
  created_at: string
}

export interface ExchangeResult {
  result_id: string
  command_id: string
  exchange_ref?: string
  result_json: JSONRecord
  confirmed_json?: JSONRecord
  received_at: string
}

export interface ExchangeSnapshotRef {
  snapshot_id: string
  snapshot_kind: string
  symbol?: string
  account_scope?: string
  body_ref: string
  content_hash?: string
  captured_at: string
}

export function ensureExchangeRuntimeSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS exchange_command (
      command_id       TEXT PRIMARY KEY,
      idempotency_key  TEXT NOT NULL UNIQUE,
      market           TEXT NOT NULL,
      symbol           TEXT,
      command_type     TEXT NOT NULL,
      client_order_id  TEXT,
      requested_by_ref TEXT NOT NULL,
      request_json     TEXT NOT NULL CHECK(json_valid(request_json)),
      status           TEXT NOT NULL CHECK(status IN ('planned', 'submitted', 'confirmed', 'failed', 'cancelled')),
      created_at       TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS exchange_result (
      result_id       TEXT PRIMARY KEY,
      command_id      TEXT NOT NULL,
      exchange_ref    TEXT,
      result_json     TEXT NOT NULL CHECK(json_valid(result_json)),
      confirmed_json  TEXT CHECK(confirmed_json IS NULL OR json_valid(confirmed_json)),
      received_at     TEXT NOT NULL,
      FOREIGN KEY (command_id) REFERENCES exchange_command(command_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS exchange_snapshot_ref (
      snapshot_id    TEXT PRIMARY KEY,
      snapshot_kind  TEXT NOT NULL,
      symbol         TEXT,
      account_scope  TEXT,
      body_ref       TEXT NOT NULL,
      content_hash   TEXT,
      captured_at    TEXT NOT NULL
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_exchange_command_client_order ON exchange_command(client_order_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_exchange_result_command ON exchange_result(command_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_exchange_snapshot_symbol ON exchange_snapshot_ref(symbol, captured_at DESC)")
}

export function recordExchangeCommand(db: Database, command: ExchangeCommand): void {
  validateExchangeCommand(command)
  db.query(`
    INSERT INTO exchange_command(
      command_id, idempotency_key, market, symbol, command_type, client_order_id,
      requested_by_ref, request_json, status, created_at
    )
    VALUES (
      $command_id, $idempotency_key, $market, $symbol, $command_type, $client_order_id,
      $requested_by_ref, $request_json, $status, $created_at
    )
  `).run({
    $command_id: command.command_id,
    $idempotency_key: command.idempotency_key,
    $market: command.market,
    $symbol: command.symbol ?? null,
    $command_type: command.command_type,
    $client_order_id: command.client_order_id ?? null,
    $requested_by_ref: command.requested_by_ref,
    $request_json: JSON.stringify(command.request_json),
    $status: command.status,
    $created_at: command.created_at,
  })
}

export function updateExchangeCommandStatus(db: Database, commandId: string, status: ExchangeCommandStatus): void {
  if (!commandId) {
    throw new Error("command_id is required")
  }
  if (!EXCHANGE_COMMAND_STATUSES.includes(status)) {
    throw new Error(`unsupported exchange command status: ${status}`)
  }
  db.query("UPDATE exchange_command SET status=$status WHERE command_id=$command_id").run({
    $status: status,
    $command_id: commandId,
  })
}

export function recordExchangeResult(db: Database, result: ExchangeResult): void {
  validateExchangeResult(result)
  db.query(`
    INSERT INTO exchange_result(result_id, command_id, exchange_ref, result_json, confirmed_json, received_at)
    VALUES ($result_id, $command_id, $exchange_ref, $result_json, $confirmed_json, $received_at)
  `).run({
    $result_id: result.result_id,
    $command_id: result.command_id,
    $exchange_ref: result.exchange_ref ?? null,
    $result_json: JSON.stringify(result.result_json),
    $confirmed_json: result.confirmed_json ? JSON.stringify(result.confirmed_json) : null,
    $received_at: result.received_at,
  })
}

export function recordExchangeSnapshotRef(db: Database, snapshot: ExchangeSnapshotRef): void {
  validateExchangeSnapshotRef(snapshot)
  db.query(`
    INSERT INTO exchange_snapshot_ref(snapshot_id, snapshot_kind, symbol, account_scope, body_ref, content_hash, captured_at)
    VALUES ($snapshot_id, $snapshot_kind, $symbol, $account_scope, $body_ref, $content_hash, $captured_at)
  `).run({
    $snapshot_id: snapshot.snapshot_id,
    $snapshot_kind: snapshot.snapshot_kind,
    $symbol: snapshot.symbol ?? null,
    $account_scope: snapshot.account_scope ?? null,
    $body_ref: snapshot.body_ref,
    $content_hash: snapshot.content_hash ?? null,
    $captured_at: snapshot.captured_at,
  })
}

export function readExchangeCommandByIdempotencyKey(db: Database, idempotencyKey: string): ExchangeCommand | null {
  if (!idempotencyKey) {
    throw new Error("idempotency_key is required")
  }
  const row = db.query(`
    SELECT command_id, idempotency_key, market, symbol, command_type, client_order_id,
      requested_by_ref, request_json, status, created_at
    FROM exchange_command
    WHERE idempotency_key = $idempotency_key
  `).get({ $idempotency_key: idempotencyKey }) as ExchangeCommandRow | null
  return row ? commandFromRow(row) : null
}

export function readExchangeResultsForCommand(db: Database, commandId: string): ExchangeResult[] {
  if (!commandId) {
    throw new Error("command_id is required")
  }
  const rows = db.query(`
    SELECT result_id, command_id, exchange_ref, result_json, confirmed_json, received_at
    FROM exchange_result
    WHERE command_id = $command_id
    ORDER BY received_at ASC, rowid ASC
  `).all({ $command_id: commandId }) as ExchangeResultRow[]
  return rows.map(resultFromRow)
}

export function buildExchangeCommand(input: JSONRecord): ExchangeCommand {
  const now = stringField(input.created_at) || stringField(input.now) || new Date().toISOString()
  const commandType = stringField(input.command_type)
  const symbol = stringField(input.symbol)
  return {
    command_id: stringField(input.command_id) || `exchange-command-${now.replace(/[^0-9]/g, "") || crypto.randomUUID()}`,
    idempotency_key: stringField(input.idempotency_key) || `${commandType}:${symbol}:${now}`,
    market: stringField(input.market) || "binance_usdm",
    symbol: symbol || undefined,
    command_type: commandType,
    client_order_id: stringField(input.client_order_id) || undefined,
    requested_by_ref: stringField(input.requested_by_ref),
    request_json: asRecord(input.request_json ?? input.request),
    status: parseExchangeCommandStatus(input.status) || "planned",
    created_at: now,
  }
}

export function buildExchangeResult(input: JSONRecord): ExchangeResult {
  const now = stringField(input.received_at) || stringField(input.now) || new Date().toISOString()
  return {
    result_id: stringField(input.result_id) || `exchange-result-${now.replace(/[^0-9]/g, "") || crypto.randomUUID()}`,
    command_id: stringField(input.command_id),
    exchange_ref: stringField(input.exchange_ref) || undefined,
    result_json: asRecord(input.result_json ?? input.result),
    confirmed_json: optionalRecord(input.confirmed_json ?? input.confirmed),
    received_at: now,
  }
}

export function buildExchangeSnapshotRef(input: JSONRecord): ExchangeSnapshotRef {
  const now = stringField(input.captured_at) || stringField(input.now) || new Date().toISOString()
  return {
    snapshot_id: stringField(input.snapshot_id) || `exchange-snapshot-${now.replace(/[^0-9]/g, "") || crypto.randomUUID()}`,
    snapshot_kind: stringField(input.snapshot_kind),
    symbol: stringField(input.symbol) || undefined,
    account_scope: stringField(input.account_scope) || undefined,
    body_ref: stringField(input.body_ref),
    content_hash: stringField(input.content_hash) || undefined,
    captured_at: now,
  }
}

function validateExchangeCommand(command: ExchangeCommand): void {
  if (!command.command_id || !command.idempotency_key || !command.market || !command.command_type || !command.requested_by_ref || !command.created_at) {
    throw new Error("command_id, idempotency_key, market, command_type, requested_by_ref, and created_at are required")
  }
  if (!EXCHANGE_COMMAND_STATUSES.includes(command.status)) {
    throw new Error(`unsupported exchange command status: ${command.status}`)
  }
}

function validateExchangeResult(result: ExchangeResult): void {
  if (!result.result_id || !result.command_id || !result.received_at) {
    throw new Error("result_id, command_id, and received_at are required")
  }
}

function validateExchangeSnapshotRef(snapshot: ExchangeSnapshotRef): void {
  if (!snapshot.snapshot_id || !snapshot.snapshot_kind || !snapshot.body_ref || !snapshot.captured_at) {
    throw new Error("snapshot_id, snapshot_kind, body_ref, and captured_at are required")
  }
}

function parseExchangeCommandStatus(value: unknown): ExchangeCommandStatus | "" {
  const status = stringField(value)
  return EXCHANGE_COMMAND_STATUSES.includes(status as ExchangeCommandStatus) ? status as ExchangeCommandStatus : ""
}

function optionalRecord(value: unknown): JSONRecord | undefined {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : undefined
}

interface ExchangeCommandRow {
  command_id: string
  idempotency_key: string
  market: string
  symbol: string | null
  command_type: string
  client_order_id: string | null
  requested_by_ref: string
  request_json: string
  status: ExchangeCommandStatus
  created_at: string
}

interface ExchangeResultRow {
  result_id: string
  command_id: string
  exchange_ref: string | null
  result_json: string
  confirmed_json: string | null
  received_at: string
}

function commandFromRow(row: ExchangeCommandRow): ExchangeCommand {
  return {
    command_id: row.command_id,
    idempotency_key: row.idempotency_key,
    market: row.market,
    symbol: row.symbol ?? undefined,
    command_type: row.command_type,
    client_order_id: row.client_order_id ?? undefined,
    requested_by_ref: row.requested_by_ref,
    request_json: JSON.parse(row.request_json) as JSONRecord,
    status: row.status,
    created_at: row.created_at,
  }
}

function resultFromRow(row: ExchangeResultRow): ExchangeResult {
  return {
    result_id: row.result_id,
    command_id: row.command_id,
    exchange_ref: row.exchange_ref ?? undefined,
    result_json: JSON.parse(row.result_json) as JSONRecord,
    confirmed_json: row.confirmed_json ? JSON.parse(row.confirmed_json) as JSONRecord : undefined,
    received_at: row.received_at,
  }
}
