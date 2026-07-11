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
import { runRdSupervisorLoopWithDeps } from "./rd-supervisor-runner"
import { resolveRepoPath } from "./paths"
import { lintStrategyContract } from "./strategy-contract"
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

test("rd supervisor runner writes a draft strategy after a validated campaign candidate", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-supervisor-draft-"))
  try {
    const path = join(dir, "state.json")
    const catalogDb = join(dir, "catalog.db")
    const strategyRoot = join(dir, "strategies")
    writeRdProgramState(path, createRdProgramState({
      programId: "rd-draft",
      objective: "validate a candidate before landing a strategy draft",
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
          falsifiable_prediction: "locked validation remains positive after cost and negative controls",
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
    }), catalogDb)

    const result = runRdSupervisorLoopWithDeps({
      path,
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
          outcome: "validated_candidate_found",
          stop_reason: "validated_candidate_found",
          trials_used: 1,
          hypotheses_run: 1,
          holdout_evaluations: 1,
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
          String(payload.rd_program_state_path),
          updateRdProgramStateFromResearchResult(readRdProgramState(String(payload.rd_program_state_path)), report, String(payload.now)),
          catalogDb,
        )
        return report
      },
    })

    assertSchemaRequired(readSchema("rd-supervisor-run-result"), result as unknown as JSONRecord)
    assert.equal(result.status, "strategy_draft_created")
    assert.match(result.strategy_ref || "", /s-candidate-validated\.md$/)
    assert.equal(existsSync(resolveRepoPath(result.strategy_ref || "")), true)
    const lint = lintStrategyContract(resolveRepoPath(result.strategy_ref || ""))
    assert.equal(lint.valid, true, lint.errors.join("; "))
    assert.equal(result.final_state.status, "shadow_candidate_found")
    assert.equal(asRecord(result.final_state.latest_reliability_gate).strategy_ref, result.strategy_ref)
    assert.ok(result.final_state.artifact_refs.includes(result.strategy_ref || ""))
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
    const iterationSeed = asRecord(result.iterations[0]?.queue_seed_recommendation)
    assert.equal(iterationSeed.family_id, "marketability_score_v1")
    const writtenSeed = asRecord(asRecord(result.final_state.latest_failure_summary).queue_seed_recommendation)
    assert.equal(writtenSeed.required_action, "universe_gate_run")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function readSchema(name: string): JSONRecord {
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
