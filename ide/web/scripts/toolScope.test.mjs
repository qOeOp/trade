import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SourceTextModule, SyntheticModule } from "node:vm";
import ts from "typescript";

const savedLayout = { open: { left: null, right: null, bottom: null }, last: { left: "live", right: "inspector", bottom: "progress" }, size: { left: 400, right: 420, bottom: 260 } };
const storage = new Map([["rg-shell@3", JSON.stringify(savedLayout)]]);
globalThis.window = { location: { search: "" }, localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
const modules = new Map();
function load(path) {
  if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, { identifier: path }));
  return modules.get(path);
}
const root = load(resolve(dirname(fileURLToPath(import.meta.url)), "../src/state/shell.ts"));
await root.link(async (specifier, from) => {
  if (specifier.startsWith(".")) return load(`${resolve(dirname(from.identifier), specifier)}.ts`);
  const found = await import(specifier);
  return new SyntheticModule(Object.keys(found), function () { for (const [key, value] of Object.entries(found)) this.setExport(key, value); });
});
await root.evaluate();
const state = root.namespace;
const { toolPage, bottomToolOnPage } = modules.get(resolve(dirname(fileURLToPath(import.meta.url)), "../src/model/toolScope.ts")).namespace;
const visible = () => ["progress", "readings", "table", "gaps", "trades", "coins", "news", "unknown:future@1"]
  .filter((id) => bottomToolOnPage(id, toolPage(state.shell.get().last.left)));

const boot = state.shell.get();
const bootStages = modules.get(resolve(dirname(fileURLToPath(import.meta.url)), "../src/state/stage.ts")).namespace;
const bootChoice = bootStages.choiceOf(bootStages.choices.get(), null);
test("saved rg-shell@3 Live layout opens Runs Live before any research or service observation", () => {
  assert.equal(boot.last.left, "runs");
  assert.equal(bootChoice.stage, "live");
  assert.equal(boot.open.right, "inspector");
  assert.equal(boot.open.bottom, "trades");
  assert.equal(JSON.parse(storage.get("rg-shell@3")).last.left, "runs");
});

test("20261106-07: bottom tools follow Market, Runs and research across repeated navigation", () => {
  state.resetShell();
  assert.deepEqual(visible(), ["progress", "readings", "table", "gaps", "unknown:future@1"]);
  for (let visit = 0; visit < 2; visit++) {
    state.showMarketPage();
    assert.deepEqual(visible(), ["coins", "news"]);
    assert.equal(state.shell.get().open.bottom, "coins");
    state.showToolWindow("news", "bottom");
    state.showRunsPage();
    assert.deepEqual(visible(), ["trades"]);
    assert.equal(state.shell.get().open.bottom, "trades");
    state.toggleSide("bottom");
    state.toggleSide("bottom");
    assert.equal(state.shell.get().open.bottom, "trades", "the side shortcut reopens a tool on the current page");
    state.showToolWindow("versions", "left");
    assert.deepEqual(visible(), ["progress", "readings", "table", "gaps", "unknown:future@1"]);
    assert.equal(state.shell.get().open.bottom, "progress");
    state.toggleToolWindow("sources", "left");
    assert.equal(state.shell.get().open.bottom, "progress");
  }
});

test("20261106-07: a hidden bottom side stays hidden on navigation and reopens with current context", () => {
  state.resetShell();
  state.showMarketPage();
  state.showToolWindow("news", "bottom");
  state.hideSide("bottom");
  state.showToolWindow("versions", "left");
  assert.equal(state.shell.get().open.bottom, null);
  state.toggleSide("bottom");
  assert.equal(state.shell.get().open.bottom, "progress");
  state.showToolWindow("agent", "right");
  state.showRunsPage();
  state.showMarketPage();
  assert.equal(state.shell.get().open.right, "agent", "Agent remains shared across pages");
});

test("the former Live destination selects the Live stage inside Runs with shared Details and Trades", () => {
  state.resetShell();
  state.showRunsPage();
  state.showLivePage();
  assert.equal(state.shell.get().last.left, "runs");
  assert.deepEqual(visible(), ["trades"]);
  assert.equal(state.shell.get().open.bottom, "trades");
  assert.equal(state.shell.get().open.right, "inspector");
  const stages = modules.get(resolve(dirname(fileURLToPath(import.meta.url)), "../src/state/stage.ts")).namespace;
  assert.equal(stages.choiceOf(stages.choices.get(), null).stage, "live");
  state.toggleSide("bottom");
  state.toggleSide("bottom");
  assert.equal(state.shell.get().open.bottom, "trades");
  state.showToolWindow("agent", "right");
  state.showLivePage();
  assert.equal(state.shell.get().open.right, "agent", "the shared Agent remains open");
  state.showMarketPage();
  state.toggleSide("bottom");
  assert.deepEqual(visible(), ["coins", "news"]);
  state.showRunsPage();
  assert.deepEqual(visible(), ["trades"]);
});
