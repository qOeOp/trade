import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  ensureAgentWorkspaceScopeStoreSchema,
  readAgentWorkspaceExecutionScope,
  registerAgentWorkspaceExecutionScope,
} from "./agent-workspace-scope-store"

test("Agent workspace scope registry is create-or-identical and immutable", () => {
  const db = new Database(":memory:")
  ensureAgentWorkspaceScopeStoreSchema(db)
  const body = {
    schema_version: "trade.fixture-workspace-scope.v1",
    run_id: "workspace-scope-run",
    request_hash: "a".repeat(64),
    source_revision: "HEAD",
    domain_authority: "none",
  }
  const scope = { ...body, scope_hash: canonicalHash(body) }
  const first = registerAgentWorkspaceExecutionScope(db, {
    scope,
    registered_at: "2026-07-23T01:00:00.000Z",
  })
  const replay = registerAgentWorkspaceExecutionScope(db, {
    scope,
    registered_at: "2026-07-23T01:00:00.000Z",
  })
  assert.deepEqual(replay, first)
  assert.deepEqual(readAgentWorkspaceExecutionScope(db, body.run_id), first)
  assert.throws(() => registerAgentWorkspaceExecutionScope(db, {
    scope: {
      ...scope,
      source_revision: "different",
    },
    registered_at: "2026-07-23T01:00:00.000Z",
  }), /hash drifted/)
  assert.throws(() => db.query(`
    UPDATE agent_workspace_execution_scope
    SET registered_at='2026-07-23T02:00:00.000Z'
    WHERE run_id=$run_id
  `).run({ $run_id: body.run_id }), /immutable/)
  assert.throws(() => db.query(`
    DELETE FROM agent_workspace_execution_scope WHERE run_id=$run_id
  `).run({ $run_id: body.run_id }), /immutable/)
  db.close()
})

test("Agent workspace scope registry rejects identity collisions", () => {
  const db = new Database(":memory:")
  ensureAgentWorkspaceScopeStoreSchema(db)
  const firstBody = {
    run_id: "workspace-scope-first",
    request_hash: "b".repeat(64),
  }
  registerAgentWorkspaceExecutionScope(db, {
    scope: { ...firstBody, scope_hash: canonicalHash(firstBody) },
    registered_at: "2026-07-23T01:00:00.000Z",
  })
  const secondBody = {
    run_id: "workspace-scope-second",
    request_hash: firstBody.request_hash,
  }
  assert.throws(() => registerAgentWorkspaceExecutionScope(db, {
    scope: { ...secondBody, scope_hash: canonicalHash(secondBody) },
    registered_at: "2026-07-23T01:00:00.000Z",
  }), /identity drifted/)
  db.close()
})
