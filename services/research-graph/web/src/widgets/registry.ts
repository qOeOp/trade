// One renderer per view-model widget type: its title and component. Where each appears (toolbar,
// editor, a tool window) is the shell's business (shell/toolWindows.ts). The view model is unchanged.
import type { ComponentType } from "react";
import type { Widget } from "../model/types";
import { Detail } from "./detail/Detail";
import { Lineage } from "./lineage/Lineage";
import { Notes } from "./Notes";
import { Progress } from "./Progress";
import { Recommendation } from "./Recommendation";
import { Scatter } from "./Scatter";
import { Unknown } from "./Unknown";
import { VersionTable } from "./VersionTable";
import { VersionTree } from "./VersionTree";

export type Renderer = { title: string; Component: ComponentType<{ widget: Widget }> };
const r = <W extends Widget>(title: string, Component: ComponentType<{ widget: W }>): Renderer =>
  ({ title, Component: Component as ComponentType<{ widget: Widget }> });

export const RENDERERS = {
  summary: r("当前推荐", Recommendation),
  lineage: r("策略谱系", Lineage),
  tree: r("版本树", VersionTree),
  detail: r("详情", Detail),
  progress: r("研究进展", Progress),
  scatter: r("年化与回撤", Scatter),
  table: r("版本表", VersionTable),
  notes: r("数据缺口", Notes),
} as const;

export const unknownRenderer = (widget: Widget): Renderer => r(widget.title ?? widget.type, Unknown);
