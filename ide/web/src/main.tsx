import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Crashed } from "./components/Crashed";
import { Waiting } from "./components/Waiting";
import { readSetup, type Setup } from "./lib/setupApi";
import { shared } from "./lib/shared";
import { follow, type Choice } from "./live";
import type { DetailWidget, LineageWidget, View } from "./model/types";
import { detectAgentService } from "./state/agent";
import { firstRun } from "./state/firstRun";
import { detectOverview } from "./state/market";
import { detectPublicCopy } from "./state/about";
import { detectMarketImport } from "./state/marketImport";
import { detectLiveTrading, liveTrading } from "./state/liveTrading";
import { detectPaperService, paperRuns } from "./state/paper";
import { showLiveRun } from "./state/liveWorkspace";
import { phoneNow, viewStatus } from "./state/phone";
import { initSelection, selection } from "./state/selection";
import { choiceOf, choices as runChoices, restoreLiveRun, restoreStage, pickWanted } from "./state/stage";
import "virtual:harmonyos-sans-sc.css";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

let shown: View | null = null;

/** Draws `next`, keeping the selected version when it is still in it, and every part of the last view
 *  that did not change: a new ledger commit alone redraws nothing. */
function show(next: View): void {
  const view = shown = shared(shown, next);
  const lineage = view.widgets.find((w) => w.type === "lineage@2") as LineageWidget | undefined;
  const detail = view.widgets.find((w) => w.type === "candidate-detail@1") as DetailWidget | undefined;
  const prior = choiceOf(runChoices.get(), selection.get());
  initSelection(new Set(lineage?.nodes.map((n) => n.id) ?? []), detail?.default ?? null);
  // A late research response must not replace the independently selected Live run.
  if (prior.stage === "live") {
    if (prior.liveRun) restoreLiveRun(prior.liveRun, liveTrading.get().view.runs.find((run) => run.id === prior.liveRun)?.candidate ?? null);
    else restoreStage("live");
  }
  root.render(<StrictMode><Crashed reset={view}><App view={view} /></Crashed></StrictMode>);
  pickWanted(paperRuns.get()?.runs ?? null);
}

// Before a view: what the shell's editor says instead of the graph.
const status = (text: string, busy = false, choices?: Choice[], next?: string[]) => {
  viewStatus.set({ text, busy, choices, next });
  if (shown === null) root.render(<StrictMode><Crashed reset={null}><App view={null} /></Crashed></StrictMode>);
};

let following = false;
const startFollowing = () => { if (!following) { following = true; follow(show, status); } };

/** Whether a deployment's first start needs this page; if so it is shown, and the page follows the ledger once
 *  that start is done. A service that has not opened its port yet looks like one that has its ledger, so while no
 *  view has come the question is asked again. Only one line shows until the first answer, so that a new operator
 *  never sees the IDE's frame before its first start. */
async function begin(): Promise<void> {
  root.render(<StrictMode><Waiting text="Reading the ledger…" busy /></StrictMode>);
  let answer = await readSetup();
  const needed = () => typeof answer === "object" && answer.state !== "done";
  const ask = () => firstRun.set({ setup: answer as Setup, onReady: startFollowing });
  if (needed()) ask(); else startFollowing();
  status("Reading the ledger…", true);
  if (needed()) return;
  while (!needed() && answer === "down" && shown === null) {
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
    answer = await readSetup();
  }
  if (needed() && shown === null) ask();
}

void begin();
void detectAgentService();
void detectPaperService();
void detectMarketImport();
detectPublicCopy();
void detectOverview();
void detectLiveTrading();

// A link to a Live run (a Telegram message's, or a phone's Copy link for the desktop): the desktop opens it once
// Live lists it; a phone opens its own page (state/phone.ts). Only selection: nothing is sent to Live.
const linkedLive = new URLSearchParams(window.location.search).get("live");
if (linkedLive && !phoneNow()) {
  const stop = liveTrading.subscribe(() => {
    if (!liveTrading.get().view.runs.some((run) => run.id === linkedLive)) return;
    stop();
    showLiveRun(linkedLive);
  });
}
