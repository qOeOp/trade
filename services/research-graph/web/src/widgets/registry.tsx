import type { ReactNode } from "react";
import type { DetailWidget, LineageWidget, NotesWidget, ScatterWidget, SummaryWidget, Widget } from "../types";
import { Detail } from "./Detail";
import { Lineage } from "./Lineage";
import { Notes } from "./Notes";
import { Scatter } from "./Scatter";
import { SummaryBar } from "./Summary";

export type WidgetContext = { selected: string | null; onSelect: (id: string) => void };

// Where a widget type lives in the shell: the top bar, the full-screen canvas, the right drawer
// or a tab of the bottom dock. A type that is not registered becomes a dock tab saying so.
export type Region = "bar" | "canvas" | "drawer" | "dock";
export type Entry = { region: Region; label: string; render: (w: Widget, ctx: WidgetContext) => ReactNode };

export const REGISTRY: Record<string, Entry> = {
  "summary/1": { region: "bar", label: "概要", render: (w) => <SummaryBar widget={w as SummaryWidget} /> },
  "lineage/2": { region: "canvas", label: "策略谱系",
                 render: (w, c) => <Lineage widget={w as LineageWidget} selected={c.selected} onSelect={c.onSelect} /> },
  "candidate-detail/1": { region: "drawer", label: "版本详情",
                          render: (w, c) => <Detail widget={w as DetailWidget} selected={c.selected} /> },
  "scatter/1": { region: "dock", label: "年化 vs 回撤",
                 render: (w, c) => <Scatter widget={w as ScatterWidget} selected={c.selected} onSelect={c.onSelect} /> },
  "notes/1": { region: "dock", label: "数据缺口", render: (w) => <Notes widget={w as NotesWidget} /> },
};

export const unknown = (w: Widget): Entry => ({
  region: "dock", label: w.title ?? w.type,
  render: () => <p className="faint">此渲染器不支持 widget 类型 <span className="mono">{w.type}</span></p>,
});
