import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { DetailWidget, LineageWidget, View } from "./model/types";
import { initSelection } from "./state/selection";
import "./index.css";

const root = createRoot(document.getElementById("root")!);
try {
  const view = JSON.parse(document.getElementById("research-graph-view")?.textContent ?? "") as View;
  const lineage = view.widgets.find((w) => w.type === "lineage/2") as LineageWidget | undefined;
  const detail = view.widgets.find((w) => w.type === "candidate-detail/1") as DetailWidget | undefined;
  initSelection(new Set(lineage?.nodes.map((n) => n.id) ?? []), detail?.default ?? null);
  root.render(<StrictMode><App view={view} /></StrictMode>);
} catch {
  root.render(<p style={{ padding: 24 }}>No view data to read: generate this page with graph.py render.</p>);
}
