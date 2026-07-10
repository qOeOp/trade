import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  createRdProgramState,
  readRdProgramState,
  updateRdProgramStateFromResearchResult,
  writeRdProgramState,
} from "./rd-program-state"
import { runRdSupervisorLoopWithDeps } from "./rd-supervisor-runner"
import type { JSONRecord } from "./json"

test("rd supervisor runner loops plan execution and state writeback until budget exhaustion", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-supervisor-run-"))
  try {
    const path = join(dir, "state.json")
    const catalogDb = join(dir, "catalog.db")
    writeRdProgramState(path, createRdProgramState({
      programId: "rd-loop",
      objective: "loop until terminal R&D state",
      now: "2026-07-09T12:00:00Z",
      budget: { max_hypotheses: 2, max_trials_total: 2, max_locked_holdout_uses: 1 },
      nextHypothesisQueue: [{
        hypothesis_id: "h1",
        hypothesis: "test a weak mechanism",
        manifest_path: "data/discovery/manifest.json",
        candidates: [{ candidate_id: "C1", family: "trend_pullback_v1", params: { side: "long" } }],
      }],
    }), catalogDb)

    let loopCalls = 0
    const result = runRdSupervisorLoopWithDeps({
      path,
      catalogDbPath: catalogDb,
      input: { now: "2026-07-09T13:00:00Z", max_iterations: 5 },
    }, {
      runLoop: (payload) => {
        loopCalls += 1
        const batchId = String(payload.batch_id)
        const report = {
          run_id: String(payload.run_id),
          created_at: String(payload.now),
          artifact_ref: join(dir, `${batchId}.json`),
          batch: {
            batch_id: batchId,
            hypothesis: String(payload.hypothesis),
            outcome: "no_promote",
            candidate_source: "provided",
            trial_count: 1,
            accepted_count: 0,
            winner: null,
            failure_summary: {
              primary_failure_area: "overfit",
              top_blockers: [{ check_id: "RND-STAT-PBO", count: 1 }],
              next_system_actions: ["Simplify the mechanism before the next trial."],
            },
            reliability_gate: { status: "blocked" },
          },
          ledger_record: {},
        }
        writeRdProgramState(
          String(payload.rd_program_state_path),
          updateRdProgramStateFromResearchResult(readRdProgramState(String(payload.rd_program_state_path)), report, String(payload.now)),
          catalogDb,
        )
        return report
      },
      runCampaign: () => {
        throw new Error("campaign should not run")
      },
    })

    assertSchemaRequired(readSchema("rd-supervisor-run-result"), result as unknown as JSONRecord)
    assert.equal(loopCalls, 2)
    assert.equal(result.status, "budget_exhausted")
    assert.equal(result.iterations.length, 2)
    assert.equal(result.final_state.status, "budget_exhausted")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd supervisor runner marks empty active queue as data/tool blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-supervisor-empty-"))
  try {
    const path = join(dir, "state.json")
    writeRdProgramState(path, createRdProgramState({
      programId: "rd-empty",
      objective: "needs a runnable queue",
      now: "2026-07-09T12:00:00Z",
    }), join(dir, "catalog.db"))

    const result = runRdSupervisorLoopWithDeps({
      path,
      input: { now: "2026-07-09T13:00:00Z" },
    }, {
      runLoop: () => {
        throw new Error("loop should not run")
      },
      runCampaign: () => {
        throw new Error("campaign should not run")
      },
    })

    assert.equal(result.status, "data_or_tool_blocked")
    assert.equal(result.iterations.length, 1)
    assert.match(String(result.final_state.latest_failure_summary?.reason), /next_hypothesis_queue is empty/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function readSchema(name: string): JSONRecord {
  return JSON.parse(readFileSync(new URL(`../../schemas/${name}.schema.json`, import.meta.url), "utf8")) as JSONRecord
}

function assertSchemaRequired(schema: JSONRecord, result: JSONRecord): void {
  for (const field of asArray(schema.required).map(String)) {
    assert.ok(result[field] !== undefined, `missing ${field}`)
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
