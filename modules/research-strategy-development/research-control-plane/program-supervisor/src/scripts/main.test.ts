import assert from "node:assert/strict"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { run } from "./main"

type JSONRecord = Record<string, unknown>

test("rd supervisor CLI initializes then runs native J04 owner loop", () => {
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
    assert.equal(data.mode, "init_loop")
    assert.equal(asRecord(asRecord(data.result).final_state).status, "data_or_tool_blocked")
    const runtimeResult = asRecord(data.runtime_result)
    assert.equal(runtimeResult.schema_id, "trade.domain-runtime.domain-job-result.v1")
    assert.equal(runtimeResult.domain, "research-strategy-development")
    assert.equal(runtimeResult.job_id, "rd_strategy_supervisor")
    assert.equal(runtimeResult.status, "blocked")
    assert.deepEqual(runtimeResult.writes, { research_state_store: true, artifact_catalog: true })
    assert.deepEqual(runtimeResult.output_refs, [stateRef])
  } finally {
    rmSync(absoluteDir, { recursive: true, force: true })
  }
})

test("rd supervisor CLI exposes native J04 blocked result for existing non-active state", () => {
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

test("rd supervisor CLI can seed the queue from a hypothesis contract", () => {
  const dir = "tmp/check/rd-supervisor-contract-seed"
  const absoluteDir = join(repoRoot(), dir)
  rmSync(absoluteDir, { recursive: true, force: true })
  mkdirSync(absoluteDir, { recursive: true })
  try {
    const dbPath = `${dir}/rd_state.db`
    const programId = "rd-supervisor-contract"
    const result = run([
      "--supervisor-job",
      "--db",
      dbPath,
      "--program-id",
      programId,
      "--catalog-db",
      `${dir}/catalog.db`,
      "--json",
      JSON.stringify({
        cycle_id: "cycle-j04-contract",
        now: "2026-07-09T12:15:00.000Z",
        goal: {
          objective: "design a new family before replay",
          budget: { max_hypotheses: 1, max_trials_total: 1, max_locked_holdout_uses: 0 },
          hypothesis_contract: minimalContract(),
        },
      }),
    ])

    assert.equal(result.ok, true)
    const state = asRecord(asRecord(asRecord(result.data).result).final_state)
    assert.equal(state.status, "data_or_tool_blocked")
    const queue = asRecord((state.next_hypothesis_queue as unknown[])[0])
    assert.equal(queue.source, "research.strategy-hypothesis-designer")
    assert.equal(queue.ready, false)
    assert.equal(queue.blocked_reason, "family_design_required_before_strategy_trials")
    assert.equal(asRecord(state.budget).max_locked_holdout_uses, 0)
  } finally {
    rmSync(absoluteDir, { recursive: true, force: true })
  }
})

test("rd supervisor CLI keeps formal Replay separate from compatibility evaluation", () => {
  const prepare = run([
    "--formal-replay-prepare-job",
    "--json",
    JSON.stringify({
      schema_version: "trade.rd-formal-replay-data-prepare-request.v1",
      unexpected: true,
    }),
  ])
  assert.equal(prepare.ok, false)
  assert.match(String(prepare.error), /formal Replay data prepare request contract/)
  const result = run([
    "--formal-replay-job",
    "--json",
    JSON.stringify({
      schema_version: "trade.rd-formal-replay-job-request.v1",
      unexpected: true,
    }),
  ])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /formal Replay job request contract/)
  const exclusive = run([
    "--formal-replay-prepare-job",
    "--formal-replay-job",
    "--evaluation-job",
    "--json",
    "{}",
  ])
  assert.equal(exclusive.ok, false)
  assert.match(String(exclusive.error), /mutually exclusive/)
})

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function minimalContract(): JSONRecord {
  return {
    schema_version: "trade-flow.strategy-hypothesis-contract.v1",
    hypothesis_id: "needs-new-family",
    title: "Needs new execution family",
    return_driver: "microstructure_liquidity",
    portfolio_shape: "single_asset_directional",
    data_surfaces: ["ohlcv"],
    thesis: {
      mechanism: "liquidity withdrawal after failed sweep",
      behavioral_claim: "liquidity takers may chase after a failed sweep only when book recovery is delayed.",
      participants: "liquidity takers and passive market makers",
      regime: "thin high beta markets",
      falsification: "fails when delayed entry performs the same",
    },
    universe: { symbols: ["ALTUSDT"] },
    trade_logic: {
      timeframe: "4h",
      side: "short",
      entry: "failed sweep confirmation",
      exit: "fixed R or max hold",
      risk: "ATR stop",
    },
    risk: { cost_sensitivity: "must survive taker fees" },
    evidence_plan: {
      primary_tests: ["family design review"],
      negative_controls: ["entry_lag"],
      validation_plan: "Design family before replay.",
      promotion_boundary: "No replay until an executable family exists.",
    },
    compilation: { requires_new_family: true },
    constraints: { search_trial_count: 1, max_total_trials: 1 },
  }
}
