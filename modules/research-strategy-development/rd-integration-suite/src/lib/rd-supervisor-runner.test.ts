import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  createRdProgramState,
  readRdProgramState,
  updateRdProgramStateFromResearchResult,
  writeRdProgramState,
} from "../../../rd-program-state/src/lib/rd-program-state"
import { runRdSupervisorLoopWithDeps } from "../../../rd-supervisor/src/lib/rd-supervisor-runner"
import { resolveRepoPath } from "../../../../contracts/runtime-core/src/paths"
import { lintStrategyContract } from "../../../../contracts/strategy-contract/src/strategy-contract"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"

test("rd supervisor runner loops plan execution and state writeback until budget exhaustion", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-supervisor-run-"))
  try {
    const dbPath = join(dir, "rd_state.db")
    const stateRef = rdProgramRef("rd-loop")
    const catalogDb = join(dir, "catalog.db")
    writeRdProgramState(stateRef, createRdProgramState({
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
    }), undefined, dbPath)

    let loopCalls = 0
    const result = runRdSupervisorLoopWithDeps({
      path: stateRef,
      dbPath,
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
          String(payload.rd_program_ref),
          updateRdProgramStateFromResearchResult(readRdProgramState(String(payload.rd_program_ref), String(payload.rd_state_db)), report, String(payload.now)),
          undefined,
          String(payload.rd_state_db),
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

test("rd supervisor runner writes a draft strategy after a validated campaign candidate", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-supervisor-draft-"))
  try {
    const dbPath = join(dir, "rd_state.db")
    const stateRef = rdProgramRef("rd-draft")
    const catalogDb = join(dir, "catalog.db")
    const strategyRoot = join(dir, "strategies")
    writeRdProgramState(stateRef, createRdProgramState({
      programId: "rd-draft",
      objective: "validate a 1h candidate before landing a strategy draft",
      now: "2026-07-09T12:00:00Z",
      budget: { max_hypotheses: 3, max_trials_total: 12, max_locked_holdout_uses: 2 },
      nextHypothesisQueue: [{
        hypothesis_id: "h1",
        mode: "campaign",
        hypothesis: "validated pullback continuation survives locked holdout",
        discovery_manifest_path: "data/discovery/manifest.json",
        validation_manifest_path: "data/validation/manifest.json",
        thesis_certificate: {
          causal_claim: "entry waits for post-impulse pullback instead of chasing continuation",
          falsifiable_prediction: "external validation remains positive after cost and negative controls",
          negative_controls: ["side_flip", "entry_lag"],
        },
        candidates: [{
          candidate_id: "Candidate Validated",
          family: "trend_pullback_v1",
          params: {
            side: "long",
            stop_atr: 0.8,
            max_risk_atr: 1.6,
            reward_risk: 2.4,
            max_hold_bars: 18,
          },
        }],
      }],
    }), undefined, dbPath)

    const result = runRdSupervisorLoopWithDeps({
      path: stateRef,
      dbPath,
      catalogDbPath: catalogDb,
      input: { now: "2026-07-09T13:00:00Z", max_iterations: 5, strategy_root: strategyRoot },
    }, {
      runLoop: () => {
        throw new Error("loop should not run")
      },
      runCampaign: (payload) => {
        const report = {
          campaign_id: String(payload.campaign_id),
          created_at: String(payload.now),
          artifact_ref: join(dir, "campaign.json"),
          dossier_ref: join(dir, "campaign.dossier.md"),
          outcome: "validated_candidate_found",
          stop_reason: "validated_candidate_found",
          trials_used: 1,
          hypotheses_run: 1,
          validation_evaluations: 1,
          holdout_evaluations: 0,
          validated_candidate: {
            candidate_id: "Candidate Validated",
            family: "trend_pullback_v1",
            parameter_count: 1,
            params: {
              side: "long",
              stop_atr: 0.8,
              max_risk_atr: 1.6,
              reward_risk: 2.4,
              max_hold_bars: 18,
            },
            validation_run_ref: "tmp/artifacts/strategy-rnd/candidate-validation.json",
          },
          runs: [{
            hypothesis_id: "h1",
            discovery_run_ref: "tmp/artifacts/strategy-rnd/candidate-discovery.json",
            validation_run_ref: "tmp/artifacts/strategy-rnd/candidate-validation.json",
          }],
        }
        writeRdProgramState(
          String(payload.rd_program_ref),
          updateRdProgramStateFromResearchResult(readRdProgramState(String(payload.rd_program_ref), String(payload.rd_state_db)), report, String(payload.now)),
          undefined,
          String(payload.rd_state_db),
        )
        return report
      },
    })

    assertSchemaRequired(readSchema("rd-supervisor-run-result"), result as unknown as JSONRecord)
    assert.equal(result.status, "strategy_draft_created")
    assert.match(result.strategy_ref || "", /s-candidate-validated\.md$/)
    assert.equal(existsSync(resolveRepoPath(result.strategy_ref || "")), true)
    const draft = readFileSync(resolveRepoPath(result.strategy_ref || ""), "utf8")
    assert.match(draft, /## Why This Edge/)
    assert.match(draft, /## Research Decision/)
    assert.match(draft, /## Required Inputs/)
    assert.match(draft, /## Signal Stack/)
    assert.match(draft, /## No-Trade Checklist/)
    assert.match(draft, /timeframe: 1h/)
    assert.match(draft, /family: trend_pullback_v1/)
    assert.match(draft, /target_action: place_entry \| no_action/)
    const lint = lintStrategyContract(resolveRepoPath(result.strategy_ref || ""))
    assert.equal(lint.valid, true, lint.errors.join("; "))
    assert.equal(result.final_state.status, "shadow_candidate_found")
    assert.equal(asRecord(result.final_state.latest_reliability_gate).strategy_ref, result.strategy_ref)
    assert.ok(result.final_state.artifact_refs.includes(result.strategy_ref || ""))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd supervisor runner consumes hypothesis-factory follow-up in the next iteration", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-supervisor-factory-"))
  try {
    const dbPath = join(dir, "rd_state.db")
    const stateRef = rdProgramRef("rd-factory-loop")
    const catalogDb = join(dir, "catalog.db")
    writeRdProgramState(stateRef, createRdProgramState({
      programId: "rd-factory-loop",
      objective: "revise failed campaign hypotheses without manual queue edits",
      now: "2026-07-09T12:00:00Z",
      budget: { max_hypotheses: 3, max_trials_total: 4, max_locked_holdout_uses: 1 },
      nextHypothesisQueue: [{
        hypothesis_id: "h1",
        mode: "campaign",
        hypothesis: "structure retest survives costs",
        discovery_manifest_path: "data/discovery/manifest.json",
        validation_manifest_path: "data/validation/manifest.json",
        timeframe: "1h",
        artifact_root: "tmp/artifacts/rd-factory-loop",
        catalog_db_path: catalogDb,
        search_trial_count: 2,
        hypothesis_factory: { enabled: true, trials_per_iteration: 2 },
        thesis_certificate: {
          edge_type: "structure_retest",
          behavioral_hypothesis: "stops cluster near failed retests",
          market_participants: "breakout and mean reversion traders",
          regime: "liquid futures",
          invalidation: "cost stress or OOS failure",
          cost_sensitivity: "avoid churn",
          candidate_universe: { symbols: ["BTCUSDT"] },
          negative_controls: ["side_flip", "entry_lag_3"],
        },
        candidates: [
          { candidate_id: "C-LONG", family: "structure_breakout_retest_v1", params: { side: "long", lookback_bars: 30, retest_tolerance_atr: 0.8, stop_atr: 1, reward_risk: 1.8 } },
          { candidate_id: "C-SHORT", family: "structure_breakout_retest_v1", params: { side: "short", lookback_bars: 30, retest_tolerance_atr: 0.8, stop_atr: 1, reward_risk: 1.8 } },
        ],
      }],
    }), undefined, dbPath)

    let campaignCalls = 0
    let loopCalls = 0
    const result = runRdSupervisorLoopWithDeps({
      path: stateRef,
      dbPath,
      catalogDbPath: catalogDb,
      input: { now: "2026-07-09T13:00:00Z", max_iterations: 5 },
    }, {
      runCampaign: (payload) => {
        campaignCalls += 1
        const report = {
          campaign_id: String(payload.campaign_id),
          created_at: String(payload.now),
          artifact_ref: join(dir, "campaign.json"),
          dossier_ref: join(dir, "campaign.dossier.md"),
          outcome: "no_validated_candidate",
          stop_reason: "hypothesis_queue_exhausted",
          trials_used: 2,
          hypotheses_run: 1,
          validation_evaluations: 0,
          holdout_evaluations: 0,
          validated_candidate: null,
          runs: [{
            hypothesis_id: "h1",
            discovery_run_ref: "tmp/discovery.json",
            discovery_outcome: "no_promote",
            discovery_failure_summary: {
              primary_failure_area: "selection_instability",
              top_blockers: [{ check_id: "RND-ROBUSTNESS-COST", count: 2 }],
              next_system_actions: ["Stop candidate selection; expand independent validation or reduce hypothesis overlap before more trials."],
            },
            discovery_reliability_gate: { status: "blocked", decision: "stop_selection" },
            validation_run_ref: null,
            validation_outcome: null,
          }],
        }
        writeRdProgramState(
          String(payload.rd_program_ref),
          updateRdProgramStateFromResearchResult(readRdProgramState(String(payload.rd_program_ref), String(payload.rd_state_db)), report, String(payload.now)),
          undefined,
          String(payload.rd_state_db),
        )
        return report
      },
      runLoop: (payload) => {
        loopCalls += 1
        assert.match(String(payload.hypothesis_id), /h1-stable-revision/)
        assert.equal(String(payload.mode || "loop"), "loop")
        assert.equal(payload.artifact_root, "tmp/artifacts/rd-factory-loop")
        assert.equal(payload.catalog_db_path, catalogDb)
        assert.equal(asArray(payload.candidates).length, 2)
        const report = {
          run_id: String(payload.run_id),
          created_at: String(payload.now),
          artifact_ref: join(dir, "factory-loop.json"),
          batch: {
            batch_id: String(payload.batch_id),
            hypothesis: String(payload.hypothesis),
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
        }
        writeRdProgramState(
          String(payload.rd_program_ref),
          updateRdProgramStateFromResearchResult(readRdProgramState(String(payload.rd_program_ref), String(payload.rd_state_db)), report, String(payload.now)),
          undefined,
          String(payload.rd_state_db),
        )
        return report
      },
    })

    assert.equal(campaignCalls, 1)
    assert.equal(loopCalls, 1)
    assert.equal(result.iterations.length, 2)
    assert.equal(result.iterations[0]?.command, "research.rd-campaign-runner")
    assert.equal(result.iterations[1]?.command, "research.rd-loop-runner")
    assert.equal(result.status, "budget_exhausted")
    assert.equal(result.final_state.usage.trials_used, 4)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd supervisor runner marks empty active queue as data/tool blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-supervisor-empty-"))
  try {
    const dbPath = join(dir, "rd_state.db")
    const stateRef = rdProgramRef("rd-empty")
    writeRdProgramState(stateRef, createRdProgramState({
      programId: "rd-empty",
      objective: "needs a runnable queue",
      now: "2026-07-09T12:00:00Z",
    }), undefined, dbPath)

    const result = runRdSupervisorLoopWithDeps({
      path: stateRef,
      dbPath,
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
    const iterationSeed = asRecord(result.iterations[0]?.queue_seed_recommendation)
    assert.equal(iterationSeed.family_id, "marketability_score_v1")
    const writtenSeed = asRecord(asRecord(result.final_state.latest_failure_summary).queue_seed_recommendation)
    assert.equal(writtenSeed.required_action, "universe_gate_run")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function readSchema(name: string): JSONRecord {
  if (name === "rd-supervisor-run-result") {
    return JSON.parse(readFileSync(new URL("../../../rd-supervisor/src/schemas/rd-supervisor-run-result.schema.json", import.meta.url), "utf8")) as JSONRecord
  }
  return JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), "utf8")) as JSONRecord
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

function rdProgramRef(programId: string): string {
  return `research_state_store:rd_program/${programId}`
}
