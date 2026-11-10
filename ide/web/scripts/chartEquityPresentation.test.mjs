// Real chart switch composition and shared equity reader, with controlled observations and layout.
// These fixtures do not connect to services or invoke any run commands.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const run = { paper_id: 777, live: { final_equity_usdt: "9876.54" } };
let shown, stream, phone, landscape, layoutReads, moved = true;
const empty = () => null;
const fixtures = {
  "components/CoinMenu": { CoinChip: empty, CoinMenu: empty },
  "components/Tabs": { Tabs: ({ label, items }) => createElement("div", { "aria-label": label },
    items.map(({ id, label, disabled }) => createElement("span", { key: id, "data-choice": id, "data-disabled": !!disabled }, label))) },
  "widgets/runs/RunStages": { RunStages: ({ backtest, paper }) => createElement("div", {
    "data-stage-selector": shown.stage, "data-backtest": backtest, "data-paper": paper,
  }) },
  "state/stage": { paperTab: { set() { throw new Error("Presentation cannot change the chart selection"); } } },
  "state/phone": {
    usePhone: () => { layoutReads.push("phone"); return phone; },
    useLandscape: () => { layoutReads.push("landscape"); return landscape; },
  },
  "state/shown": { useShown: () => shown },
  "state/paperStream": { useStream: () => stream },
  "lib/paperApi": { amount: Number, fixed: (value, digits) => Number(value).toFixed(digits) },
  "model/chain": { chainEquity: (_chain, equity) => equity, chainReturn: () => 0.42, equityMoved: () => moved },
  "components/RunTile": { signedPct: (value) => `${value * 100}%` },
  "theme/roles": { pnlClass: () => "" },
};
const modules = new Map();
const fake = (id, exports) => {
  if (!modules.has(id)) modules.set(id, new SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }));
  return modules.get(id);
};
const load = (path) => {
  if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { identifier: path }));
  return modules.get(path);
};
const component = load(resolve(src, "widgets/paper/ChartSwitches.tsx"));
await component.link(async (name, from) => {
  if (!name.startsWith(".")) return fake(name, await import(name));
  const target = resolve(dirname(from.identifier), name), relative = target.slice(src.length + 1);
  if (relative === "widgets/paper/EquityReading") return load(`${target}.tsx`);
  assert.ok(fixtures[relative], `Unexpected chart dependency: ${relative}`);
  return fake(target, fixtures[relative]);
});
await component.evaluate();
const render = (stage, { mobile = false, sideways = false, paper = true, streamId = 777, testing = stage === "backtest" } = {}) => {
  shown = { stage, run: paper ? run : null, chain: paper ? [run] : [] };
  stream = { paperId: streamId, readings: { final_equity_usdt: "8765.43" } };
  phone = mobile; landscape = sideways; layoutReads = [];
  return renderToStaticMarkup(createElement(component.namespace.ChartSwitches, {
    testing, backtest: true, paper, view: "equity", symbols: ["BTCUSDT"], sides: new Map(), traded: new Set(), loose: null,
  }));
};
const noPaperReading = (html) => assert.doesNotMatch(html, /9876|8765|42%|USDT|Return/);

test("Paper equity stays in the chart on desktop and landscape, and in the phone hero when upright", () => {
  for (const [mobile, sideways] of [[false, false], [true, false], [true, true], [false, true]]) {
    const html = render("paper", { mobile, sideways });
    assert.match(html, /data-stage-selector="paper" data-backtest="true" data-paper="true"/);
    assert.match(html, /data-choice="equity"/);
    if (mobile && !sideways) noPaperReading(html);
    else {
      assert.match(html, /8765<\/span><span[^>]*>\.43/);
      assert.match(html, /42%/);
      assert.equal((html.match(/USDT/g) ?? []).length, 1);
    }
    // Both layout subscriptions must be read even on desktop; short-circuiting the latter changes
    // the component's hook order when the same chart switches between phone and desktop layouts.
    assert.deepEqual(layoutReads, ["phone", "landscape"]);
  }
});

test("Backtest and Live cannot borrow retained Paper equity even without the caller's testing flag", () => {
  for (const stage of ["backtest", "live"]) {
    for (const testing of [false, true]) {
      const html = render(stage, { testing });
      noPaperReading(html);
      assert.match(html, new RegExp(`data-stage-selector="${stage}"`));
      assert.match(html, /data-choice="equity" data-disabled="false">Equity<\/span>/);
    }
  }
});

test("the selected Paper run ignores another run's retained stream", () => {
  const html = render("paper", { streamId: 888 });
  assert.match(html, /9876<\/span><span[^>]*>\.54/);
  assert.doesNotMatch(html, /8765/);
  assert.match(html, /42%/);
});

test("a Paper stage without a selected run never turns a retained stream into an account reading", () => {
  const html = render("paper", { paper: false });
  noPaperReading(html);
  assert.match(html, /data-choice="equity" data-disabled="false">Equity<\/span>/);
});

test("Paper Equity is greyed with no reading until the run's equity moves; Backtest and Live keep theirs", () => {
  moved = false;
  try {
    const html = render("paper");
    assert.match(html, /data-choice="equity" data-disabled="true">Equity<\/span>/);
    noPaperReading(html);
    for (const stage of ["backtest", "live"]) assert.match(render(stage), /data-choice="equity" data-disabled="false">Equity<\/span>/);
  } finally {
    moved = true;
  }
});
