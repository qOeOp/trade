import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readSetup } from "./lib/setupApi";
import { shared } from "./lib/shared";
import { follow, type Choice } from "./live";
import type { DetailWidget, LineageWidget, View } from "./model/types";
import { detectAgentService } from "./state/agent";
import { firstRun } from "./state/firstRun";
import { detectOverview } from "./state/market";
import { detectMarketImport } from "./state/marketImport";
import { detectPaperService, paperRuns } from "./state/paper";
import { viewStatus } from "./state/phone";
import { initSelection } from "./state/selection";
import { pickWanted } from "./state/stage";
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
  initSelection(new Set(lineage?.nodes.map((n) => n.id) ?? []), detail?.default ?? null);
  root.render(<StrictMode><App view={view} /></StrictMode>);
  pickWanted(paperRuns.get()?.runs ?? null);
}

// Before a view: the desktop's one line in the middle of the page; a phone goes on, with it on the Research tab.
const status = (text: string, busy = false, choices?: Choice[]) => {
  viewStatus.set({ text, busy, choices });
  if (shown === null) root.render(<StrictMode><App view={null} /></StrictMode>);
};

let following = false;
const startFollowing = () => { if (!following) { following = true; follow(show, status); } };

/** Whether a deployment's first start needs this page; if so it is shown, and the page follows the ledger once
 *  that start is done. A service that has not opened its port yet looks like one that has its ledger, so while no
 *  view has come the question is asked again. */
async function begin(): Promise<void> {
  status("Reading the ledger…", true);
  let answer = await readSetup();
  const needed = () => typeof answer === "object" && answer.state !== "done";
  if (!needed()) startFollowing();
  while (!needed() && answer === "down" && shown === null) {
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
    answer = await readSetup();
  }
  if (typeof answer === "object" && needed() && shown === null) firstRun.set({ setup: answer, onReady: startFollowing });
}

void begin();
void detectAgentService();
void detectPaperService();
void detectMarketImport();
void detectOverview();
