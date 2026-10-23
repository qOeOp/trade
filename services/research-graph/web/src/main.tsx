import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { View } from "./types";
import "./styles.css";

const source = document.getElementById("research-graph-view")?.textContent ?? "";
const root = createRoot(document.getElementById("root")!);
try {
  const view = JSON.parse(source) as View;
  root.render(<StrictMode><App view={view} /></StrictMode>);
} catch {
  root.render(<p style={{ padding: 24 }}>没有可读的视图数据：请用 graph.py render --renderer web 生成本页。</p>);
}
