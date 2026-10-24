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
  summary: r("Recommended", Recommendation),
  lineage: r("Lineage", Lineage),
  tree: r("Versions", VersionTree),
  detail: r("Details", Detail),
  progress: r("Progress", Progress),
  scatter: r("Return vs drawdown", Scatter),
  table: r("Version table", VersionTable),
  notes: r("Data gaps", Notes),
} as const;

export const unknownRenderer = (widget: Widget): Renderer => r(widget.title ?? widget.type, Unknown);
