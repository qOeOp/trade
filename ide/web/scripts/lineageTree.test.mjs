import assert from "node:assert/strict";
import { test } from "node:test";
import { loader } from "./load.mjs";

const { namespace } = loader();
const { compactLineage, compactProgress, compactScatter } = await namespace("model/lineageTree.ts");

const sampleLineage = () => ({
  axis: { min: 1, max: 6, scope_start: 2 },
  targets: { max_drawdown: 0.15, annual_return: 0.2 },
  rows: [
    { id: "strat@1", row: 0 },
    { id: "strat@2", row: 1 },
    { id: "strat@3", row: 2 },
    { id: "strat@4", row: 3 },
  ],
  nodes: [
    { id: "strat@1", row: 0, x: 1, role: "superseded", prediction: "held", reading: { return: 0.1, drawdown: 0.05 }, change: null },
    { id: "strat@2", row: 1, x: 2, role: "precheck_failed", prediction: "none", reading: null, change: null },
    { id: "strat@3", row: 2, x: 3, role: "recommended", prediction: "held", reading: { return: 0.25, drawdown: 0.08 }, change: null },
    { id: "strat@4", row: 3, x: null, role: "unrun", prediction: "none", reading: null, change: null },
  ],
  edges: [
    { from: "strat@1", to: "strat@2" },
    { from: "strat@2", to: "strat@3" },
    { from: "strat@3", to: "strat@4" },
  ],
  revisions: [],
  trials: [
    { x: 1, trial_id: 10, candidate: "strat@1", purpose: "exploration" },
    { x: 2, trial_id: 11, candidate: "strat@2", purpose: "precheck" },
    { x: 3, trial_id: 12, candidate: "strat@3", purpose: "exploration" },
  ],
  decisions: [{ x: 2.5, kind: "approach_change", ref: "strat@3", at: "2026-11-16T00:00:00Z", text: "Change of approach. Switch signal." }],
  trail: [{ candidate: "strat@3", x0: 3, judgments: [3] }],
});

test("compactLineage folds precheck_failed and unrun versions, reconnects ancestors, and compacts rows and trials", () => {
  const raw = sampleLineage();
  const compacted = compactLineage(raw, "core", "strat@3");
  const { widget, hiddenCount, foldedByParent } = compacted;
  assert.equal(hiddenCount, 2);
  assert.deepEqual(widget.nodes.map((n) => [n.id, n.row, n.x]), [
    ["strat@1", 0, 1],
    ["strat@3", 2, 2],
  ]);
  assert.deepEqual(compacted.foldBars.map((f) => [f.id, f.row, f.expanded]), [
    ["fold:strat@2", 1, false],
    ["fold:strat@4", 3, false],
  ]);
  assert.deepEqual(widget.edges, [{ from: "strat@1", to: "strat@3" }], "strat@3 reconnects across folded strat@2 to strat@1");
  assert.deepEqual(foldedByParent.get("strat@1"), ["strat@2"]);
  assert.deepEqual(foldedByParent.get("strat@3"), ["strat@4"]);
  assert.deepEqual(widget.trials.map((t) => [t.trial_id, t.x]), [
    [10, 1],
    [12, 2],
  ]);
  assert.equal(widget.decisions[0].x, 1.5);

  const progress = compactProgress(
    { axis: { scope_start: 2 }, targets: raw.targets, recommended: ["strat@3"], points: [{ x: 1, trial_id: 10, id: "strat@1", annual_return: 0.1, max_drawdown: 0.05 }, { x: 3, trial_id: 12, id: "strat@3", annual_return: 0.25, max_drawdown: 0.08 }] },
    compacted,
  );
  assert.deepEqual(progress.points.map((p) => p.x), [1, 2]);
  const scatter = compactScatter(
    { targets: raw.targets, points: [{ id: "strat@1", trial_id: 10, annual_return: 0.1, max_drawdown: 0.05 }, { id: "strat@2", trial_id: 11, annual_return: -0.2, max_drawdown: 0.4 }, { id: "strat@3", trial_id: 12, annual_return: 0.25, max_drawdown: 0.08 }] },
    compacted,
  );
  assert.deepEqual(scatter.points.map((p) => p.id), ["strat@1", "strat@3"]);
});

test("compactLineage keeps a selected failed node visible and returns raw widget when compact is false", () => {
  const raw = sampleLineage();
  const withSelectedFailed = compactLineage(raw, true, "strat@2");
  assert.equal(withSelectedFailed.hiddenCount, 1);
  assert.deepEqual(withSelectedFailed.widget.nodes.map((n) => n.id), ["strat@1", "strat@2", "strat@3"]);

  const expanded = compactLineage(raw, false, "strat@3");
  assert.equal(expanded.widget, raw);
  assert.equal(expanded.counts.all - expanded.counts.core, 2);
});
