import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "node:vm";
import { loader } from "./load.mjs";

const paper = { paper_id: 7, candidate: "paper@1", symbols: ["BTCUSDT"] };
async function navigation({ backtest = false, address } = {}) {
  const location = new URL(address ?? `https://fixture.invalid/?line=line-a&at=snapshot&run=7${backtest ? "&stage=backtest" : ""}#paper@1`);
  const saved = new Map();
  const window = { location, addEventListener() {}, localStorage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) } };
  const context = createContext({ URL, URLSearchParams, window,
    history: { replaceState: (_state, _title, path) => { const { assign } = window.location; window.location = new URL(path, window.location.href); window.location.assign = assign; } },
    fetch: () => { throw new Error("Navigation cannot submit or read a service"); },
  });
  const graph = loader({ context, packages: [], stubs: {
    react: { useSyncExternalStore: () => { throw new Error("State navigation uses no hooks"); } },
  } });
  const navigate = await graph.namespace("state/navigate.ts");
  const shell = graph.loaded("state/shell.ts");
  const stage = graph.loaded("state/stage.ts");
  const selected = graph.loaded("state/selection.ts");
  const choice = () => stage.choiceOf(stage.choices.get(), selected.selection.get());
  const arriveResearch = () => {
    // main.show restores the selection across a new public research view, without creating user intent.
    const prior = choice();
    selected.initSelection(new Set(["paper@1", "live@1"]), "paper@1");
    if (prior.stage === "live") {
      if (prior.liveRun) stage.restoreLiveRun(prior.liveRun, "live@1");
      else stage.restoreStage("live");
    }
  };
  const assigned = [];
  window.location.assign = (path) => assigned.push(path);
  return { stage, shell, navigate, choice, arriveResearch, url: () => window.location, assigned, selected };
}

for (const order of ["research-late", "paper-list-late"]) {
  for (const intent of ["run-picker", "stage-switch", "live-command"]) {
    test(`a newer explicit Live ${intent} survives the old Paper URL when ${order}`, async () => {
      const h = await navigation({ backtest: true });
      if (order === "paper-list-late") h.arriveResearch();
      else h.stage.pickWanted([paper]);
      if (intent === "run-picker") h.stage.chooseLiveRun("web-explicit-live", "live@1");
      else if (intent === "stage-switch") h.stage.chooseStage("live");
      else h.shell.showLivePage();
      assert.equal(h.choice().stage, "live");
      if (order === "research-late") h.arriveResearch();
      h.stage.pickWanted([paper]);
      assert.equal(h.choice().stage, "live");
      if (intent === "run-picker") assert.equal(h.choice().liveRun, "web-explicit-live");
      assert.equal(h.url().searchParams.has("run"), false);
      assert.equal(h.url().searchParams.has("stage"), false);
      assert.equal(h.url().searchParams.get("line"), "line-a");
      assert.equal(h.url().searchParams.get("at"), "snapshot");
    });
  }
  for (const backtest of [false, true]) {
    test(`an explicit ${backtest ? "backtest" : "Paper"} link survives when ${order}`, async () => {
      const h = await navigation({ backtest });
      assert.equal(h.url().searchParams.get("run"), "7");
      if (order === "research-late") h.stage.pickWanted([paper]);
      else { h.arriveResearch(); h.stage.pickWanted(null); }
      assert.equal(h.url().searchParams.get("run"), "7", "automatic restoration must retain the waiting link");
      if (order === "research-late") h.arriveResearch();
      h.stage.pickWanted([paper]);
      assert.equal(h.choice().stage, backtest ? "backtest" : "paper");
      assert.equal(h.choice().run, 7);
      assert.equal(h.url().searchParams.has("run"), false);
      assert.equal(h.url().searchParams.has("stage"), false);
      assert.equal(h.url().hash, "#paper@1");
    });
  }
}

test("a History cell picks its replay in this view, or opens its line with the replay named", async () => {
  const here = await navigation({ address: "https://fixture.invalid/?line=line-a&at=snapshot" });
  here.arriveResearch();
  here.stage.openTrial("line-a", "live@1", 12);
  assert.equal(here.selected.selection.get(), "live@1");
  assert.deepEqual([here.choice().stage, here.choice().trial], ["backtest", 12]);
  here.stage.openTrial("line-b", "other@3", 40);
  assert.equal(here.assigned.at(-1), "/?line=line-b&at=snapshot&trial=40#other@3", "a version this view lacks opens its line");
  const there = await navigation({ address: "https://fixture.invalid/?line=line-b&at=snapshot&trial=40#other@3" });
  assert.equal(there.url().searchParams.has("trial"), false, "the address drops the replay once read");
  {
    there.selected.initSelection(new Set(["other@3"]), null);
    assert.equal(there.selected.selection.get(), "other@3");
    assert.deepEqual([there.choice().stage, there.choice().trial], ["backtest", 40]);
  }
});

test("a version link goes back to the canvas from any page; on the research page it keeps the tool window", async () => {
  const h = await navigation({ address: "https://fixture.invalid/?line=line-a&at=snapshot" });
  h.arriveResearch();
  const page = () => h.shell.shell.get().last.left;
  for (const show of [h.shell.showRunsPage, h.shell.showMarketPage, h.shell.showHistoryPage]) {
    show();
    h.navigate.showVersion("live@1");
    assert.equal(page(), "versions");
    assert.equal(h.selected.selection.get(), "live@1");
    h.navigate.showVersion("paper@1");
  }
  h.shell.showToolWindow("sources", "left");
  h.navigate.showVersion("live@1");
  assert.equal(page(), "sources", "a research tool window stays as it is");
  assert.equal(h.url().hash, "#live@1");
});

test("a replay picked in Details on the research page shows its backtest on the Runs page", async () => {
  const h = await navigation({ address: "https://fixture.invalid/?line=line-a&at=snapshot" });
  h.arriveResearch();
  h.navigate.showTrial(5);
  assert.equal(h.shell.shell.get().page, "runs");
  assert.deepEqual([h.choice().stage, h.choice().trial], ["backtest", 5]);
});
