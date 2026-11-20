import assert from "node:assert/strict";
import { test } from "node:test";
import { loader } from "./load.mjs";

const { namespace } = loader();
const { compactLineage } = await namespace("model/lineageTree.ts");

// Nodes as ide/research_graph/layout.py emits them.
const node = (id, row, x, role, status, reading = { annual_return: null, max_drawdown: null }) =>
  ({ id, row, x, status, role, change: null, prediction: "none", trials: [], reading });
const lineage = (nodes, edges, trail = []) => ({
  type: "lineage", axis: { max: 8, scope_start: null }, targets: { max_drawdown: 0.15, annual_return: 0.2 },
  rows: nodes.map((n) => ({ id: n.id, row: n.row })), nodes, edges, revisions: [], trials: [], decisions: [], trail,
});

const chain = () => lineage(
  [
    node("s@1", 0, 1, "superseded", "below_targets", { annual_return: 0.1, max_drawdown: 0.05 }),
    node("s@2", 1, 2, "precheck_failed", "precheck_failed"),
    node("s@3", 2, 3, "recommended", "recommended", { annual_return: 0.25, max_drawdown: 0.08 }),
    node("s@4", 3, null, "unrun", "unrun"),
  ],
  [{ from: "s@1", to: "s@2" }, { from: "s@2", to: "s@3" }, { from: "s@3", to: "s@4" }],
  [{ candidate: "s@3", x0: 3, judgments: [3] }],
);

test("folds unpassed versions into bars, links across them and keeps every version on its trial", () => {
  const { widget, foldBars, hiddenCount } = compactLineage(chain(), "core");
  assert.equal(hiddenCount, 2);
  assert.deepEqual(widget.nodes.map((n) => [n.id, n.row, n.x]), [["s@1", 0, 1], ["s@3", 2, 3]]);
  assert.deepEqual(foldBars.map((f) => [f.id, f.parentId, f.row, f.expanded]), [["fold:s@2", "s@1", 1, false], ["fold:s@4", "s@3", 3, false]]);
  assert.deepEqual(widget.edges, [{ from: "s@1", to: "s@3" }]);
});

test("a selected folded version opens its fold; all mode returns the lineage unchanged", () => {
  const raw = chain();
  assert.deepEqual(compactLineage(raw, "core", "s@2").widget.nodes.map((n) => n.id), ["s@1", "s@2", "s@3"]);
  const all = compactLineage(raw, "all");
  assert.equal(all.widget, raw);
  assert.equal(all.counts.all - all.counts.core, 2);
});

test("independent roots stay roots: no edge the lineage does not have", () => {
  const raw = lineage(
    [
      node("a@1", 0, 1, "superseded", "meets_targets", { annual_return: 0.3, max_drawdown: 0.1 }),
      node("a@2", 1, 2, "precheck_failed", "precheck_failed"),
      node("b@1", 2, 3, "superseded", "meets_targets", { annual_return: 0.22, max_drawdown: 0.12 }),
      node("c@1", 3, 4, "unrun", "unrun"),
      node("c@2", 4, 5, "superseded", "meets_targets", { annual_return: 0.21, max_drawdown: 0.1 }),
    ],
    [{ from: "a@1", to: "a@2" }, { from: "c@1", to: "c@2" }],
  );
  const { widget, foldBars } = compactLineage(raw, "core");
  assert.deepEqual(widget.nodes.map((n) => n.id), ["a@1", "b@1", "c@2"]);
  assert.deepEqual(widget.edges, [], "b@1 and c@2 have no kept ancestor");
  assert.deepEqual(foldBars.map((f) => [f.id, f.parentId]), [["fold:a@2", "a@1"], ["fold:c@1", null]]);
  const open = compactLineage(raw, "core", null, new Set(["fold:c@1"]));
  assert.deepEqual(open.widget.edges, [{ from: "c@1", to: "c@2" }]);
});
