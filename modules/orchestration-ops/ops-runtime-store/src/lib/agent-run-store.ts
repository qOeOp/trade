import { Database } from "bun:sqlite"
import {
  buildAgentRunEvent,
  compileAgentRunEvent,
  compileAgentRunRequest,
  compileAgentRunResult,
  validateAgentRunCompletion,
  type AgentRunEvent,
  type AgentArtifactRef,
  type AgentRunRequest,
  type AgentRunResult,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import type {
  AgentRunAcceptance,
  AgentRunLifecycleStatus,
  AgentRunStatus,
} from "../../../../contracts/agent-run-contract/src/agent-host-port"
import { ensureAgentPatchAdoptionStoreSchema } from "./agent-patch-adoption-store"
import { ensureAgentWorkspaceScopeStoreSchema } from "./agent-workspace-scope-store"

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

export interface AgentRunToolUsage {
  run_id: string
  request_hash: string
  tool_calls: number
}

export interface AgentRunToolResult {
  call_id: string
  run_id: string
  request_hash: string
  task_profile: AgentRunRequest["task_profile"]
  tool_name: string
  output_schema_version: string
  artifact: AgentArtifactRef
  occurred_at: string
}

export function ensureAgentRunStoreSchema(db: Database): void {
  ensureAgentWorkspaceScopeStoreSchema(db)
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
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_run_tool_call (
      call_id       TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL,
      request_hash  TEXT NOT NULL,
      task_profile  TEXT NOT NULL,
      tool_name     TEXT NOT NULL,
      occurred_at   TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES agent_run(run_id)
    )
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_agent_run_tool_call_update
    BEFORE UPDATE ON agent_run_tool_call
    BEGIN SELECT RAISE(ABORT, 'Agent Run tool-call evidence is immutable'); END
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_agent_run_tool_call_delete
    BEFORE DELETE ON agent_run_tool_call
    BEGIN SELECT RAISE(ABORT, 'Agent Run tool-call evidence is immutable'); END
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_run_tool_call_run
    ON agent_run_tool_call(run_id, occurred_at, call_id)
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_run_tool_result (
      call_id               TEXT PRIMARY KEY,
      run_id                TEXT NOT NULL,
      request_hash          TEXT NOT NULL,
      task_profile          TEXT NOT NULL,
      tool_name             TEXT NOT NULL,
      output_schema_version TEXT NOT NULL,
      artifact_json         TEXT NOT NULL CHECK(json_valid(artifact_json)),
      occurred_at           TEXT NOT NULL,
      FOREIGN KEY(call_id) REFERENCES agent_run_tool_call(call_id),
      FOREIGN KEY(run_id) REFERENCES agent_run(run_id)
    )
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_agent_run_tool_result_update
    BEFORE UPDATE ON agent_run_tool_result
    BEGIN SELECT RAISE(ABORT, 'Agent Run tool-result evidence is immutable'); END
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_agent_run_tool_result_delete
    BEFORE DELETE ON agent_run_tool_result
    BEGIN SELECT RAISE(ABORT, 'Agent Run tool-result evidence is immutable'); END
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_run_tool_result_run
    ON agent_run_tool_result(run_id, occurred_at, call_id)
  `)
  ensureAgentPatchAdoptionStoreSchema(db)
}

export function recordAgentRunToolCall(db: Database, input: {
  call_id: string
  run_id: string
  request_hash: string
  task_profile: AgentRunRequest["task_profile"]
  tool_name: string
  occurred_at: string
}): AgentRunToolUsage {
  validateOpaque(input.call_id, "call_id")
  validateOpaque(input.run_id, "run_id")
  if (!/^[a-f0-9]{64}$/.test(input.request_hash)) {
    throw new Error("request_hash is invalid")
  }
  if (!["planner", "developer", "reviewer", "explanation"].includes(input.task_profile)) {
    throw new Error("task_profile is invalid")
  }
  if (!/^[a-z][a-z0-9_]{0,127}$/.test(input.tool_name)) {
    throw new Error("tool_name is invalid")
  }
  canonicalTime(input.occurred_at, "occurred_at")
  const run = requireAgentRun(db, input.run_id)
  if (run.request.request_hash !== input.request_hash
    || run.request.task_profile !== input.task_profile) {
    throw new Error("Agent Run tool-call identity drifted")
  }
  if (run.result || !["accepted", "running"].includes(run.status)) {
    throw new Error("Agent Run tool call is outside an active run")
  }
  db.query(`
    INSERT INTO agent_run_tool_call(
      call_id, run_id, request_hash, task_profile, tool_name, occurred_at
    ) VALUES (
      $call_id, $run_id, $request_hash, $task_profile, $tool_name, $occurred_at
    )
  `).run({
    $call_id: input.call_id,
    $run_id: input.run_id,
    $request_hash: input.request_hash,
    $task_profile: input.task_profile,
    $tool_name: input.tool_name,
    $occurred_at: input.occurred_at,
  })
  return readAgentRunToolUsage(db, input.run_id, input.request_hash)
}

export function readAgentRunToolUsage(
  db: Database,
  runId: string,
  requestHash: string,
): AgentRunToolUsage {
  validateOpaque(runId, "run_id")
  if (!/^[a-f0-9]{64}$/.test(requestHash)) throw new Error("request_hash is invalid")
  const run = requireAgentRun(db, runId)
  if (run.request.request_hash !== requestHash) {
    throw new Error("Agent Run tool usage identity drifted")
  }
  const row = db.query(`
    SELECT COUNT(*) AS tool_calls
    FROM agent_run_tool_call
    WHERE run_id=$run_id AND request_hash=$request_hash
  `).get({
    $run_id: runId,
    $request_hash: requestHash,
  }) as { tool_calls: number }
  return { run_id: runId, request_hash: requestHash, tool_calls: row.tool_calls }
}

export function recordAgentRunToolResult(db: Database, input: AgentRunToolResult): AgentRunToolResult {
  validateOpaque(input.call_id, "call_id")
  validateOpaque(input.run_id, "run_id")
  if (!/^[a-f0-9]{64}$/.test(input.request_hash)) {
    throw new Error("request_hash is invalid")
  }
  if (!["planner", "developer", "reviewer", "explanation"].includes(input.task_profile)) {
    throw new Error("task_profile is invalid")
  }
  if (!/^[a-z][a-z0-9_]{0,127}$/.test(input.tool_name)) {
    throw new Error("tool_name is invalid")
  }
  if (!/^trade\.[a-z0-9][a-z0-9._-]{0,126}\.v[1-9][0-9]*$/.test(input.output_schema_version)) {
    throw new Error("output_schema_version is invalid")
  }
  canonicalTime(input.occurred_at, "occurred_at")
  const artifact = validateToolResultArtifact(input.artifact)
  const run = requireAgentRun(db, input.run_id)
  if (run.request.request_hash !== input.request_hash
    || run.request.task_profile !== input.task_profile
    || run.request.output_schema_version !== input.output_schema_version) {
    throw new Error("Agent Run tool-result identity drifted")
  }
  if (run.result || !["accepted", "running"].includes(run.status)) {
    throw new Error("Agent Run tool result is outside an active run")
  }
  const call = db.query(`
    SELECT run_id, request_hash, task_profile, tool_name
    FROM agent_run_tool_call WHERE call_id=$call_id
  `).get({ $call_id: input.call_id }) as {
    run_id: string
    request_hash: string
    task_profile: string
    tool_name: string
  } | null
  if (!call
    || call.run_id !== input.run_id
    || call.request_hash !== input.request_hash
    || call.task_profile !== input.task_profile
    || call.tool_name !== input.tool_name) {
    throw new Error("Agent Run tool-result call identity drifted")
  }
  db.query(`
    INSERT INTO agent_run_tool_result(
      call_id, run_id, request_hash, task_profile, tool_name,
      output_schema_version, artifact_json, occurred_at
    ) VALUES (
      $call_id, $run_id, $request_hash, $task_profile, $tool_name,
      $output_schema_version, $artifact_json, $occurred_at
    )
  `).run({
    $call_id: input.call_id,
    $run_id: input.run_id,
    $request_hash: input.request_hash,
    $task_profile: input.task_profile,
    $tool_name: input.tool_name,
    $output_schema_version: input.output_schema_version,
    $artifact_json: JSON.stringify(artifact),
    $occurred_at: input.occurred_at,
  })
  return { ...input, artifact }
}

export function readAgentRunTerminalToolResult(db: Database, input: {
  run_id: string
  request_hash: string
  task_profile: AgentRunRequest["task_profile"]
  tool_name: string
  output_schema_version: string
}): AgentRunToolResult | null {
  validateOpaque(input.run_id, "run_id")
  const run = requireAgentRun(db, input.run_id)
  if (run.request.request_hash !== input.request_hash
    || run.request.task_profile !== input.task_profile
    || run.request.output_schema_version !== input.output_schema_version) {
    throw new Error("Agent Run terminal tool-result identity drifted")
  }
  const rows = db.query(`
    SELECT * FROM agent_run_tool_result
    WHERE run_id=$run_id
      AND request_hash=$request_hash
      AND task_profile=$task_profile
      AND tool_name=$tool_name
      AND output_schema_version=$output_schema_version
    ORDER BY occurred_at ASC, call_id ASC
    LIMIT 2
  `).all({
    $run_id: input.run_id,
    $request_hash: input.request_hash,
    $task_profile: input.task_profile,
    $tool_name: input.tool_name,
    $output_schema_version: input.output_schema_version,
  }) as Array<Record<string, unknown>>
  if (rows.length > 1) {
    throw new Error("Agent Run has ambiguous terminal tool results")
  }
  return rows.length === 0 ? null : decodeToolResult(rows[0]!)
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
      throw new Error("Agent Run identity or idempotency key drifted", { cause: error })
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

function validateToolResultArtifact(value: AgentArtifactRef): AgentArtifactRef {
  if (!value || typeof value !== "object"
    || !/^agent-artifact:\/\/durable\/[a-f0-9]{64}$/.test(value.ref)
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !value.ref.endsWith(value.sha256)
    || value.media_type !== "application/json"
    || !Number.isSafeInteger(value.bytes)
    || value.bytes < 2
    || value.bytes > 16 * 1024 * 1024) {
    throw new Error("Agent Run tool-result artifact is invalid")
  }
  return structuredClone(value)
}

function decodeToolResult(row: Record<string, unknown>): AgentRunToolResult {
  return {
    call_id: String(row.call_id),
    run_id: String(row.run_id),
    request_hash: String(row.request_hash),
    task_profile: String(row.task_profile) as AgentRunRequest["task_profile"],
    tool_name: String(row.tool_name),
    output_schema_version: String(row.output_schema_version),
    artifact: validateToolResultArtifact(JSON.parse(String(row.artifact_json))),
    occurred_at: String(row.occurred_at),
  }
}

function canonicalTime(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${field} is invalid`)
}
