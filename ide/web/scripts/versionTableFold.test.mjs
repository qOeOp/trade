import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loader } from "./load.mjs";

// The lineage's fold as useFolded gives it: the ids compactLineage leaves out, and whether anything is foldable.
let folded = new Set(), foldable = true;
const runs = [];
const { VersionTable, VersionTableTools } = await loader({ stubs: {
  "widgets/useFolded": { useFolded: () => folded, useFoldable: () => foldable, fold: () => runs.push("fold"), unfold: () => runs.push("unfold") },
  "widgets/runs/VersionMenu": { VersionMenu: ({ children }) => children },
  "icons/marks": { RoleMark: () => null, PredictionMark: () => null },
  "icons/Icon": { Icon: () => null },
  "state/selection": { useSelection: () => null, select: () => {} },
  "state/linking": { requestFocus: () => {}, hoverProps: () => ({}) },
} }).namespace("widgets/VersionTable.tsx");

// Rows as ide/research_graph emits the table widget.
const row = (id, parent, status, role, first_trial) => ({ id, parent, status, role, prediction: "none", first_trial, runs: first_trial ? 1 : 0,
  annual_return: null, max_drawdown: null, sharpe: null, plan_win_rate: null });
const widget = { type: "table", targets: { max_drawdown: 0.15, annual_return: 0.2 }, rows: [
  row("rsi@2", null, "below_targets", "superseded", 1), row("rsi@3", "rsi@2", "recommended", "recommended", 2),
  row("rsi@4", "rsi@2", "precheck_failed", "precheck_failed", null), row("rsi@5", "rsi@2", "unrun", "unrun", null),
] };

test("the table leaves out the versions the lineage folds and says how many in its header", () => {
  folded = new Set(["rsi@4", "rsi@5"]);
  const table = renderToStaticMarkup(createElement(VersionTable, { widget }));
  assert.match(table, /rsi@2/);
  assert.match(table, /rsi@3/);
  assert.doesNotMatch(table, /rsi@4|rsi@5/);
  assert.match(renderToStaticMarkup(createElement(VersionTableTools)), /2 hidden.*Expand all/);
});

test("with the fold open the header folds again, and says nothing when there is nothing to fold", () => {
  folded = new Set();
  assert.match(renderToStaticMarkup(createElement(VersionTable, { widget })), /rsi@5/);
  assert.match(renderToStaticMarkup(createElement(VersionTableTools)), /Fold unpassed/);
  foldable = false;
  assert.equal(renderToStaticMarkup(createElement(VersionTableTools)), "");
});
