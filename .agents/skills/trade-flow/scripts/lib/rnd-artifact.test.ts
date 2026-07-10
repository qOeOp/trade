import assert from "node:assert/strict"
import test from "node:test"

import { summarizeRndArtifact, summarizeStrategyPanelRnd, summarizeStrategyRndLoop, unwrapScriptData } from "./rnd-artifact"

test("R&D artifact helpers unwrap script response envelopes", () => {
  assert.deepEqual(unwrapScriptData({ ok: true, data: { outcome: "candidate_found" } }), { outcome: "candidate_found" })
  assert.deepEqual(unwrapScriptData({ outcome: "candidate_found" }), { outcome: "candidate_found" })
})

test("panel summary handles wrapped and missing blocker fields", () => {
  const summary = summarizeStrategyPanelRnd({
    ok: true,
    data: {
      outcome: "no_promote",
      diagnostic_mode: false,
      trial_count: 1,
      candidates: [{
        candidate_id: "C-1",
        pooled: { total_r: 1 },
        gate: { blocked_by: [{ check_id: "PANEL-OOS" }] },
      }, {
        candidate_id: "C-2",
        pooled: { total_r: 2 },
      }],
    },
  })

  assert.equal(summary.outcome, "no_promote")
  assert.deepEqual(summary.candidates, [
    { candidate_id: "C-1", pooled: { total_r: 1 }, blocked_by: ["PANEL-OOS"] },
    { candidate_id: "C-2", pooled: { total_r: 2 }, blocked_by: [] },
  ])
})

test("R&D loop summary exposes batch failure context", () => {
  const artifact = {
    run_id: "run-1",
    batch: {
      outcome: "no_promote",
      trial_count: 1,
      accepted_count: 0,
      candidate_source: "provided",
      failure_summary: {
        top_blockers: [{ check_id: "R-EXPECTANCY", count: 1 }],
      },
      reliability_gate: {
        status: "blocked",
        decision: "reject_hypothesis",
      },
      candidates: [{
        candidate_id: "C-1",
        replay: {
          sample_count: 20,
          avg_r: -0.1,
          total_r: -2,
          profit_factor: 0.8,
          assumptions: {
            anti_overfit: {
              oos_stats: {
                sample_count: 6,
                avg_r: -0.2,
              },
            },
          },
        },
        gate: {
          blocked_by: [{ check_id: "R-EXPECTANCY" }],
        },
      }],
    },
  }

  assert.deepEqual(summarizeStrategyRndLoop(artifact), {
    artifact_kind: "strategy_rnd_loop",
    run_id: "run-1",
    outcome: "no_promote",
    trial_count: 1,
    accepted_count: 0,
    candidate_source: "provided",
    failure_summary: {
      top_blockers: [{ check_id: "R-EXPECTANCY", count: 1 }],
    },
    reliability_gate: {
      status: "blocked",
      decision: "reject_hypothesis",
    },
    candidates: [{
      candidate_id: "C-1",
      sample_count: 20,
      avg_r: -0.1,
      total_r: -2,
      profit_factor: 0.8,
      oos_sample_count: 6,
      oos_avg_r: -0.2,
      blocked_by: ["R-EXPECTANCY"],
    }],
  })
  assert.equal(summarizeRndArtifact(artifact).artifact_kind, "strategy_rnd_loop")
})
