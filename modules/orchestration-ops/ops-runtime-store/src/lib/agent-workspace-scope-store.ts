import type { Database } from "bun:sqlite"
import {
  canonicalHash,
  canonicalJson,
} from "../../../../contracts/runtime-core/src/canonical-json"

export interface StoredAgentWorkspaceExecutionScope {
  run_id: string
  request_hash: string
  scope_hash: string
  scope: Record<string, unknown>
  registered_at: string
}

export function ensureAgentWorkspaceScopeStoreSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_workspace_execution_scope (
      run_id        TEXT PRIMARY KEY,
      request_hash  TEXT NOT NULL UNIQUE,
      scope_hash    TEXT NOT NULL UNIQUE,
      scope_json    TEXT NOT NULL CHECK(json_valid(scope_json)),
      registered_at TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_agent_workspace_scope_update
    BEFORE UPDATE ON agent_workspace_execution_scope
    BEGIN SELECT RAISE(ABORT, 'Agent workspace execution scope is immutable'); END
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_agent_workspace_scope_delete
    BEFORE DELETE ON agent_workspace_execution_scope
    BEGIN SELECT RAISE(ABORT, 'Agent workspace execution scope is immutable'); END
  `)
}

export function registerAgentWorkspaceExecutionScope(
  db: Database,
  input: {
    scope: object
    registered_at: string
  },
): StoredAgentWorkspaceExecutionScope {
  const scope = validateScope(input.scope)
  const registeredAt = canonicalTime(input.registered_at)
  const record: StoredAgentWorkspaceExecutionScope = {
    run_id: scope.run_id,
    request_hash: scope.request_hash,
    scope_hash: scope.scope_hash,
    scope: scope.value,
    registered_at: registeredAt,
  }
  const transaction = db.transaction(() => {
    const existing = readAgentWorkspaceExecutionScope(db, scope.run_id)
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(record)) {
        throw new Error("Agent workspace execution scope identity drifted")
      }
      return existing
    }
    db.query(`
      INSERT INTO agent_workspace_execution_scope(
        run_id, request_hash, scope_hash, scope_json, registered_at
      ) VALUES (
        $run_id, $request_hash, $scope_hash, $scope_json, $registered_at
      )
    `).run({
      $run_id: record.run_id,
      $request_hash: record.request_hash,
      $scope_hash: record.scope_hash,
      $scope_json: canonicalJson(record.scope),
      $registered_at: record.registered_at,
    })
    return record
  })
  try {
    return transaction.immediate()
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      throw new Error("Agent workspace execution scope identity drifted", { cause: error })
    }
    throw error
  }
}

export function readAgentWorkspaceExecutionScope(
  db: Database,
  runId: string,
): StoredAgentWorkspaceExecutionScope | null {
  const id = identifier(runId, "run_id")
  const row = db.query(`
    SELECT run_id, request_hash, scope_hash, scope_json, registered_at
    FROM agent_workspace_execution_scope
    WHERE run_id=$run_id
  `).get({ $run_id: id }) as {
    run_id: string
    request_hash: string
    scope_hash: string
    scope_json: string
    registered_at: string
  } | null
  if (!row) return null
  const validated = validateScope(JSON.parse(row.scope_json))
  if (validated.run_id !== row.run_id
    || validated.request_hash !== row.request_hash
    || validated.scope_hash !== row.scope_hash) {
    throw new Error("Stored Agent workspace execution scope drifted")
  }
  return {
    run_id: validated.run_id,
    request_hash: validated.request_hash,
    scope_hash: validated.scope_hash,
    scope: validated.value,
    registered_at: canonicalTime(row.registered_at),
  }
}

function validateScope(value: object): {
  run_id: string
  request_hash: string
  scope_hash: string
  value: Record<string, unknown>
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent workspace execution scope must be an object")
  }
  const record = value as Record<string, unknown>
  const runId = identifier(record.run_id, "scope.run_id")
  const requestHash = digest(record.request_hash, "scope.request_hash")
  const scopeHash = digest(record.scope_hash, "scope.scope_hash")
  const { scope_hash: _scopeHash, ...body } = record
  if (canonicalHash(body) !== scopeHash) {
    throw new Error("Agent workspace execution scope hash drifted")
  }
  const text = canonicalJson(value)
  if (Buffer.byteLength(text) > 128 * 1024) {
    throw new Error("Agent workspace execution scope exceeds byte limit")
  }
  return {
    run_id: runId,
    request_hash: requestHash,
    scope_hash: scopeHash,
    value: JSON.parse(text) as Record<string, unknown>,
  }
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function digest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function canonicalTime(value: string): string {
  if (!Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new Error("registered_at is invalid")
  }
  return value
}
