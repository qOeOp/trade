import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "node:vm";
import { loader } from "./load.mjs";

const paper = { paper_id: 777, candidate: "fixture-retest@1", symbols: ["BTCUSDT"] };
async function phone() {
  const effects = [];
  const window = { location: new URL("https://fixture.invalid/"), addEventListener() {} };
  const context = createContext({ URL, URLSearchParams, window,
    history: { replaceState: (_state, _title, path) => { window.location = new URL(path, window.location.href); } },
  });
  const graph = loader({ context, packages: [], stubs: {
    "state/paper": { usePaperRuns: () => ({ runs: [paper] }) },
    "widgets/paper/RunPicker": { runOrder: (runs) => runs },
    react: { useEffect: (effect) => effects.push(effect), useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
  } });
  const { useTabRun } = await graph.namespace("shell/phone/useTabRun.ts");
  const stage = graph.loaded("state/stage.ts");
  const selection = graph.loaded("state/selection.ts");
  const choice = () => stage.choiceOf(stage.choices.get(), selection.selection.get());
  const render = () => { useTabRun(); for (const effect of effects.splice(0)) effect(); };
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
