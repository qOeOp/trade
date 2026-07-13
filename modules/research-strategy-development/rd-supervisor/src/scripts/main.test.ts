import assert from "node:assert/strict"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { run } from "./main"

type JSONRecord = Record<string, unknown>

test("rd supervisor CLI exposes native J04 init job result", () => {
  const dir = "tmp/check/rd-supervisor-job-init"
  const absoluteDir = join(repoRoot(), dir)
  rmSync(absoluteDir, { recursive: true, force: true })
  mkdirSync(absoluteDir, { recursive: true })
  try {
    const dbPath = `${dir}/rd_state.db`
    const programId = "rd-supervisor-init"
    const stateRef = `research_state_store:rd_program/${programId}`
    const catalogDbPath = `${dir}/catalog.db`
    const result = run([
      "--supervisor-job",
      "--db",
      dbPath,
      "--program-id",
      programId,
      "--catalog-db",
      catalogDbPath,
      "--json",
      JSON.stringify({
        cycle_id: "cycle-j04-init",
        now: "2026-07-09T12:15:00.000Z",
        goal: {
          objective: "find a shadow-eligible 4H swing strategy",
          budget: { max_hypotheses: 2, max_trials_total: 8, max_locked_holdout_uses: 1 },
        },
      }),
    ])

    assert.equal(result.ok, true)
    const data = asRecord(result.data)
    assert.equal(data.mode, "init")
    const runtimeResult = asRecord(data.runtime_result)
    assert.equal(runtimeResult.schema_id, "trade.domain-runtime.domain-job-result.v1")
    assert.equal(runtimeResult.domain, "research-strategy-development")
    assert.equal(runtimeResult.job_id, "rd_strategy_supervisor")
    assert.equal(runtimeResult.status, "ok")
    assert.deepEqual(runtimeResult.writes, { research_state_store: true, artifact_catalog: true })
    assert.deepEqual(runtimeResult.output_refs, [stateRef])
  } finally {
    rmSync(absoluteDir, { recursive: true, force: true })
  }
})

test("rd supervisor CLI exposes native J04 blocked job result from owner loop", () => {
  const dir = "tmp/check/rd-supervisor-job-blocked"
  const absoluteDir = join(repoRoot(), dir)
  rmSync(absoluteDir, { recursive: true, force: true })
  mkdirSync(absoluteDir, { recursive: true })
  try {
    const dbPath = `${dir}/rd_state.db`
    const programId = "rd-supervisor-blocked"
    const stateRef = `research_state_store:rd_program/${programId}`
    const catalogDbPath = `${dir}/catalog.db`
    const init = run([
      "--supervisor-job",
      "--db",
      dbPath,
      "--program-id",
      programId,
      "--catalog-db",
      catalogDbPath,
      "--json",
      JSON.stringify({
        cycle_id: "cycle-j04-blocked-init",
        now: "2026-07-09T12:00:00.000Z",
        goal: {
          objective: "find a shadow-eligible 4H swing strategy",
          budget: { max_hypotheses: 1, max_trials_total: 2, max_locked_holdout_uses: 1 },
        },
      }),
    ])
    assert.equal(init.ok, true)

    const result = run([
      "--supervisor-job",
      "--db",
      dbPath,
      "--program-id",
      programId,
      "--catalog-db",
      catalogDbPath,
      "--json",
      JSON.stringify({
        cycle_id: "cycle-j04-blocked",
        now: "2026-07-09T12:15:00.000Z",
        supervisor: { max_iterations: 1 },
      }),
    ])

    assert.equal(result.ok, true)
    const data = asRecord(result.data)
    assert.equal(data.mode, "loop")
    const runtimeResult = asRecord(data.runtime_result)
    assert.equal(runtimeResult.domain, "research-strategy-development")
    assert.equal(runtimeResult.job_id, "rd_strategy_supervisor")
    assert.equal(runtimeResult.status, "blocked")
    assert.deepEqual(runtimeResult.writes, { research_state_store: true, artifact_catalog: true })
    assert.deepEqual(runtimeResult.output_refs, [stateRef])
    assert.equal(asRecord(asRecord(data.result).final_state).status, "data_or_tool_blocked")
  } finally {
    rmSync(absoluteDir, { recursive: true, force: true })
  }
})

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
