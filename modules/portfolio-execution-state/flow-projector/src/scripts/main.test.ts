import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { appendPlanEvent, ensureSchema } from "../../../event-store/src/lib/event-store"
import { run } from "./main"

test("flow projector CLI returns structured errors", () => {
  const result = run(["--apply-reconcile", "--json", "{}"])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /requires --yes/)
})

test("flow projector CLI exposes latest slow observe as owner read surface", () => {
  const dbPath = join(repoRoot(), "tmp", "test", `flow-projector-cli-${crypto.randomUUID()}.db`)
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  let closed = false
  try {
    ensureSchema(db)
    appendPlanEvent(db, {
      event_key: "slow-observe-cli-1",
      chain_id: "flow-cli-1",
      kind: "observe",
      created_at: "2026-07-11T00:00:00Z",
      body_json: {
        source: "slow_track",
        symbol: "BTCUSDT",
      },
    })
    appendPlanEvent(db, {
      event_key: "fast-observe-cli-1",
      chain_id: "flow-cli-1",
      kind: "observe",
      created_at: "2026-07-11T00:01:00Z",
      body_json: {
        source: "fast_track",
        symbol: "BTCUSDT",
      },
    })
    db.close()
    closed = true

    const result = run(["--latest-slow-observe", "--db", dbPath, "--chain-id", "flow-cli-1"]) as {
      ok: boolean
      data: { event_key: string; chain_id: string; kind: string; read_model_ref: { store: string; ref: string } }
    }
    assert.equal(result.ok, true)
    assert.equal(result.data.event_key, "slow-observe-cli-1")
    assert.equal(result.data.chain_id, "flow-cli-1")
    assert.equal(result.data.kind, "observe")
    assert.equal(result.data.read_model_ref.store, "flow_read_models")
    assert.equal(result.data.read_model_ref.ref, "flow_read_models:latest-slow-observe/flow-cli-1")
  } finally {
    if (!closed) db.close()
    rmSync(dbPath, { force: true })
  }
})

test("flow projector CLI returns read model refs for derived projections", () => {
  const dbPath = join(repoRoot(), "tmp", "test", `flow-projector-ref-${crypto.randomUUID()}.db`)
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  let closed = false
  try {
    ensureSchema(db)
    appendPlanEvent(db, {
      event_key: "observe-ref-1",
      chain_id: "flow-ref-1",
      kind: "observe",
      created_at: "2026-07-11T00:00:00Z",
      body_json: { source: "slow_track", symbol: "BTCUSDT" },
    })
    db.close()
    closed = true

    const result = run(["--reduce-flow", "--db", dbPath, "--chain-id", "flow-ref-1"]) as {
      ok: boolean
      data: { chain_id: string; read_model_ref: { store: string; owner_module: string; ref: string } }
    }
    assert.equal(result.ok, true)
    assert.equal(result.data.chain_id, "flow-ref-1")
    assert.equal(result.data.read_model_ref.store, "flow_read_models")
    assert.equal(result.data.read_model_ref.owner_module, "flow-projector")
    assert.equal(result.data.read_model_ref.ref, "flow_read_models:flow/flow-ref-1")
  } finally {
    if (!closed) db.close()
    rmSync(dbPath, { force: true })
  }
})
