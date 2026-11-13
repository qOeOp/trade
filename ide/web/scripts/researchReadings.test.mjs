// Render the recommendation menu and a version's readings from graph fixtures: the menu names trials by their
// number, and a sealed run's win rate is its plan win rate, never the backtest report's closed-trade win rate.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loader } from "./load.mjs";

const empty = () => null;
const pass = ({ children }) => createElement("div", null, children);

test("20261113-106: the recommended menu names the trial it starts after, not its place on the line", async () => {
  const widgets = {
    summary: { recommended: "a@2", status: "recommended" },
    lineage: { nodes: [{ id: "a@2" }], targets: null, trail: [{ candidate: "a@2", x0: 4.5, judgments: [4.5] }, { candidate: "a@2", x0: 0.5, judgments: [0.5] }],
               trials: [{ trial_id: 103, x: 3 }, { trial_id: 140, x: 4 }] },
  };
  const { RecommendationWidget } = await loader({ stubs: {
    "model/view": { useWidget: (type) => widgets[type] },
    "state/selection": { select: empty },
    "components/Dropdown": { Dropdown: pass, DropdownLabel: pass, DropdownItem: ({ hint }) => createElement("p", null, hint) },
    "components/VersionLine": { VersionLine: empty },
  } }).namespace("shell/toolbar/RecommendationWidget.tsx");
  const html = renderToStaticMarkup(createElement(RecommendationWidget));
  assert.match(html, /from trial 140 ·/, "the trial number at x 4, as the ruler labels that column");
  assert.match(html, /from trial - ·/, "before the line's first trial there is none");
  assert.doesNotMatch(html, /from trial 4 /);
});

test("20261113-106: a sealed run without a plan win rate shows none, never the closed-trade win rate", async () => {
  const trial = { trial_id: 140, purpose: "research", annual_return: 0.3, max_drawdown: 0.1, sharpe: 1.2, plan_win_rate: null };
  const account = { ret: 0.1, starting: 10_000, drawdown: 0.05 };
  let shown;
  const { Readings } = await loader({ stubs: {
    "state/backtest": { useBacktest: () => ({ kind: "ready", b: { account, stats: { winRate: 0.75 } } }) },
    "state/runData": { useRunData: () => null },
    "state/shell": { useOnRunsPage: () => false },
    "state/shown": { useShown: () => shown },
    "components/Eased": { Eased: pass },
    "components/Tip": { Tip: pass },
  } }).namespace("widgets/detail/Readings.tsx");
  const render = (t) => {
    shown = { version: "a@2", trial: t };
    return renderToStaticMarkup(createElement(Readings, { c: { id: "a@2", trials: [t] }, targets: null }));
  };
  const missing = render(trial);
  assert.match(missing, /Plan win rate/);
  assert.doesNotMatch(missing, /75\.00/, "the backtest report's closed-trade win rate stays out");
  assert.match(render({ ...trial, plan_win_rate: 0.5 }), /50\.00/);
});
