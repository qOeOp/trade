import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import ts from "typescript";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const paper = { paper_id: 777, candidate: "fixture-retest@1", symbols: ["BTCUSDT"] };
async function phone() {
  const effects = [];
  const window = { location: new URL("https://fixture.invalid/"), addEventListener() {} };
  const context = createContext({ URL, URLSearchParams, window,
    history: { replaceState: (_state, _title, path) => { window.location = new URL(path, window.location.href); } },
  });
  const modules = new Map();
  const fake = (id, exports) => {
    if (!modules.has(id)) modules.set(id, new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context }));
    return modules.get(id);
  };
  const load = (path) => {
    if (path === resolve(src, "state/paper.ts")) return fake(path, { usePaperRuns: () => ({ runs: [paper] }) });
    if (path === resolve(src, "widgets/paper/RunPicker.ts")) return fake(path, { runOrder: (runs) => runs });
    if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText, { context, identifier: path }));
    return modules.get(path);
  };
  const hook = load(resolve(src, "shell/phone/useTabRun.ts"));
  await hook.link((name, from) => name.startsWith(".") ? load(`${resolve(dirname(from.identifier), name)}.ts`) : fake(name, {
    useEffect: (effect) => effects.push(effect), useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }));
  await hook.evaluate();
  const stage = modules.get(resolve(src, "state/stage.ts")).namespace;
  const selection = modules.get(resolve(src, "state/selection.ts")).namespace;
  const choice = () => stage.choiceOf(stage.choices.get(), selection.selection.get());
  const render = () => { hook.namespace.useTabRun(); for (const effect of effects.splice(0)) effect(); };
  return { stage, selection, choice, render };
}

test("phone Live → Paper → Live keeps the exact run and candidate across the automatic Paper fallback", async () => {
  const h = await phone();
  h.selection.initSelection(new Set([paper.candidate]), paper.candidate);
  h.stage.chooseLiveRun("fixture-live-run", paper.candidate);
  h.render();
  h.stage.chooseStage("paper");
  h.render();
  assert.equal(h.selection.selection.get(), paper.candidate, "the phone must not deselect this explicit version stage");
  assert.equal(h.choice().stage, "paper");
  h.stage.chooseStage("live");
  h.render();
  assert.equal(h.choice().stage, "live");
  assert.equal(h.choice().liveRun, "fixture-live-run");
  assert.equal(h.selection.selection.get(), paper.candidate);
});

test("phone startup still defaults to Paper when research only selected a version, without stage intent", async () => {
  const h = await phone();
  h.selection.initSelection(new Set([paper.candidate]), paper.candidate);
  h.render();
  assert.equal(h.selection.selection.get(), null);
  assert.equal(h.choice().stage, "paper");
  assert.equal(h.choice().run, 777);
  h.render();
  assert.equal(h.choice().run, 777);
});

test("an unattributed Live run keeps its identity through phone Paper and back without copying version choices", async () => {
  const h = await phone();
  h.selection.initSelection(new Set([paper.candidate]), paper.candidate);
  h.stage.chooseLiveRun("live-without-research", "unavailable@1");
  h.render();
  h.stage.chooseStage("paper");
  h.render();
  assert.equal(h.choice().run, 777);
  h.stage.chooseStage("live");
  h.render();
  assert.equal(h.choice().liveRun, "live-without-research");
  assert.equal(h.selection.selection.get(), null);
});

test("phone automatic defaults do not replace an explicitly selected backtest", async () => {
  const h = await phone();
  h.selection.initSelection(new Set([paper.candidate]), paper.candidate);
  h.stage.chooseTrial(321);
  h.render();
  assert.equal(h.selection.selection.get(), paper.candidate);
  assert.equal(h.choice().stage, "backtest");
  assert.equal(h.choice().trial, 321);
});
