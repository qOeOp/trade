import type { ReactNode } from "react";
import type { DetailWidget, LineageWidget, NotesWidget, ScatterWidget, SummaryWidget, Widget } from "../types";
import { Detail } from "./Detail";
import { Lineage } from "./Lineage";
import { Notes } from "./Notes";
import { Scatter } from "./Scatter";
import { Summary } from "./Summary";

export type WidgetContext = { selected: string | null; onSelect: (id: string) => void };

// Bento placement per widget type: columns of a 12-column grid and a row height class.
export type Entry = { span: string; height: string; framed: boolean; render: (w: Widget, ctx: WidgetContext) => ReactNode };

export const REGISTRY: Record<string, Entry> = {
  "summary/1": { span: "col-span-12", height: "", framed: false,
                 render: (w) => <Summary widget={w as SummaryWidget} /> },
  "lineage/1": { span: "col-span-12 xl:col-span-8", height: "h-[720px]", framed: true,
                 render: (w, c) => <Lineage widget={w as LineageWidget} selected={c.selected} onSelect={c.onSelect} /> },
  "candidate-detail/1": { span: "col-span-12 xl:col-span-4 xl:row-span-2", height: "max-h-[1140px] overflow-auto", framed: true,
                          render: (w, c) => <Detail widget={w as DetailWidget} selected={c.selected} /> },
  "scatter/1": { span: "col-span-12 md:col-span-6 xl:col-span-5", height: "h-[400px]", framed: true,
                 render: (w, c) => <Scatter widget={w as ScatterWidget} selected={c.selected} onSelect={c.onSelect} /> },
  "notes/1": { span: "col-span-12 md:col-span-6 xl:col-span-3", height: "max-h-[400px] overflow-auto", framed: true,
               render: (w) => <Notes widget={w as NotesWidget} /> },
};

export const UNKNOWN: Entry = {
  span: "col-span-12 md:col-span-4", height: "", framed: true,
  render: (w) => <p className="faint">此渲染器不支持 widget 类型 <span className="mono">{w.type}</span></p>,
};
