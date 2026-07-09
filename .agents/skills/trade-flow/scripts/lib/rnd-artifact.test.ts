import assert from "node:assert/strict"
import test from "node:test"

import { summarizeStrategyPanelRnd, unwrapScriptData } from "./rnd-artifact"

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
