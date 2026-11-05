import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Waiting } from "./components/Waiting";
import { shared } from "./lib/shared";
import { follow, type Choice } from "./live";
import type { DetailWidget, LineageWidget, View } from "./model/types";
import { detectAgentService } from "./state/agent";
import { detectOverview } from "./state/market";
import { detectMarketImport } from "./state/marketImport";
import { detectPaperService, paperRuns } from "./state/paper";
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

const status = (text: string, busy = false, choices?: Choice[]) => root.render(<Waiting text={text} busy={busy} choices={choices} />);

try {
  const view = JSON.parse(document.getElementById("research-graph-view")?.textContent ?? "") as View | null;
  // A live page (served, not rendered to a file) may have a chat service beside it.
  if (view === null) { follow(show, status); void detectAgentService(); void detectPaperService(); void detectMarketImport(); void detectOverview(); }
  else show(view);
} catch {
  status("No view data to read: generate this page with ide.py render.");
}
