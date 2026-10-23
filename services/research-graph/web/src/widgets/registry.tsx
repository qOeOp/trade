import type { ReactNode } from "react";
import type { DetailWidget, EventsWidget, Focus, LineageWidget, NotesWidget, ScatterWidget, SummaryWidget, Widget } from "../types";
import { Events } from "./Events";
import { Detail } from "./Detail";
import { Lineage } from "./Lineage";
import { Notes } from "./Notes";
import { Scatter } from "./Scatter";
import { SummaryBar } from "./Summary";

export type WidgetContext = {
  selected: string | null; onSelect: (id: string) => void;
  focus: Focus | null; onFocus: (f: Omit<Focus, "seq">) => void;
};

// Where a widget type lives in the shell: the top bar, the full-screen canvas, the right drawer
// or a tab of the bottom dock. A type that is not registered becomes a dock tab saying so.
export type Region = "bar" | "canvas" | "drawer" | "dock";
export type Entry = { region: Region; label: string; render: (w: Widget, ctx: WidgetContext) => ReactNode };

export const REGISTRY: Record<string, Entry> = {
  "summary/1": { region: "bar", label: "概要", render: (w) => <SummaryBar widget={w as SummaryWidget} /> },
  "lineage/1": { region: "canvas", label: "策略谱系",
                 render: (w, c) => <Lineage widget={w as LineageWidget} selected={c.selected} onSelect={c.onSelect} focus={c.focus} /> },
  "candidate-detail/1": { region: "drawer", label: "版本详情",
                          render: (w, c) => <Detail widget={w as DetailWidget} selected={c.selected} /> },
  "scatter/1": { region: "dock", label: "年化 vs 回撤",
                 render: (w, c) => <Scatter widget={w as ScatterWidget} selected={c.selected} onSelect={c.onSelect} /> },
  "events/1": { region: "dock", label: "事件列表", render: (w, c) => <Events widget={w as EventsWidget} onFocus={c.onFocus} /> },
  "notes/1": { region: "dock", label: "数据缺口", render: (w) => <Notes widget={w as NotesWidget} /> },
};

export const unknown = (w: Widget): Entry => ({
  region: "dock", label: w.title ?? w.type,
  render: () => <p className="faint">此渲染器不支持 widget 类型 <span className="mono">{w.type}</span></p>,
});
