// The tool windows: what each shows (a renderer fed by a view-model widget type), where it docks,
// its stripe icon and shortcut, and its header actions. A widget type with no tool window and no
// other place becomes a bottom tool window that names it.
import type { Widget } from "../model/types";
import type { IconName } from "../icons/registry";
import type { HeaderAction } from "../components/PanelHeader";
import { requestFocus } from "../state/linking";
import { selection } from "../state/selection";
import { hideSide, type Side } from "../state/shell";
import { versionTreeControl } from "../state/versionTree";
import { RENDERERS, unknownRenderer, type Renderer } from "../widgets/registry";

export type ToolWindow = {
  id: string; side: Side; icon: IconName; shortcut?: { keys: string; binding: string };
  source: string; renderer: Renderer; actions: () => HeaderAction[];
};

const hide = (side: Side): HeaderAction => ({ id: "hide", icon: "hide", label: "Hide", keys: "⇧Esc", run: () => hideSide(side) });
const alt = (n: number) => ({ keys: `⌥${n}`, binding: `Alt+Digit${n}` });

const SPECS: readonly ToolWindow[] = [
  { id: "versions", side: "left", icon: "tool.versions", shortcut: alt(1), source: "lineage/2", renderer: RENDERERS.tree,
    actions: () => [
      { id: "locate", icon: "locate", label: "Locate the selected version in the tree", run: () => versionTreeControl.get()?.revealSelected() },
      { id: "expand", icon: "expand-all", label: "Expand all", run: () => versionTreeControl.get()?.expandAll() },
      { id: "collapse", icon: "collapse-all", label: "Collapse all", run: () => versionTreeControl.get()?.collapseAll() },
      hide("left"),
    ] },
  { id: "inspector", side: "right", icon: "tool.inspector", shortcut: alt(2), source: "candidate-detail/1", renderer: RENDERERS.detail,
    actions: () => [{ id: "locate", icon: "locate", label: "Locate in graph", run: () => { const id = selection.get(); if (id) requestFocus(id); } }, hide("right")] },
  { id: "progress", side: "bottom", icon: "tool.progress", shortcut: alt(3), source: "progress/1", renderer: RENDERERS.progress, actions: () => [hide("bottom")] },
  { id: "readings", side: "bottom", icon: "tool.readings", shortcut: alt(4), source: "scatter/1", renderer: RENDERERS.scatter, actions: () => [hide("bottom")] },
  { id: "table", side: "bottom", icon: "tool.table", shortcut: alt(5), source: "table/1", renderer: RENDERERS.table, actions: () => [hide("bottom")] },
  { id: "gaps", side: "bottom", icon: "tool.gaps", shortcut: alt(6), source: "notes/1", renderer: RENDERERS.notes, actions: () => [hide("bottom")] },
];

/** The widget types the toolbar and the editor take; everything else is a tool window. */
export const PLACED_ELSEWHERE = new Set(["summary/1", "lineage/2"]);

/** The tool windows this view feeds, in stripe order, each with the widget it shows. */
export function toolWindows(widgets: readonly Widget[]): (ToolWindow & { widget: Widget })[] {
  const known = SPECS.flatMap((s) => {
    const widget = widgets.find((w) => w.type === s.source);
    return widget ? [{ ...s, widget }] : [];
  });
  const claimed = new Set([...SPECS.map((s) => s.source), ...PLACED_ELSEWHERE]);
  const unknown = widgets.filter((w) => !claimed.has(w.type)).map((widget) => ({
    id: `unknown:${widget.type}`, side: "bottom" as const, icon: "tool.gaps" as const, source: widget.type,
    renderer: unknownRenderer(widget), actions: () => [hide("bottom")], widget,
  }));
  return [...known, ...unknown];
}
