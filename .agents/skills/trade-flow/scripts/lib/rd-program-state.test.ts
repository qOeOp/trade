import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  createRdProgramState,
  rdProgramGoalFromState,
  readRdProgramState,
  runRdProgramStateCommand,
  updateRdProgramState,
  updateRdProgramStateFromResearchResult,
  writeRdProgramState,
} from "./rd-program-state"

type JSONRecord = Record<string, unknown>

test("rd program state carries learning forward and stops on budget exhaustion", () => {
  const state = createRdProgramState({
    programId: "Shadow Candidate Search",
    objective: "find a shadow-eligible 4H swing strategy",
    now: "2026-07-09T12:00:00Z",
    budget: {
      max_hypotheses: 2,
      max_trials_total: 4,
      max_locked_holdout_uses: 1,
    },
    nextHypothesisQueue: [{ family: "relative-weakness-momentum" }],
  })

  assert.equal(state.program_id, "shadow-candidate-search")
  assert.equal(state.status, "active")
  assert.equal(state.guardrails.evidence_status, "research_memory_not_strategy_evidence")

  const updated = updateRdProgramState(state, {
    now: "2026-07-09T13:00:00Z",
    usageDelta: {
      hypotheses_run: 2,
      trials_used: 3,
    },
    latestFailureSummary: { dominant_failure: "cost_drag" },
    latestReliabilityGate: { passed: false },
    rejectedMechanisms: [{ family: "relative-weakness-momentum", reason: "fee fragile" }],
    universeLessons: [{ universe: "high beta alts", lesson: "breakouts decayed in holdout" }],
    artifactRefs: ["data/artifacts/strategy-rnd/run-1.json"],
  })

  assert.equal(updated.status, "budget_exhausted")
  assert.equal(updated.usage.hypotheses_run, 2)
  assert.deepEqual(updated.latest_failure_summary, { dominant_failure: "cost_drag" })
  assert.deepEqual(updated.artifact_refs, ["data/artifacts/strategy-rnd/run-1.json"])

  const goal = rdProgramGoalFromState(updated)
  assert.equal(goal.objective, "find a shadow-eligible 4H swing strategy")
  assert.equal(goal.status, "budget_exhausted")
  assert.deepEqual(goal.stop_conditions, ["shadow_candidate_found", "budget_exhausted", "data_or_tool_blocked"])
})

test("rd program state can be persisted and registered in the data catalog", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-program-state-"))
  try {
    const path = join(dir, "state.json")
    const catalogDb = join(dir, "catalog.db")
    const state = createRdProgramState({
      programId: "rd-learning-loop",
      objective: "continue R&D until a shadow candidate or blocker",
      now: "2026-07-09T12:00:00Z",
    })

    const result = writeRdProgramState(path, state, catalogDb)
    assert.ok(result.path.endsWith("state.json"))
    assert.ok(result.catalog_db_path.endsWith("catalog.db"))
    assert.ok(existsSync(path))

    const restored = readRdProgramState(path)
    assert.equal(restored.program_id, "rd-learning-loop")
    assert.equal(restored.status, "active")

    const db = new Database(catalogDb)
    try {
      const ref = db.query("SELECT referrer_type, referrer_id, role FROM artifact_ref").get() as {
        referrer_type: string
        referrer_id: string
        role: string
      }
      assert.deepEqual(ref, {
        referrer_type: "rd_program",
        referrer_id: "rd-learning-loop",
        role: "state",
      })
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd program state command initializes reads and updates the durable state", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-program-state-command-"))
  try {
    const path = join(dir, "state.json")
    const catalogDb = join(dir, "catalog.db")
    const init = runRdProgramStateCommand({
      path,
      catalogDbPath: catalogDb,
      input: {
        action: "init",
        program_id: "rd-command",
        objective: "learn from R&D failures",
        now: "2026-07-09T12:00:00Z",
        budget: { max_hypotheses: 3, max_trials_total: 9 },
      },
    })
    assertSchemaRequired(readSchema("rd-program-state-result"), init as unknown as JSONRecord)
    assert.equal(init.action, "init")
    assert.equal(init.state.program_id, "rd-command")

    const update = runRdProgramStateCommand({
      path,
      catalogDbPath: catalogDb,
      input: {
        action: "update",
        now: "2026-07-09T13:00:00Z",
        usage_delta: { hypotheses_run: 1, trials_used: 2 },
        rejected_mechanisms: [{ check_id: "RND-NULL-NOT-BEATEN" }],
        universe_lessons: [{ lesson: "null control dominated" }],
      },
    })
    assert.equal(update.action, "update")
    assert.equal(update.state.usage.trials_used, 2)
    assert.equal(update.state.rejected_mechanisms.length, 1)

    const read = runRdProgramStateCommand({ path, input: { action: "read" } })
    assert.equal(read.action, "read")
    assert.equal(read.state.usage.hypotheses_run, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd program state command plans the next campaign from the hypothesis queue", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-program-state-plan-"))
  try {
    const path = join(dir, "state.json")
    const catalogDb = join(dir, "catalog.db")
    runRdProgramStateCommand({
      path,
      catalogDbPath: catalogDb,
      input: {
        action: "init",
        program_id: "rd-plan",
        objective: "find a durable breakout candidate",
        now: "2026-07-09T12:00:00Z",
        budget: { max_hypotheses: 3, max_trials_total: 7, max_locked_holdout_uses: 1 },
        next_hypothesis_queue: [{
          hypothesis_id: "breakout-1",
          hypothesis: "volatility compression breakout survives costs",
          discovery_manifest_path: "data/discovery/manifest.json",
          validation_manifest_path: "data/validation/manifest.json",
          timeframe: "4h",
          max_total_trials: 5,
          thesis_certificate: {
            edge_type: "breakout",
            behavioral_hypothesis: "late shorts chase after compression",
            market_participants: "momentum and forced covering",
            regime: "compressed volatility",
            invalidation: "range reclaim failure",
            cost_sensitivity: "avoid high fee churn",
            candidate_universe: { symbols: ["BTCUSDT"] },
            null_controls: ["side_flip"],
          },
          candidates: [{ candidate_id: "C-BREAKOUT", family: "volatility_compression_breakout_v1", params: { side: "long" } }],
        }],
      },
    })

    const planned = runRdProgramStateCommand({
      path,
      input: {
        action: "plan_next",
        now: "2026-07-09T13:00:00Z",
        artifact_root: "tmp/artifacts/strategy-rnd",
        catalog_db_path: "data/data_catalog.db",
      },
    })

    assertSchemaRequired(readSchema("rd-program-state-result"), planned as unknown as JSONRecord)
    assert.equal(planned.action, "plan_next")
    assert.equal(planned.next_plan?.status, "ready")
    assert.equal(planned.next_plan?.command, "--strategy-rnd-campaign")
    assert.equal(planned.next_plan?.guardrails.read_only_plan, true)
    const payload = planned.next_plan?.payload as JSONRecord
    assert.equal(payload.rd_program_state_path, path)
    assert.equal(payload.max_total_trials, 5)
    const hypothesis = asRecord(asArray(payload.hypotheses)[0])
    assert.equal(hypothesis.hypothesis_id, "breakout-1")
    assert.equal(hypothesis.discovery_manifest_path, "data/discovery/manifest.json")
    assert.equal(hypothesis.validation_manifest_path, "data/validation/manifest.json")
    assert.equal(asArray(hypothesis.candidates).length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd program state next plan blocks when no active queue can run", () => {
  const state = createRdProgramState({
    programId: "rd-empty-plan",
    objective: "wait for constrained hypotheses",
    now: "2026-07-09T12:00:00Z",
  })
  const dir = mkdtempSync(join(tmpdir(), "rd-program-state-empty-plan-"))
  try {
    const path = join(dir, "state.json")
    writeRdProgramState(path, state, join(dir, "catalog.db"))
    const blocked = runRdProgramStateCommand({ path, input: { action: "plan_next", now: "2026-07-09T13:00:00Z" } })
    assert.equal(blocked.next_plan?.status, "blocked")
    assert.equal(blocked.next_plan?.command, null)

    writeRdProgramState(path, updateRdProgramState(state, { status: "paused", now: "2026-07-09T13:30:00Z" }), join(dir, "catalog.db"))
    const stopped = runRdProgramStateCommand({ path, input: { action: "plan_next", now: "2026-07-09T14:00:00Z" } })
    assert.equal(stopped.next_plan?.status, "stopped")
    assert.match(stopped.next_plan?.reason || "", /paused/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd program state can ingest loop and campaign research results", () => {
  const state = createRdProgramState({
    programId: "rd-ingest",
    objective: "turn research artifacts into learning memory",
    now: "2026-07-09T12:00:00Z",
    budget: { max_hypotheses: 4, max_trials_total: 12, max_locked_holdout_uses: 2 },
  })
  const loopUpdated = updateRdProgramStateFromResearchResult(state, {
    run_id: "loop-1",
    created_at: "2026-07-09T13:00:00Z",
    artifact_ref: "tmp/artifacts/strategy-rnd/loop-1.json",
    batch: {
      batch_id: "loop-1",
      hypothesis: "test weak momentum",
      outcome: "no_promote",
      candidate_source: "provided",
      trial_count: 2,
      accepted_count: 0,
      next_action: "inspect blockers",
      failure_summary: {
        primary_failure_area: "overfit",
        top_blockers: [{ check_id: "RND-STAT-PBO", count: 1 }],
      },
      reliability_gate: { status: "blocked" },
    },
    ledger_record: {},
  })
  assert.equal(loopUpdated.usage.hypotheses_run, 1)
  assert.equal(loopUpdated.usage.trials_used, 2)
  assert.deepEqual(loopUpdated.latest_reliability_gate, { status: "blocked" })
  assert.equal(loopUpdated.rejected_mechanisms[0]?.check_id, "RND-STAT-PBO")

  const campaignUpdated = updateRdProgramStateFromResearchResult(loopUpdated, {
    campaign_id: "campaign-1",
    created_at: "2026-07-09T14:00:00Z",
    artifact_ref: "tmp/artifacts/strategy-rnd/campaign-1.json",
    outcome: "validated_candidate_found",
    stop_reason: "validated_candidate_found",
    trials_used: 1,
    hypotheses_run: 1,
    holdout_evaluations: 1,
    validated_candidate: { candidate_id: "candidate-1", family: "trend_pullback_v1" },
    runs: [{ discovery_run_ref: "tmp/discovery.json", validation_run_ref: "tmp/validation.json" }],
  })
  assert.equal(campaignUpdated.status, "shadow_candidate_found")
  assert.equal(campaignUpdated.usage.locked_holdout_uses, 1)
  assert.ok(campaignUpdated.artifact_refs.includes("tmp/validation.json"))
})

test("rd program state retires failed hypotheses and schedules diagnostic follow-up work", () => {
  const state = createRdProgramState({
    programId: "rd-learning",
    objective: "keep learning until the mechanism is useful",
    now: "2026-07-09T12:00:00Z",
    budget: { max_hypotheses: 4, max_trials_total: 12, max_locked_holdout_uses: 1 },
    nextHypothesisQueue: [{
      hypothesis_id: "h1",
      hypothesis: "weakness continuation survives null controls",
      manifest_path: "data/discovery/manifest.json",
      timeframe: "4h",
      search_trial_count: 3,
      candidates: [{ candidate_id: "C1", family: "relative_weakness_momentum_v1", params: { side: "short" } }],
    }],
  })

  const updated = updateRdProgramStateFromResearchResult(state, {
    run_id: "run-1",
    created_at: "2026-07-09T13:00:00Z",
    artifact_ref: "tmp/artifacts/strategy-rnd/run-1.json",
    batch: {
      batch_id: "rd-learning-h1",
      hypothesis: "weakness continuation survives null controls",
      outcome: "no_promote",
      candidate_source: "provided",
      trial_count: 3,
      accepted_count: 0,
      winner: null,
      next_action: "redesign against null controls",
      failure_summary: {
        primary_failure_area: "null_controls",
        top_blockers: [{ check_id: "RND-NULL-NOT-BEATEN", count: 2 }],
        next_system_actions: ["Retest only mechanisms that beat side-flip null controls."],
      },
      reliability_gate: { status: "blocked" },
    },
    ledger_record: {},
  })

  assert.equal(updated.next_hypothesis_queue.length, 1)
  assert.equal(updated.next_hypothesis_queue[0]?.hypothesis_id, "h1-rnd-null-not-beaten")
  assert.equal(updated.next_hypothesis_queue[0]?.predecessor_hypothesis_id, "h1")
  assert.equal(updated.next_hypothesis_queue[0]?.source, "rd_learning_memory")
  assert.equal(asRecord(updated.next_hypothesis_queue[0]?.generated_from).source, "strategy_rnd_loop")
})

test("rd program state converts discovery winners into validation campaign work", () => {
  const state = createRdProgramState({
    programId: "rd-validation",
    objective: "validate frozen discovery winners",
    now: "2026-07-09T12:00:00Z",
    budget: { max_hypotheses: 4, max_trials_total: 12, max_locked_holdout_uses: 1 },
    nextHypothesisQueue: [{
      hypothesis_id: "h1",
      hypothesis: "compression breakout survives validation",
      discovery_manifest_path: "data/discovery/manifest.json",
      validation_manifest_path: "data/validation/manifest.json",
      timeframe: "4h",
      thesis_certificate: {
        edge_type: "breakout",
        behavioral_hypothesis: "late shorts chase expansion",
        market_participants: "momentum and forced covering",
        regime: "compressed volatility",
        invalidation: "failed range break",
        cost_sensitivity: "low turnover",
        candidate_universe: { symbols: ["BTCUSDT"] },
        null_controls: ["side_flip"],
      },
      candidates: [{ candidate_id: "C1", family: "volatility_compression_breakout_v1", params: { side: "long" } }],
    }],
  })

  const updated = updateRdProgramStateFromResearchResult(state, {
    run_id: "run-1",
    created_at: "2026-07-09T13:00:00Z",
    artifact_ref: "tmp/artifacts/strategy-rnd/run-1.json",
    batch: {
      batch_id: "rd-validation-h1",
      hypothesis: "compression breakout survives validation",
      outcome: "candidate_found",
      candidate_source: "provided",
      trial_count: 1,
      accepted_count: 1,
      winner: {
        candidate_id: "WINNER",
        description: "frozen breakout",
        family: "volatility_compression_breakout_v1",
        parameter_count: 3,
        params: { side: "long", lookback: 20 },
      },
      failure_summary: { primary_failure_area: "", top_blockers: [] },
      reliability_gate: { status: "candidate_ready" },
    },
    ledger_record: {},
  })

  assert.equal(updated.next_hypothesis_queue.length, 1)
  const followup = asRecord(updated.next_hypothesis_queue[0])
  assert.equal(followup.hypothesis_id, "h1-validate-winner")
  assert.equal(followup.mode, "campaign")
  assert.equal(followup.validation_manifest_path, "data/validation/manifest.json")
  assert.equal(asArray(followup.candidates).length, 1)
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

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
