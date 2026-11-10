import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import ts from "typescript";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const paper = { paper_id: 7, candidate: "paper@1", symbols: ["BTCUSDT"] };
async function navigation({ backtest = false } = {}) {
  const location = new URL(`https://fixture.invalid/?line=line-a&at=snapshot&run=7${backtest ? "&stage=backtest" : ""}#paper@1`);
  const saved = new Map();
  const window = { location, addEventListener() {}, localStorage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) } };
  const context = createContext({ URL, URLSearchParams, window,
    history: { replaceState: (_state, _title, path) => { window.location = new URL(path, window.location.href); } },
    fetch: () => { throw new Error("Navigation cannot submit or read a service"); },
  });
  const modules = new Map();
  const load = (path) => {
    if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText, { context, identifier: path }));
    return modules.get(path);
  };
  const shell = load(resolve(src, "state/shell.ts"));
  await shell.link((name, from) => {
    if (name.startsWith(".")) return load(`${resolve(dirname(from.identifier), name)}.ts`);
    assert.equal(name, "react");
    return new SyntheticModule(["useSyncExternalStore"], function () {
      this.setExport("useSyncExternalStore", () => { throw new Error("State navigation uses no hooks"); });
    }, { context });
  });
  await shell.evaluate();
  const stage = modules.get(resolve(src, "state/stage.ts")).namespace;
  const selected = modules.get(resolve(src, "state/selection.ts")).namespace;
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
  return { stage, shell: shell.namespace, choice, arriveResearch, url: () => window.location };
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
