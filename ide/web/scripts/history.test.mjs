// The History page's heatmap model (model/history.ts): shared columns across lines, cells by column, the thick-border
// rule, the colour steps, the hidden rows and the orders.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const h = await namespace("model/history.ts", { sources: ["model/heat"], packages: [] });
const cell = (kind, label, annual = 0.1, dd = 0.1, extra = {}) => ({ trial_id: 1, kind, label, trade_start: "", trade_end: "", status: "passed",
  whole_year: kind === "veto", short: false, measures: { annual_return: annual, mark_max_drawdown: dd, sharpe_365: 1, cycles: 3, plan_win_rate: 0.5 }, ...extra });
const row = (run, cells, veto = {}) => ({ source_sha256: "s", candidate: `c@${run}`, run, development: cell("development", "development"), cells,
  control_reproduces: true, summary: { veto: { median_annual_return: 0.1, years_meeting_targets: 1, ...veto }, holdout: {}, meets_targets: null, judged_on: null } });
const line = (rows) => ({ line: "l", closed: true, dev_start: "", dev_end: "", targets: { max_drawdown: 0.2, annual_return: 0.3 }, participants: rows.length, research_trials: 9, rows });

test("every line shares the calendar-year columns, then development, holdout and forward", () => {
  const a = line([row(1, [cell("veto", "2021"), cell("holdout", "holdout")])]), b = line([row(2, [cell("veto", "2019"), cell("veto", "2020")])]);
  assert.deepEqual(h.columns([a, b]).map((c) => c.id), ["2019", "2020", "2021", "development", "holdout", "forward"]);
  const [r] = a.rows, cols = h.columns([a, b]);
  assert.equal(h.cellAt(r, cols[2]).label, "2021");
  assert.equal(h.cellAt(r, cols[0]), null, "a year the row has no run of");
  assert.equal(h.cellAt(r, cols[3]).kind, "development");
  assert.equal(h.cellAt(r, cols[4]).kind, "holdout");
});

test("a thick border needs both targets on a segment of three months or more", () => {
  const targets = line([]).targets;
  assert.equal(h.meetsBoth(cell("veto", "2020", 0.35, 0.15), targets), true);
  assert.equal(h.meetsBoth(cell("veto", "2020", 0.35, 0.25), targets), false);
  assert.equal(h.meetsBoth(cell("veto", "2020", 0.35, 0.15, { short: true }), targets), false, "a short segment counts in nothing");
  assert.equal(h.meetsBoth(cell("veto", "2020", 0.35, 0.15, { measures: undefined }), targets), false, "an invalid run has no measures");
});

test("returns colour by sign and size; rows with no edge hide; orders put unknowns last", () => {
  assert.deepEqual([-0.5, -0.2, -0.05, 0.01, 0.05, 0.2, 0.5, null].map(h.returnStep), [-3, -2, -1, 0, 1, 2, 3, null]);
  assert.deepEqual(h.RETURN_RANGES, ["below −40%", "−40% to −15%", "−15% to −2%", "−2% to +2%", "+2% to +15%", "+15% to +40%", "above +40%"]);
  const a = row(1, [], { median_annual_return: 0, years_meeting_targets: 0 }), b = row(2, [], { median_annual_return: 0.4, years_meeting_targets: 3 }),
        c = { ...row(3, []), summary: null };
  assert.deepEqual([a, b, c].map(h.noEdge), [true, false, false], "a row whose control differs has no summary and is never hidden for it");
  assert.deepEqual(h.ordered([a, b, c], "median").map((r) => r.run), [2, 1, 3]);
  assert.deepEqual(h.ordered([a, b, c], "meeting").map((r) => r.run), [2, 1, 3]);
  assert.deepEqual(h.ordered([a, b, c], "development").map((r) => r.run), [1, 2, 3]);
});

test("the holdout's earlier searches: a count when the API gave one, zero is a count, no field is unknown", () => {
  const shared = { ...line([]), holdout_prior_trials: { trials: 3, instruments: ["BTCUSDT"], by_line: [
    { line: "rsi-twin", purpose: "history", trials: 2 }, { line: null, purpose: "explore", trials: 1 }] } };
  assert.equal(h.priorTrials(shared), 3);
  assert.deepEqual(h.priorGroups(shared), ["rsi-twin, history: 2 trials", "no line, explore: 1 trial"]);
  const none = { ...line([]), holdout_prior_trials: { trials: 0, instruments: ["BTCUSDT"], by_line: [] } };
  assert.equal(h.priorTrials(none), 0, "none counted here, not unknown");
  assert.deepEqual(h.priorGroups(none), []);
  assert.equal(h.priorTrials({ ...line([]), holdout_prior_trials: null }), null, "before the line's first research trial");
  assert.equal(h.priorTrials(line([])), null, "a server that does not send it");
  assert.deepEqual(h.priorGroups(line([])), []);
});
