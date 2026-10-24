// One renderer per view-model widget type, and where it goes in the shell for now (step 1 keeps
// today's regions; tool windows replace them in step 2). The view model is unchanged.
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

export type Region = "toolbar" | "editor" | "inspector" | "dock";
export type Renderer = { region: Region; title: string; Component: ComponentType<{ widget: Widget }> };

const r = <W extends Widget>(region: Region, title: string, Component: ComponentType<{ widget: W }>): Renderer =>
  ({ region, title, Component: Component as ComponentType<{ widget: Widget }> });

export const RENDERERS: Record<string, Renderer> = {
  "summary/1": r("toolbar", "当前推荐", Recommendation),
  "lineage/2": r("editor", "策略谱系", Lineage),
  "candidate-detail/1": r("inspector", "版本详情", Detail),
  "progress/1": r("dock", "研究进展", Progress),
  "scatter/1": r("dock", "年化 vs 回撤", Scatter),
  "table/1": r("dock", "版本表", VersionTable),
  "notes/1": r("dock", "数据缺口", Notes),
};

export const rendererOf = (widget: Widget): Renderer => RENDERERS[widget.type] ?? r("dock", widget.title ?? widget.type, Unknown);
