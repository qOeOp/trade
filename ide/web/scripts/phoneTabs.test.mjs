import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "node:vm";
import { loader } from "./load.mjs";

async function phone(address = "https://fixture.invalid/") {
  const listeners = new Map(), steps = [];
  const window = {
    location: new URL(address),
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener: (type, f) => listeners.set(type, f),
  };
  const history = {
    pushState: () => steps.push("push"),
    back: () => { steps.push("back"); listeners.get("popstate")(); },
    replaceState: (_s, _t, path) => { steps.push("replace"); window.location = new URL(path, window.location.href); },
  };
  const context = createContext({ URL, URLSearchParams, window, history });
  const graph = loader({ context, packages: [], stubs: { react: { useLayoutEffect() {}, useSyncExternalStore() {} } } });
  return { p: await graph.namespace("state/phone.ts"), steps, url: () => window.location };
}

test("tapping Runs again on a run's page goes back to the list, as the browser's back does", async () => {
  const { p, steps } = await phone();
  p.openRun({ kind: "paper", id: 7 });
  p.choosePhoneTab("runs");
  assert.equal(p.phoneTab.get(), "runs");
  assert.deepEqual(steps, ["push", "back"]);
  p.choosePhoneTab("runs");
  assert.deepEqual(steps, ["push", "back"], "on the list, Runs again does nothing");
});

test("a run opened from a link closes to the list and leaves the address", async () => {
  const { p, url } = await phone("https://fixture.invalid/?live=web-1");
  p.choosePhoneTab("runs");
  assert.equal(url().searchParams.has("live"), false);
});

test("another tab keeps the run's page for when Runs is tapped back", async () => {
  const { p, steps } = await phone();
  p.openRun({ kind: "live", id: "web-1" });
  p.choosePhoneTab("market");
  assert.equal(p.phoneTab.get(), "market");
  p.choosePhoneTab("runs");
  assert.equal(p.phoneTab.get(), "runs");
  assert.deepEqual(steps, ["push"], "switching back to Runs shows the run, not the list");
});
