import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import {
  BACKTEST_RUN_REPORT_IDENTITY_MISMATCH,
  BACKTEST_RUN_REPORT_KEYS_MISSING,
  INVALID_BACKTEST_RUN_REPORT_PROJECTION,
  normalizeBacktestRunReport,
} from "../lib/backtest-run-report-contract.ts";

const RUN = "backtest-result-7";

const LOCATOR = {
  result_identity: RUN,
  request_identity: "exploratory-replay-request-7",
  attempt_identity: "attempt-1",
};

const run = {
  ...LOCATOR,
  engine_result_digest: `blake3:${"a".repeat(64)}`,
};

const strategy = {
  family: "SINGLE_THRESHOLD_V1",
  channel: {
    role_semantic_id: "research.input.close.daily.v1",
    instrument: "AAPL",
    field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1",
    timeframe: "1D",
    unit: "PRICE",
    scale: 2,
  },
  threshold: "100.00",
  comparison: "GREATER",
  when_true: {
    position_intent_semantic_id: "kernel.position.enter.v1",
    target_variant_semantic_id: "kernel.target.position.v1",
    target_position_units: 1,
  },
  otherwise: {
    position_intent_semantic_id: "kernel.position.exit.v1",
    target_variant_semantic_id: "kernel.target.position.v1",
    target_position_units: 0,
  },
  falsifier: "the channel never crosses the threshold in the admitted window",
};

const dataWindow = {
  instrument: "AAPL",
  granularity: "1D",
  start: "2025-01-01T00:00:00.000000000Z",
  end_exclusive: "2025-01-04T00:00:00.000000000Z",
  snapshot_count: 1,
  cut_identity: `sha256:${"c".repeat(64)}`,
};

const fills = [
  { at: "2025-01-02T14:30:00.000000000Z", side: "BUY", price: "187.25", quantity: "2.0" },
  { at: "2025-01-02T20:00:00.000000000Z", side: "SELL", price: "188", quantity: "2" },
];

const available = {
  state: "AVAILABLE",
  run,
  strategy,
  data_window: dataWindow,
  series: [
    { at: "2025-01-01T00:00:00.000000000Z", value: 0.0004 },
    { at: "2025-01-02T00:00:00.000000000Z", value: 0.00105 },
    { at: "2025-01-03T00:00:00.000000000Z", value: -0.00345 },
  ],
  net_return: -0.002,
  max_drawdown: -0.00647,
  fill_count: 2,
  fills,
};

// A run can open and close a position between two equity snapshots, so it can list fills while
// having no observation points. Its fills are facts; it is empty only in the series.
const emptyWithFills = {
  ...available,
  state: "EMPTY",
  series: [],
  net_return: null,
  max_drawdown: null,
};

// The route's envelope around the Owner's refusal code: the reason and nothing else.
const unavailable = { state: "UNAVAILABLE", reason: "OUTCOME_EVIDENCE_UNAVAILABLE" };

const invalid = { state: "unavailable", reason: INVALID_BACKTEST_RUN_REPORT_PROJECTION };

function without(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

test("the three wire states normalize to the report's own states", () => {
  const report = normalizeBacktestRunReport(available, LOCATOR);
  assert.equal(report.state, "available");
  assert.equal(report.net_return, -0.002);
  assert.equal(report.series.length, 3);

  assert.deepEqual(normalizeBacktestRunReport(unavailable, LOCATOR), {
    state: "unavailable",
    reason: "OUTCOME_EVIDENCE_UNAVAILABLE",
  });
});

test("empty means no points, and still lists the run's fills", () => {
  const report = normalizeBacktestRunReport(emptyWithFills, LOCATOR);
  assert.equal(report.state, "empty");
  assert.deepEqual(report.series, []);
  assert.equal(report.net_return, null);
  assert.equal(report.max_drawdown, null);
  assert.equal(report.fills.length, 2);
});

test("the state is stated, and must agree with the result", () => {
  for (const contradiction of [
    { ...emptyWithFills, series: available.series },
    { ...emptyWithFills, net_return: 0.01 },
    { ...emptyWithFills, max_drawdown: -0.01 },
    { ...available, series: [] },
    { ...available, net_return: null },
    { ...available, max_drawdown: null },
    { ...available, state: "available" },
    { ...available, state: "PARTIAL" },
    { ...available, state: undefined },
  ]) {
    assert.deepEqual(normalizeBacktestRunReport(contradiction, LOCATOR), invalid);
  }
});

test("a missing or renamed key is a fault, never a legitimately absent value", () => {
  const renamed = { ...without(available, "net_return"), netReturn: available.net_return };
  // Missing at the top level is still a fault; it is only named (see the test below).
  for (const missing of [without(available, "net_return"), without(emptyWithFills, "max_drawdown")]) {
    assert.equal(normalizeBacktestRunReport(missing, LOCATOR).state, "unavailable");
  }
  for (const faulty of [
    renamed,
    { ...available, stats: { sharpe: 1.2 } },
    { ...available, strategy: without(strategy, "falsifier") },
    { ...available, data_window: without(dataWindow, "cut_identity") },
    { ...available, run: { ...run, extra: "x" } },
    { ...available, run: without(run, "engine_result_digest") },
    { ...without(available, "run"), run: without(run, "engine_result_digest"), engine_result_digest: run.engine_result_digest },
    { ...available, run: { ...run, engine_result_digest: `sha256:${"a".repeat(64)}` } },
    { ...available, run: { ...run, engine_result_digest: `blake3:${"A".repeat(64)}` } },
  ]) {
    assert.deepEqual(normalizeBacktestRunReport(faulty, LOCATOR), invalid);
  }
});

test("a response for another run is refused under its own reason", () => {
  for (const key of Object.keys(LOCATOR)) {
    assert.deepEqual(normalizeBacktestRunReport(available, { ...LOCATOR, [key]: "another-run" }), {
      state: "unavailable",
      reason: BACKTEST_RUN_REPORT_IDENTITY_MISMATCH,
    }, key);
  }
});

test("an unavailable projection carries its reason and no positive fact", () => {
  for (const faulty of [
    { ...unavailable, reason: "" },
    { ...unavailable, reason: null },
    { ...unavailable, run },
    { ...unavailable, series: available.series },
    { ...unavailable, fills },
    { ...unavailable, fill_count: 0 },
    { ...unavailable, run: null, series: [], fills: [] },
  ]) {
    assert.deepEqual(normalizeBacktestRunReport(faulty, LOCATOR), invalid);
  }
  assert.deepEqual(normalizeBacktestRunReport({ ...available, reason: "SHOULD_NOT_BE_HERE" }, LOCATOR), invalid);
});

test("time is canonical UTC everywhere it appears, and the series is strictly ordered", () => {
  const millisecond = "2025-01-01T00:00:00.000Z";
  for (const faulty of [
    { ...available, series: [{ ...available.series[0], at: millisecond }, ...available.series.slice(1)] },
    { ...available, fills: [{ ...fills[0], at: millisecond }, fills[1]] },
    { ...available, data_window: { ...dataWindow, start: millisecond } },
    { ...available, data_window: { ...dataWindow, start: dataWindow.end_exclusive, end_exclusive: dataWindow.start } },
    { ...available, data_window: { ...dataWindow, end_exclusive: dataWindow.start } },
    { ...available, series: [available.series[1], available.series[0], available.series[2]] },
    { ...available, series: [available.series[0], available.series[0]] },
  ]) {
    assert.deepEqual(normalizeBacktestRunReport(faulty, LOCATOR), invalid);
  }

  const oneNanosecondApart = {
    ...available,
    series: [
      { at: "2025-01-01T00:00:00.000000001Z", value: 1 },
      { at: "2025-01-01T00:00:00.000000002Z", value: 2 },
    ],
  };
  assert.equal(normalizeBacktestRunReport(oneNanosecondApart, LOCATOR).state, "available");
});

test("every number is finite and every count agrees with what it counts", () => {
  for (const faulty of [
    { ...available, net_return: Number.NaN },
    { ...available, max_drawdown: Number.POSITIVE_INFINITY },
    { ...available, series: [{ ...available.series[0], value: Number.NaN }] },
    { ...available, fill_count: 3 },
    { ...available, data_window: { ...dataWindow, snapshot_count: -1 } },
    { ...available, data_window: { ...dataWindow, snapshot_count: 1.5 } },
    { ...available, data_window: { ...dataWindow, snapshot_count: 0 } },
    { ...available, data_window: { ...dataWindow, cut_identity: "cut-2025-01-03" } },
  ]) {
    assert.deepEqual(normalizeBacktestRunReport(faulty, LOCATOR), invalid);
  }
});

test("prices and quantities are plain decimals, and are kept exactly as given", () => {
  const report = normalizeBacktestRunReport(available, LOCATOR);
  assert.equal(report.fills[0].quantity, "2.0");
  assert.equal(report.fills[1].quantity, "2");
  assert.equal(report.fills[1].price, "188");

  const negativePrice = { ...available, fills: [{ ...fills[0], price: "-1.50" }, fills[1]] };
  assert.equal(normalizeBacktestRunReport(negativePrice, LOCATOR).fills[0].price, "-1.50");

  for (const [field, text] of [
    ["quantity", "-2"],
    ["quantity", "+2"],
    ["price", "1e3"],
    ["price", "+187.25"],
    ["price", "1,000.00"],
    ["price", "187."],
    ["price", ".25"],
    ["price", 187.25],
  ]) {
    const faulty = { ...available, fills: [{ ...fills[0], [field]: text }, fills[1]] };
    assert.deepEqual(normalizeBacktestRunReport(faulty, LOCATOR), invalid, `${field}=${text}`);
  }
  assert.deepEqual(normalizeBacktestRunReport({ ...available, fills: [{ ...fills[0], side: "SHORT" }, fills[1]] }, LOCATOR), invalid);
});

test("a projection missing only required keys is refused under a reason that names them", () => {
  // The Owner's result-only projection: a statement it has not delivered yet is not a malformed one.
  const resultOnly = without(without(available, "strategy"), "data_window");
  assert.deepEqual(normalizeBacktestRunReport(resultOnly, LOCATOR), {
    state: "unavailable",
    reason: `${BACKTEST_RUN_REPORT_KEYS_MISSING}: data_window, strategy`,
  });
  assert.deepEqual(normalizeBacktestRunReport(without(emptyWithFills, "net_return"), LOCATOR), {
    state: "unavailable",
    reason: `${BACKTEST_RUN_REPORT_KEYS_MISSING}: net_return`,
  });
  // A key the contract does not know is a malformed projection, whatever else is missing.
  assert.deepEqual(normalizeBacktestRunReport({ ...resultOnly, stats: {} }, LOCATOR), invalid);
  assert.deepEqual(
    normalizeBacktestRunReport({ ...without(available, "strategy"), strategy_v2: strategy }, LOCATOR),
    invalid,
  );
});

test("the threshold is stated at exactly the channel's scale", () => {
  const at = (threshold, scale) => normalizeBacktestRunReport({
    ...available,
    strategy: { ...strategy, threshold, channel: { ...strategy.channel, scale } },
  }, LOCATOR).state;
  assert.equal(at("100.00", 2), "available");
  assert.equal(at("-0.50", 2), "available");
  assert.equal(at("100", 0), "available");
  for (const [threshold, scale] of [["100.0", 2], ["100", 2], ["100.000", 2], ["100.00", 0], ["100.", 0]]) {
    assert.equal(at(threshold, scale), "unavailable", `${threshold} at scale ${scale}`);
  }
  assert.equal(at("1", 256), "unavailable");
});

test("the comparison is one of the six the single-threshold family states", () => {
  for (const comparison of ["LESS", "LESS_OR_EQUAL", "EQUAL", "NOT_EQUAL", "GREATER_OR_EQUAL", "GREATER"]) {
    const report = normalizeBacktestRunReport({ ...available, strategy: { ...strategy, comparison } }, LOCATOR);
    assert.equal(report.state, "available", comparison);
  }
  for (const comparison of ["ABOVE", "greater", ""]) {
    assert.deepEqual(
      normalizeBacktestRunReport({ ...available, strategy: { ...strategy, comparison } }, LOCATOR),
      invalid,
      comparison,
    );
  }
});

test("a target position is refused where JSON can no longer state it exactly", () => {
  const withUnits = (units) => normalizeBacktestRunReport({
    ...available,
    strategy: { ...strategy, when_true: { ...strategy.when_true, target_position_units: units } },
  }, LOCATOR).state;
  assert.equal(withUnits(2 ** 53 - 1), "available");
  assert.equal(withUnits(-(2 ** 53 - 1)), "available");
  assert.equal(withUnits(2 ** 53), "unavailable");
  assert.equal(withUnits(-(2 ** 53)), "unavailable");
});

test("the strategy is stated only for the admitted single-threshold family", () => {
  assert.deepEqual(
    normalizeBacktestRunReport({ ...available, strategy: { ...strategy, family: "BOUNDED_FEATURE_V1" } }, LOCATOR),
    invalid,
  );
  assert.deepEqual(
    normalizeBacktestRunReport({ ...available, strategy: { ...strategy, threshold: "1e2" } }, LOCATOR),
    invalid,
  );
});

test("anything that is not a projection object fails closed", () => {
  for (const value of [null, undefined, "AVAILABLE", 7, [], [available]]) {
    assert.deepEqual(normalizeBacktestRunReport(value, LOCATOR), invalid);
  }
});

// Renders the real component and its real dependencies, compiled from source. A stubbed FactGroup or
// UnavailableState would only prove the stub, so nothing here is replaced except CSS class names.
const root = fileURLToPath(new URL("../", import.meta.url));
const requireExternal = createRequire(import.meta.url);

function compileModule(path, cache) {
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} };
  cache.set(path, module);
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const load = (specifier) => {
    if (specifier.endsWith(".module.css")) {
      return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    }
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return requireExternal(specifier);
    const base = specifier.startsWith("@/") ? join(root, specifier.slice(2)) : resolve(dirname(path), specifier);
    const target = [base, `${base}.tsx`, `${base}.ts`].find((candidate) => {
      try {
        return readFileSync(candidate) && /\.tsx?$/u.test(candidate);
      } catch {
        return false;
      }
    });
    if (!target) throw new Error(`Unresolved ${specifier} from ${path}`);
    return compileModule(target, cache);
  };
  new Function("require", "exports", "module", outputText)(load, module.exports, module);
  return module.exports;
}

const { BacktestRunReport } = compileModule(join(root, "components/backtest-run-report.tsx"), new Map());
const render = (report) => renderToStaticMarkup(React.createElement(BacktestRunReport, { report }));
// The text of every body cell, in order, with the markup inside each cell stripped.
const cellTexts = (html) => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gu)]
  .map((match) => match[1].replace(/<[^>]+>/gu, ""));

test("loading shows the three fact groups as skeletons and nothing else", () => {
  const html = render({ state: "loading" });
  assert.match(html, /data-ui="backtest-run-report"/u);
  assert.match(html, /data-state="loading"/u);
  assert.match(html, /aria-busy="true"/u);
  assert.match(html, /Loading backtest report/u);
  assert.doesNotMatch(html, /unavailable-state|Net return|<table/u);
});

test("unavailable names the Owner's reason and shows no positive fact", () => {
  const html = render(normalizeBacktestRunReport(unavailable, LOCATOR));
  assert.match(html, /data-state="unavailable"/u);
  assert.match(html, /class="unavailable-state"/u);
  assert.match(html, /<code>OUTCOME_EVIDENCE_UNAVAILABLE<\/code>/u);
  assert.doesNotMatch(html, /Strategy|Data window|Net return|<table|<polyline|aria-busy/u);
});

test("a projection that fails the contract renders as unavailable for that reason", () => {
  const html = render(normalizeBacktestRunReport({ ...available, fill_count: 9 }, LOCATOR));
  assert.match(html, /data-state="unavailable"/u);
  assert.match(html, new RegExp(`<code>${INVALID_BACKTEST_RUN_REPORT_PROJECTION}</code>`, "u"));
});

test("available answers all four questions from the stated values", () => {
  const html = render(normalizeBacktestRunReport(available, LOCATOR));
  assert.match(html, /data-state="available"/u);
  for (const heading of ["Strategy", "Data window", "Result"]) {
    assert.match(html, new RegExp(`<h3>${heading}</h3>`, "u"));
  }
  assert.match(html, /100\.00/u);
  assert.match(html, /the channel never crosses the threshold/u);
  assert.match(html, /<dt>End \(exclusive\)<\/dt><dd class="mono" title="2025-01-04T00:00:00\.000000000Z">/u);
  assert.match(html, new RegExp(dataWindow.cut_identity, "u"));
  assert.match(html, /<polyline /u);
  assert.match(html, /3 observations/u);
  assert.match(html, />-0\.002</u);
  assert.match(html, />-0\.00647</u);
  assert.match(html, /Net return \(fraction\)/u);
  assert.match(html, /Maximum drawdown \(fraction\)/u);
  assert.doesNotMatch(html, /No observations|%/u);
});

test("empty lists the run's fills and says only what is missing", () => {
  const html = render(normalizeBacktestRunReport(emptyWithFills, LOCATOR));
  assert.match(html, /data-state="empty"/u);
  assert.match(html, /No observations/u);
  assert.doesNotMatch(html, /<polyline|<circle|unavailable-state/u);
  assert.deepEqual(cellTexts(html).filter((text) => text === "BUY" || text === "SELL"), ["BUY", "SELL"]);
  assert.match(html, /<h3>Strategy<\/h3>/u);
});

test("fills are shown exactly as the projection wrote them", () => {
  const html = render(normalizeBacktestRunReport(available, LOCATOR));
  assert.deepEqual(cellTexts(html), [
    "2025-01-02T14:30:00.000000000Z", "BUY", "187.25", "2.0",
    "2025-01-02T20:00:00.000000000Z", "SELL", "188", "2",
  ]);
});

test("a single observation is drawn as a point, not an empty path", () => {
  const html = render(normalizeBacktestRunReport({ ...available, series: [available.series[0]] }, LOCATOR));
  assert.match(html, /<circle /u);
  assert.doesNotMatch(html, /<polyline/u);
  assert.match(html, /1 observations/u);
});

test("no state states or implies an equity return", () => {
  // The series may be built on a per-closed-position price return rather than a daily equity return,
  // and the projection does not yet say which. Until it does, no rendered word may claim equity.
  for (const report of [
    { state: "loading" },
    normalizeBacktestRunReport(unavailable, LOCATOR),
    normalizeBacktestRunReport(emptyWithFills, LOCATOR),
    normalizeBacktestRunReport(available, LOCATOR),
  ]) {
    assert.doesNotMatch(render(report), /equity/iu, report.state);
  }
});
