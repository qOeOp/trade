import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loader } from "./load.mjs";

// The tooltip's content rendered beside its trigger, so the markup shows what a hover would.
const { VersionLine } = await loader({ stubs: {
  "icons/Icon": { Icon: ({ name }) => createElement("svg", { "data-icon": name }) },
  "ui/Tip": { Tip: ({ content, children }) => createElement(Fragment, null, children, createElement("output", null, content)) },
} }).namespace("widgets/VersionLine.tsx");

// A lineage node as ide/research_graph emits it (layout.py, the lineage widget's nodes).
const node = (prediction, failed_predictions) => ({ id: "rsi@3", row: 0, x: 2, status: "below_targets", role: "superseded",
  change: null, prediction, failed_predictions, trials: [2], reading: { annual_return: 0.1, max_drawdown: 0.2 } });
const targets = { max_drawdown: 0.15, annual_return: 0.2 };
const line = (n) => renderToStaticMarkup(createElement(VersionLine, { node: n, targets }));

test("each prediction mark says what it means", () => {
  assert.match(line(node("held", [])), /aria-label="Predictions held".*<output>Predictions held<\/output>/);
  assert.match(line(node("failed", ["max_drawdown"])), /aria-label="Predictions failed".*<output>Predictions failed<\/output>/);
  assert.doesNotMatch(line(node("none", [])), /Predictions|<output>/);
});

test("a partly held mark names the measures whose predictions failed", () => {
  const html = line(node("mixed", ["max_drawdown", "sharpe"]));
  assert.match(html, /aria-label="Predictions partly held\. Failed: Maximum drawdown, Sharpe"/);
  assert.match(html, /<output>Predictions partly held<br\/>Failed: Maximum drawdown, Sharpe<\/output>/);
});
