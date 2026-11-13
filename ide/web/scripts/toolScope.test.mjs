import assert from "node:assert/strict";
import { test } from "node:test";
import { loader } from "./load.mjs";

const storage = new Map();
globalThis.window = { location: { search: "" }, localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
const { namespace, loaded } = loader();
const state = await namespace("state/shell.ts");
const { toolPage, bottomToolOnPage } = loaded("model/toolScope.ts");
const visible = () => ["progress", "readings", "table", "gaps", "trades", "coins", "news"]
  .filter((id) => bottomToolOnPage(id, toolPage(state.shell.get().last.left)));

test("20261106-07: bottom tools follow Market, Runs and research across repeated navigation", () => {
  state.resetShell();
  assert.deepEqual(visible(), ["progress", "readings", "table", "gaps"]);
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
    assert.deepEqual(visible(), ["progress", "readings", "table", "gaps"]);
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
  const stages = loaded("state/stage.ts");
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

test("Details stays on Runs and Market without a research line, and only there", async () => {
  const empty = () => ({});
  const { namespace: windowsNamespace } = loader({ stubs: {
    "widgets/registry": { RENDERERS: new Proxy({}, { get: (_, title) => ({ title, Component: empty }) }) },
    "widgets/market/CoinsWindow": { CoinsWindow: empty },
    "widgets/market/NewsWindow": { NewsWindow: empty, NewsTools: empty },
    "widgets/paper/TradesWindow": { TradesWindow: empty, TradesTools: empty },
    "shell/agent/AgentWindow": { AgentWindow: empty },
  } });
  const { toolWindows } = await windowsNamespace("shell/toolWindows.ts");
  const details = (page) => toolWindows([], false, true, page).some((w) => w.id === "inspector");
  assert.equal(details("market"), true);
  assert.equal(details("runs"), true);
  assert.equal(details("research"), false, "research Details comes from the line's view");
});
