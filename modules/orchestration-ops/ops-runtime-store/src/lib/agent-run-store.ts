import { Database } from "bun:sqlite"
import {
  buildAgentRunEvent,
  compileAgentRunEvent,
  compileAgentRunRequest,
  compileAgentRunResult,
  validateAgentRunCompletion,
  type AgentRunEvent,
  type AgentRunRequest,
  type AgentRunResult,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import type {
  AgentRunAcceptance,
  AgentRunLifecycleStatus,
  AgentRunStatus,
} from "../../../../contracts/agent-run-contract/src/agent-host-port"

export interface AgentRunOperationalRecord {
  request: AgentRunRequest
  host_profile: string
  host_thread_id?: string
  host_turn_id?: string
  status: AgentRunLifecycleStatus
  last_sequence: number
  accepted_at: string
  updated_at: string
  result: AgentRunResult | null
}

export function ensureAgentRunStoreSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_run (
      run_id          TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash    TEXT NOT NULL UNIQUE,
      request_json    TEXT NOT NULL CHECK(json_valid(request_json)),
      host_profile    TEXT NOT NULL,
      host_thread_id  TEXT,
      host_turn_id    TEXT,
      status          TEXT NOT NULL CHECK(status IN (
        'accepted', 'running', 'awaiting_approval', 'cancelling',
        'completed', 'blocked', 'cancelled', 'failed'
      )),
      last_sequence   INTEGER NOT NULL CHECK(last_sequence >= 0),
      accepted_at     TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      result_json     TEXT CHECK(result_json IS NULL OR json_valid(result_json))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_run_event (
      run_id      TEXT NOT NULL,
      sequence    INTEGER NOT NULL CHECK(sequence > 0),
      event_json  TEXT NOT NULL CHECK(json_valid(event_json)),
      PRIMARY KEY(run_id, sequence),
      FOREIGN KEY(run_id) REFERENCES agent_run(run_id)
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_agent_run_status ON agent_run(status, updated_at)")
}

export function admitAgentRun(
  db: Database,
  requestValue: unknown,
  hostProfile: string,
  acceptedAt: string,
): AgentRunAcceptance {
  const request = compileAgentRunRequest(requestValue)
  validateHostProfile(hostProfile)
  canonicalTime(acceptedAt, "accepted_at")
  const transaction = db.transaction((): AgentRunAcceptance => {
    const existing = readAgentRunByIdentity(db, request.run_id, request.idempotency_key)
    if (existing) {
      if (existing.request.request_hash !== request.request_hash) {
        throw new Error("Agent Run identity or idempotency key drifted")
      }
      return { run_id: request.run_id, request_hash: request.request_hash, accepted: true, replayed: true }
    }
    db.query(`
      INSERT INTO agent_run(
        run_id, idempotency_key, request_hash, request_json, host_profile,
        status, last_sequence, accepted_at, updated_at
      ) VALUES (
        $run_id, $idempotency_key, $request_hash, $request_json, $host_profile,
        'accepted', 1, $accepted_at, $accepted_at
      )
    `).run({
      $run_id: request.run_id,
      $idempotency_key: request.idempotency_key,
      $request_hash: request.request_hash,
      $request_json: JSON.stringify(request),
      $host_profile: hostProfile,
      $accepted_at: acceptedAt,
    })
    const event = buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: 1,
      occurred_at: acceptedAt,
      kind: "accepted",
      summary: `Agent Run accepted by ${hostProfile}.`,
    })
    insertEvent(db, event)
    return { run_id: request.run_id, request_hash: request.request_hash, accepted: true, replayed: false }
  })
  try {
    return transaction.immediate()
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      throw new Error("Agent Run identity or idempotency key drifted")
    }
    throw error
  }
}

export function bindAgentRunHostSession(db: Database, input: {
  run_id: string
  request_hash: string
  host_thread_id: string
  host_turn_id?: string
  observed_at: string
}): void {
  validateOpaque(input.host_thread_id, "host_thread_id")
  if (input.host_turn_id != null) validateOpaque(input.host_turn_id, "host_turn_id")
  canonicalTime(input.observed_at, "observed_at")
  const current = requireAgentRun(db, input.run_id)
  if (current.request.request_hash !== input.request_hash) throw new Error("Agent Run host session identity drifted")
  if (current.host_thread_id && current.host_thread_id !== input.host_thread_id) {
    throw new Error("Agent Run host thread identity drifted")
  }
  if (current.host_turn_id && input.host_turn_id && current.host_turn_id !== input.host_turn_id) {
    throw new Error("Agent Run host turn identity drifted")
  }
  db.query(`
    UPDATE agent_run
    SET host_thread_id = $host_thread_id,
        host_turn_id = COALESCE(host_turn_id, $host_turn_id),
        updated_at = $updated_at
    WHERE run_id = $run_id AND request_hash = $request_hash
  `).run({
    $run_id: input.run_id,
    $request_hash: input.request_hash,
    $host_thread_id: input.host_thread_id,
    $host_turn_id: input.host_turn_id ?? null,
    $updated_at: input.observed_at,
  })
}

export function appendAgentRunEvent(db: Database, eventValue: unknown): AgentRunEvent {
  const event = compileAgentRunEvent(eventValue)
  const transaction = db.transaction(() => {
    const current = requireAgentRun(db, event.run_id)
    if (current.request.request_hash !== event.request_hash || current.request.trace_id !== event.trace_id) {
      throw new Error("Agent Run event identity drifted")
    }
    if (current.result) throw new Error("Agent Run event cannot follow terminal result")
    if (event.sequence !== current.last_sequence + 1) throw new Error("Agent Run event sequence is not contiguous")
    insertEvent(db, event)
    db.query(`
      UPDATE agent_run
      SET status = $status, last_sequence = $sequence, updated_at = $updated_at
      WHERE run_id = $run_id
    `).run({
      $run_id: event.run_id,
      $status: statusForEvent(current.status, event),
      $sequence: event.sequence,
      $updated_at: event.occurred_at,
    })
    return event
  })
  return transaction.immediate()
}

export function completeAgentRun(db: Database, resultValue: unknown): AgentRunResult {
  const result = compileAgentRunResult(resultValue)
  const transaction = db.transaction(() => {
    const current = requireAgentRun(db, result.run_id)
    if (current.result) {
      if (current.result.result_hash !== result.result_hash) throw new Error("Agent Run result identity drifted")
      return current.result
    }
    const events = readAllAgentRunEvents(db, result.run_id)
    validateAgentRunCompletion(current.request, events, result)
    db.query(`
      UPDATE agent_run
      SET status = $status, updated_at = $updated_at, result_json = $result_json
      WHERE run_id = $run_id AND request_hash = $request_hash
    `).run({
      $run_id: result.run_id,
      $request_hash: result.request_hash,
      $status: result.status,
      $updated_at: result.finished_at,
      $result_json: JSON.stringify(result),
    })
    return result
  })
  return transaction.immediate()
}

export function markAgentRunCancelling(
  db: Database,
  runId: string,
  requestHash: string,
  observedAt: string,
): void {
  canonicalTime(observedAt, "observed_at")
  const current = requireAgentRun(db, runId)
  if (current.request.request_hash !== requestHash) throw new Error("Agent Run cancel identity drifted")
  if (current.result) return
  db.query(`
    UPDATE agent_run SET status = 'cancelling', updated_at = $updated_at
    WHERE run_id = $run_id AND request_hash = $request_hash
  `).run({ $run_id: runId, $request_hash: requestHash, $updated_at: observedAt })
}

export function readAgentRun(db: Database, runId: string): AgentRunOperationalRecord | null {
  const row = db.query("SELECT * FROM agent_run WHERE run_id = $run_id").get({ $run_id: runId })
  return row ? decodeRow(row as Record<string, unknown>) : null
}

export function readAgentRunEvents(db: Database, runId: string, afterSequence: number, limit: number): AgentRunEvent[] {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error("after_sequence is invalid")
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error("event limit is invalid")
  const rows = db.query(`
    SELECT event_json FROM agent_run_event
    WHERE run_id = $run_id AND sequence > $after_sequence
    ORDER BY sequence ASC LIMIT $limit
  `).all({ $run_id: runId, $after_sequence: afterSequence, $limit: limit }) as Array<{ event_json: string }>
  return rows.map((row) => compileAgentRunEvent(JSON.parse(row.event_json)))
}

function readAllAgentRunEvents(db: Database, runId: string): AgentRunEvent[] {
  const events: AgentRunEvent[] = []
  while (true) {
    const page = readAgentRunEvents(db, runId, events.at(-1)?.sequence ?? 0, 1_000)
    events.push(...page)
    if (page.length < 1_000) return events
    if (events.length > 3_000) throw new Error("Agent Run event stream exceeds contract envelope")
  }
}

export function projectAgentRunStatus(record: AgentRunOperationalRecord): AgentRunStatus {
  return {
    run_id: record.request.run_id,
    request_hash: record.request.request_hash,
    status: record.status,
    last_sequence: record.last_sequence,
    terminal: record.result !== null,
  }
}

export function listRecoverableAgentRuns(db: Database, limit = 100): AgentRunOperationalRecord[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error("recovery limit is invalid")
  const rows = db.query(`
    SELECT * FROM agent_run
    WHERE result_json IS NULL AND status IN ('accepted', 'running', 'awaiting_approval', 'cancelling')
    ORDER BY accepted_at ASC LIMIT $limit
  `).all({ $limit: limit }) as Array<Record<string, unknown>>
  return rows.map(decodeRow)
}

function readAgentRunByIdentity(db: Database, runId: string, idempotencyKey: string): AgentRunOperationalRecord | null {
  const row = db.query(`
    SELECT * FROM agent_run WHERE run_id = $run_id OR idempotency_key = $idempotency_key
  `).get({ $run_id: runId, $idempotency_key: idempotencyKey })
  return row ? decodeRow(row as Record<string, unknown>) : null
}

function requireAgentRun(db: Database, runId: string): AgentRunOperationalRecord {
  const run = readAgentRun(db, runId)
  if (!run) throw new Error(`Agent Run not found: ${runId}`)
  return run
}

function insertEvent(db: Database, event: AgentRunEvent): void {
  db.query(`
    INSERT INTO agent_run_event(run_id, sequence, event_json)
    VALUES ($run_id, $sequence, $event_json)
  `).run({ $run_id: event.run_id, $sequence: event.sequence, $event_json: JSON.stringify(event) })
}

function statusForEvent(current: AgentRunLifecycleStatus, event: AgentRunEvent): AgentRunLifecycleStatus {
  if (event.kind === "terminal") return event.status!
  if (event.kind === "awaiting_approval") return "awaiting_approval"
  if (current === "cancelling") return current
  return event.kind === "started" ? "running" : current
}

function decodeRow(row: Record<string, unknown>): AgentRunOperationalRecord {
  const result = row.result_json == null ? null : compileAgentRunResult(JSON.parse(String(row.result_json)))
  return {
    request: compileAgentRunRequest(JSON.parse(String(row.request_json))),
    host_profile: String(row.host_profile),
    ...(row.host_thread_id == null ? {} : { host_thread_id: String(row.host_thread_id) }),
    ...(row.host_turn_id == null ? {} : { host_turn_id: String(row.host_turn_id) }),
    status: String(row.status) as AgentRunLifecycleStatus,
    last_sequence: Number(row.last_sequence),
    accepted_at: String(row.accepted_at),
    updated_at: String(row.updated_at),
    result,
  }
}

function validateHostProfile(value: string): void {
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(value)) throw new Error("host_profile is invalid")
}

function validateOpaque(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error(`${field} is invalid`)
}

function canonicalTime(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${field} is invalid`)
}
