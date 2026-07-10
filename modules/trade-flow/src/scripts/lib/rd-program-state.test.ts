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
    assert.equal(restored.budget.max_hypotheses, 20)
    assert.equal(restored.budget.max_trials_total, 80)

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
        rejected_mechanisms: [{ check_id: "RND-NEGATIVE-CONTROL-NOT-BEATEN" }],
        universe_lessons: [{ lesson: "negative control dominated" }],
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
            negative_controls: ["side_flip"],
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
    const scoutPlan = asRecord(planned.next_plan?.scout_subagent_plan)
    assert.equal(scoutPlan.enabled, true)
    assert.equal(scoutPlan.dispatch_timing, "before_research_command")
    assert.deepEqual(asArray(scoutPlan.scouts).map((scout) => asRecord(scout).role), ["rd-taxonomy-scout", "rd-history-scout", "rd-data-scout", "rd-edge-scout"])
    assert.equal(asArray(scoutPlan.scouts).every((scout) => asRecord(scout).may_write_state === false), true)
    const backlog = asRecord(planned.next_plan?.strategy_universe_backlog)
    assert.equal(backlog.doc_ref, "docs/strategy-universe-taxonomy.md")
    assert.equal(backlog.machine_backlog_ref, "data/rd/family-backlog.json")
    assert.equal(backlog.p0_certificate_ref, "data/rd/p0-family-certificates.json")
    assert.equal(backlog.machine_backlog_status, "loaded")
    assert.ok(asArray(backlog.implemented_families).includes("time_series_momentum_v1"))
    assert.ok(asArray(backlog.implemented_families).includes("marketability_score_v1"))
    assert.ok(asArray(asRecord(backlog.priority_family_backlog).p0).includes("funding_carry_v1"))
    assert.ok(asArray(backlog.recommended_queue_order).includes("cross_sectional_momentum_v1"))
    const familyStatuses = asArray(backlog.family_statuses).map(asRecord)
    assert.equal(familyStatuses.find((family) => family.family_id === "funding_carry_v1")?.status, "implemented_single_asset_replay")
    assert.equal(familyStatuses.find((family) => family.family_id === "cross_sectional_momentum_v1")?.status, "implemented_panel_research")
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
    assert.match(blocked.next_plan?.reason || "", /queue seed recommendation/)
    assert.equal(asRecord(blocked.next_plan?.strategy_universe_backlog).doc_ref, "docs/strategy-universe-taxonomy.md")
    const queueSeed = asRecord(blocked.next_plan?.queue_seed_recommendation)
    assert.equal(queueSeed.schema_version, "trade-flow.rd-queue-seed-recommendation.v1")
    assert.equal(queueSeed.family_id, "marketability_score_v1")
    assert.equal(queueSeed.required_action, "universe_gate_run")
    assert.equal(queueSeed.ready_for_strategy_trials, false)

    writeRdProgramState(path, updateRdProgramState(state, { status: "paused", now: "2026-07-09T13:30:00Z" }), join(dir, "catalog.db"))
    const stopped = runRdProgramStateCommand({ path, input: { action: "plan_next", now: "2026-07-09T14:00:00Z" } })
    assert.equal(stopped.next_plan?.status, "stopped")
    assert.match(stopped.next_plan?.reason || "", /paused/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd program state caps planned candidates to remaining trial budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-program-state-budget-cap-"))
  try {
    const path = join(dir, "state.json")
    const catalogDb = join(dir, "catalog.db")
    const state = createRdProgramState({
      programId: "rd-budget-cap",
      objective: "never plan more candidates than remaining trial budget",
      now: "2026-07-09T12:00:00Z",
      budget: { max_hypotheses: 4, max_trials_total: 6, max_locked_holdout_uses: 1 },
      nextHypothesisQueue: [{
        hypothesis_id: "h1",
        hypothesis: "test capped candidates",
        manifest_path: "data/discovery/manifest.json",
        mode: "loop",
        search_trial_count: 4,
        candidates: [
          { candidate_id: "C1", family: "time_series_momentum_v1", params: { side: "long" } },
          { candidate_id: "C2", family: "time_series_momentum_v1", params: { side: "short" } },
          { candidate_id: "C3", family: "time_series_momentum_v1", params: { side: "long" } },
          { candidate_id: "C4", family: "time_series_momentum_v1", params: { side: "short" } },
        ],
      }],
    })
    writeRdProgramState(path, updateRdProgramState(state, {
      now: "2026-07-09T12:30:00Z",
      usageDelta: { trials_used: 4 },
    }), catalogDb)

    const planned = runRdProgramStateCommand({
      path,
      input: { action: "plan_next", now: "2026-07-09T13:00:00Z" },
    })

    const payload = asRecord(planned.next_plan?.payload)
    assert.equal(payload.search_trial_count, 2)
    assert.deepEqual(asArray(payload.candidates).map((candidate) => asRecord(candidate).candidate_id), ["C1", "C2"])
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
      hypothesis: "weakness continuation survives negative controls",
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
      hypothesis: "weakness continuation survives negative controls",
      outcome: "no_promote",
      candidate_source: "provided",
      trial_count: 3,
      accepted_count: 0,
      winner: null,
      next_action: "redesign against negative controls",
      failure_summary: {
        primary_failure_area: "negative_controls",
        top_blockers: [{ check_id: "RND-NEGATIVE-CONTROL-NOT-BEATEN", count: 2 }],
        next_system_actions: ["Retest only mechanisms that beat side-flip negative controls."],
      },
      reliability_gate: { status: "blocked" },
    },
    ledger_record: {},
  })

  assert.equal(updated.next_hypothesis_queue.length, 1)
  assert.equal(updated.next_hypothesis_queue[0]?.hypothesis_id, "h1-rnd-negative-control-not-beaten")
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
        negative_controls: ["side_flip"],
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

test("rd program state blocks instead of rerunning a rejected mechanism", () => {
  const state = createRdProgramState({
    programId: "rd-reject-mechanism",
    objective: "do not spend budget on rejected mechanisms",
    now: "2026-07-09T12:00:00Z",
    budget: { max_hypotheses: 4, max_trials_total: 12, max_locked_holdout_uses: 1 },
    nextHypothesisQueue: [{
      hypothesis_id: "h1",
      hypothesis: "compression breakout has edge",
      manifest_path: "data/discovery/manifest.json",
      timeframe: "4h",
      search_trial_count: 3,
      candidates: [{ candidate_id: "C1", family: "volatility_compression_breakout_v1", params: { side: "long" } }],
    }],
  })

  const updated = updateRdProgramStateFromResearchResult(state, {
    run_id: "run-1",
    created_at: "2026-07-09T13:00:00Z",
    artifact_ref: "tmp/artifacts/strategy-rnd/run-1.json",
    batch: {
      batch_id: "rd-reject-mechanism-h1",
      hypothesis: "compression breakout has edge",
      outcome: "no_promote",
      candidate_source: "provided",
      trial_count: 3,
      accepted_count: 0,
      winner: null,
      failure_summary: {
        primary_failure_area: "edge_expectancy",
        top_blockers: [{ check_id: "R-PROFIT-FACTOR", count: 3 }],
        next_system_actions: ["Reject this setup mechanism; predeclare a different market edge instead of adding filters."],
      },
      reliability_gate: { status: "blocked", decision: "reject_hypothesis" },
    },
    ledger_record: {},
  })

  assert.equal(updated.next_hypothesis_queue.length, 1)
  const followup = asRecord(updated.next_hypothesis_queue[0])
  assert.equal(followup.ready, false)
  assert.equal(followup.source, "rd_learning_memory")
  assert.match(String(followup.blocked_reason), /distinct predeclared market edge/)
  assert.equal(asArray(followup.candidates).length, 0)
})

test("rd program state blocks negative-control rejects instead of rerunning the same mechanism", () => {
  const state = createRdProgramState({
    programId: "rd-negative-control-reject",
    objective: "do not rerun mechanisms that only show mild negative-control-dominated edge",
    now: "2026-07-09T12:00:00Z",
    budget: { max_hypotheses: 4, max_trials_total: 12, max_locked_holdout_uses: 1 },
    nextHypothesisQueue: [{
      hypothesis_id: "h1",
      hypothesis: "structure breakout retest has edge",
      manifest_path: "data/discovery/manifest.json",
      timeframe: "4h",
      search_trial_count: 4,
      candidates: [{ candidate_id: "C1", family: "structure_breakout_retest_v1", params: { side: "long" } }],
    }],
  })

  const updated = updateRdProgramStateFromResearchResult(state, {
    run_id: "run-1",
    created_at: "2026-07-09T13:00:00Z",
    artifact_ref: "tmp/artifacts/strategy-rnd/run-1.json",
    batch: {
      batch_id: "rd-negative-control-reject-h1",
      hypothesis: "structure breakout retest has edge",
      outcome: "no_promote",
      candidate_source: "provided",
      trial_count: 4,
      accepted_count: 0,
      winner: null,
      failure_summary: {
        primary_failure_area: "negative_control",
        top_blockers: [{ check_id: "RND-NEGATIVE-CONTROL-NOT-BEATEN", count: 3 }],
        next_system_actions: ["Reject mild positive edge until it beats side-flip and delayed-entry negative controls."],
      },
      reliability_gate: { status: "blocked", decision: "reject_hypothesis" },
    },
    ledger_record: {},
  })

  const followup = asRecord(updated.next_hypothesis_queue[0])
  assert.equal(followup.ready, false)
  assert.match(String(followup.blocked_reason), /distinct predeclared market edge/)
  assert.equal(asRecord(followup.generated_from).required_next_step, "predeclare_distinct_market_edge")
  assert.equal(asArray(followup.candidates).length, 0)
})

test("rd program state blocks redesign actions instead of rerunning stale candidates", () => {
  const state = createRdProgramState({
    programId: "rd-redesign",
    objective: "do not rerun stale candidates when geometry must change",
    now: "2026-07-09T12:00:00Z",
    budget: { max_hypotheses: 4, max_trials_total: 12, max_locked_holdout_uses: 1 },
    nextHypothesisQueue: [{
      hypothesis_id: "h1",
      hypothesis: "time-series momentum has edge",
      manifest_path: "data/discovery/manifest.json",
      timeframe: "4h",
      search_trial_count: 4,
      candidates: [
        { candidate_id: "C1", family: "time_series_momentum_v1", params: { side: "long", stop_atr: 1, reward_risk: 2 } },
        { candidate_id: "C2", family: "time_series_momentum_v1", params: { side: "short", stop_atr: 1, reward_risk: 2 } },
      ],
    }],
  })

  const updated = updateRdProgramStateFromResearchResult(state, {
    run_id: "run-1",
    created_at: "2026-07-09T13:00:00Z",
    artifact_ref: "tmp/artifacts/strategy-rnd/run-1.json",
    batch: {
      batch_id: "rd-redesign-h1",
      hypothesis: "time-series momentum has edge",
      outcome: "no_promote",
      candidate_source: "provided",
      trial_count: 2,
      accepted_count: 0,
      winner: null,
      failure_summary: {
        primary_failure_area: "risk_shape",
        top_blockers: [{ check_id: "R-DRAWDOWN", count: 2 }],
        next_system_actions: ["Redesign stop/target geometry before adding confirmation factors."],
      },
      reliability_gate: { status: "blocked", decision: "reject_hypothesis" },
    },
    ledger_record: {},
  })

  const followup = asRecord(updated.next_hypothesis_queue[0])
  assert.equal(followup.ready, false)
  assert.match(String(followup.blocked_reason), /predeclared candidate revision/)
  assert.equal(asRecord(followup.generated_from).required_next_step, "predeclare_candidate_revision")
  assert.equal(asArray(followup.candidates).length, 0)
})

test("rd program state consumes campaign discovery failure before scheduling follow-up", () => {
  const state = createRdProgramState({
    programId: "rd-campaign-failure",
    objective: "campaign failures should carry discovery diagnostics",
    now: "2026-07-09T12:00:00Z",
    budget: { max_hypotheses: 4, max_trials_total: 12, max_locked_holdout_uses: 1 },
    nextHypothesisQueue: [{
      hypothesis_id: "h1",
      hypothesis: "compression breakout has edge",
      discovery_manifest_path: "data/discovery/manifest.json",
      validation_manifest_path: "data/validation/manifest.json",
      candidates: [{ candidate_id: "C1", family: "volatility_compression_breakout_v1", params: { side: "long" } }],
    }],
  })

  const updated = updateRdProgramStateFromResearchResult(state, {
    campaign_id: "campaign-1",
    created_at: "2026-07-09T13:00:00Z",
    artifact_ref: "tmp/artifacts/strategy-rnd/campaign-1.json",
    outcome: "no_validated_candidate",
    stop_reason: "hypothesis_queue_exhausted",
    trials_used: 3,
    hypotheses_run: 1,
    holdout_evaluations: 0,
    validated_candidate: null,
    runs: [{
      hypothesis_id: "h1",
      discovery_run_ref: "tmp/discovery.json",
      discovery_outcome: "no_promote",
      discovery_failure_summary: {
        primary_failure_area: "edge_expectancy",
        top_blockers: [{ check_id: "R-PROFIT-FACTOR", count: 3 }],
        next_system_actions: ["Reject this setup mechanism; predeclare a different market edge instead of adding filters."],
      },
      discovery_reliability_gate: { status: "blocked" },
      validation_run_ref: null,
      validation_outcome: null,
    }],
  })

  assert.equal(updated.latest_failure_summary?.primary_failure_area, "edge_expectancy")
  const followup = asRecord(updated.next_hypothesis_queue[0])
  assert.equal(followup.ready, false)
  assert.equal(asArray(followup.candidates).length, 0)
  assert.match(String(followup.blocked_reason), /distinct predeclared market edge/)
})

test("rd program state blocks repeated cost diagnostics after one diagnostic loop", () => {
  const state = createRdProgramState({
    programId: "rd-cost-loop",
    objective: "do not repeat the same cost diagnostic indefinitely",
    now: "2026-07-09T12:00:00Z",
    budget: { max_hypotheses: 4, max_trials_total: 12, max_locked_holdout_uses: 1 },
    nextHypothesisQueue: [{
      hypothesis_id: "h-cost",
      hypothesis: "audit turnover and cost assumptions",
      manifest_path: "data/discovery/manifest.json",
      timeframe: "4h",
      diagnostic_mode: true,
      search_trial_count: 2,
      candidates: [{ candidate_id: "C1", family: "time_series_momentum_v1", params: { side: "long" } }],
    }],
  })

  const updated = updateRdProgramStateFromResearchResult(state, {
    run_id: "run-cost",
    created_at: "2026-07-09T13:00:00Z",
    artifact_ref: "tmp/artifacts/strategy-rnd/run-cost.json",
    batch: {
      batch_id: "rd-cost-loop-h-cost",
      hypothesis: "audit turnover and cost assumptions",
      outcome: "no_promote",
      candidate_source: "provided",
      trial_count: 2,
      accepted_count: 0,
      winner: null,
      failure_summary: {
        primary_failure_area: "execution_cost",
        top_blockers: [{ check_id: "RND-ROBUSTNESS-COST", count: 2 }],
        next_system_actions: ["Audit turnover, marketability, and fee tier assumptions before promoting any high-turnover variant."],
      },
      reliability_gate: { status: "blocked", decision: "fix_cost_model" },
    },
    ledger_record: {},
  })

  const followup = asRecord(updated.next_hypothesis_queue[0])
  assert.equal(followup.ready, false)
  assert.match(String(followup.blocked_reason), /cost diagnostic already ran/)
  assert.equal(asRecord(followup.generated_from).required_next_step, "review_cost_model_or_predeclare_cost_reduction")
})

test("rd program state blocks repeated generic diagnostics after one diagnostic loop", () => {
  const state = createRdProgramState({
    programId: "rd-diagnostic-loop",
    objective: "do not repeat generic diagnostics indefinitely",
    now: "2026-07-09T12:00:00Z",
    budget: { max_hypotheses: 4, max_trials_total: 12, max_locked_holdout_uses: 1 },
    nextHypothesisQueue: [{
      hypothesis_id: "h-diag",
      hypothesis: "inspect sample efficiency",
      manifest_path: "data/discovery/manifest.json",
      timeframe: "4h",
      diagnostic_mode: true,
      search_trial_count: 2,
      candidates: [{ candidate_id: "C1", family: "structure_breakout_retest_v1", params: { side: "long" } }],
    }],
  })

  const updated = updateRdProgramStateFromResearchResult(state, {
    run_id: "run-diag",
    created_at: "2026-07-09T13:00:00Z",
    artifact_ref: "tmp/artifacts/strategy-rnd/run-diag.json",
    batch: {
      batch_id: "rd-diagnostic-loop-h-diag",
      hypothesis: "inspect sample efficiency",
      outcome: "no_promote",
      candidate_source: "provided",
      trial_count: 2,
      accepted_count: 0,
      winner: null,
      failure_summary: {
        primary_failure_area: "sample_efficiency",
        top_blockers: [{ check_id: "RND-OOS-EFFECTIVE-SAMPLE", count: 2 }],
        next_system_actions: ["Open a constrained diagnostic hypothesis from the latest failed mechanism."],
      },
      reliability_gate: { status: "blocked", decision: "inspect_blockers" },
    },
    ledger_record: {},
  })

  const followup = asRecord(updated.next_hypothesis_queue[0])
  assert.equal(followup.ready, false)
  assert.match(String(followup.blocked_reason), /diagnostic follow-up already ran/)
  assert.equal(asRecord(followup.generated_from).required_next_step, "predeclare_new_mechanism_or_research_surface")
})

test("rd program state blocks actions that require panel or independent validation", () => {
  const state = createRdProgramState({
    programId: "rd-panel-required",
    objective: "do not spend single-asset loop budget when panel is required",
    now: "2026-07-09T12:00:00Z",
    budget: { max_hypotheses: 4, max_trials_total: 12, max_locked_holdout_uses: 1 },
    nextHypothesisQueue: [{
      hypothesis_id: "h-panel",
      hypothesis: "single asset setup frequency is too low",
      manifest_path: "data/discovery/manifest.json",
      timeframe: "4h",
      search_trial_count: 2,
      candidates: [{ candidate_id: "C1", family: "structure_breakout_retest_v1", params: { side: "long" } }],
    }],
  })

  const updated = updateRdProgramStateFromResearchResult(state, {
    run_id: "run-panel",
    created_at: "2026-07-09T13:00:00Z",
    artifact_ref: "tmp/artifacts/strategy-rnd/run-panel.json",
    batch: {
      batch_id: "rd-panel-required-h-panel",
      hypothesis: "single asset setup frequency is too low",
      outcome: "no_promote",
      candidate_source: "provided",
      trial_count: 2,
      accepted_count: 0,
      winner: null,
      failure_summary: {
        primary_failure_area: "sample_efficiency",
        top_blockers: [{ check_id: "RND-OOS-EFFECTIVE-SAMPLE", count: 2 }],
        next_system_actions: ["Move this hypothesis to panel R&D or loosen setup frequency before spending more single-asset trials."],
      },
      reliability_gate: { status: "blocked", decision: "inspect_blockers" },
    },
    ledger_record: {},
  })

  const followup = asRecord(updated.next_hypothesis_queue[0])
  assert.equal(followup.ready, false)
  assert.match(String(followup.blocked_reason), /different research surface/)
  assert.equal(asRecord(followup.generated_from).required_next_step, "move_to_panel_or_expand_independent_validation")
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
