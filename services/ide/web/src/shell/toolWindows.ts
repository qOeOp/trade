// The tool windows: what each shows (a renderer fed by a view-model widget type), where it docks,
// its stripe icon and shortcut, and its header actions. A widget type with no tool window and no
// other place becomes a bottom tool window that names it. The Agent window is fed by the chat
// service instead of the view, so it appears only when the page's server has one.
import type { ComponentType } from "react";
import type { Widget } from "../model/types";
import type { IconName } from "../icons/registry";
import type { HeaderAction } from "../components/PanelHeader";
import { agentPane, chatControl } from "../state/agent";
import { requestFocus } from "../state/linking";
import { selection } from "../state/selection";
import { hideSide, type Side } from "../state/shell";
import type { Atom } from "../state/atom";
import { sourceTreeControl, versionTreeControl, type TreeControl } from "../state/versionTree";
import { RENDERERS, unknownRenderer, type Renderer } from "../widgets/registry";
import { AgentWindow } from "./agent/AgentWindow";

export type ToolWindow = {
  id: string; side: Side; icon: IconName; shortcut?: { keys: string; binding: string };
  source: string; renderer: Renderer; actions: () => HeaderAction[];
  /** Controls the header shows between its title and its actions. */
  tools?: ComponentType;
  /** State the header actions read, so the header redraws when it changes. */
  watch?: Atom<unknown>;
};

const hide = (side: Side): HeaderAction => ({ id: "hide", icon: "hide", label: "Hide", keys: "⇧Esc", run: () => hideSide(side) });
// The tree registers its control after the header has rendered, so each action reads it when it runs.
const treeActions = (tree: Atom<TreeControl | null>): HeaderAction[] => [
  { id: "locate", icon: "locate", label: "Locate the selected version in the tree", run: () => tree.get()?.revealSelected() },
  { id: "expand", icon: "expand-all", label: "Expand all", run: () => tree.get()?.expandAll() },
  { id: "collapse", icon: "collapse-all", label: "Collapse all", run: () => tree.get()?.collapseAll() },
  hide("left"),
];
const alt = (n: number) => ({ keys: `⌥${n}`, binding: `Alt+Digit${n}` });

const SPECS: readonly ToolWindow[] = [
  { id: "versions", side: "left", icon: "tool.versions", shortcut: alt(1), source: "lineage@2", renderer: RENDERERS.tree,
    actions: () => treeActions(versionTreeControl) },
  { id: "sources", side: "left", icon: "tool.sources", shortcut: alt(7), source: "sources@1", renderer: RENDERERS.sources,
    actions: () => treeActions(sourceTreeControl) },
  { id: "inspector", side: "right", icon: "tool.inspector", shortcut: alt(2), source: "candidate-detail@1", renderer: RENDERERS.detail,
    actions: () => [{ id: "locate", icon: "locate", label: "Locate in graph", run: () => { const id = selection.get(); if (id) requestFocus(id); } }, hide("right")] },
  { id: "progress", side: "bottom", icon: "tool.progress", shortcut: alt(3), source: "progress@1", renderer: RENDERERS.progress, actions: () => [hide("bottom")] },
  { id: "readings", side: "bottom", icon: "tool.readings", shortcut: alt(4), source: "scatter@1", renderer: RENDERERS.scatter, actions: () => [hide("bottom")] },
  { id: "table", side: "bottom", icon: "tool.table", shortcut: alt(5), source: "table@1", renderer: RENDERERS.table, actions: () => [hide("bottom")] },
  { id: "gaps", side: "bottom", icon: "tool.gaps", shortcut: alt(6), source: "notes@1", renderer: RENDERERS.notes, actions: () => [hide("bottom")] },
];

const pane = (p: "history" | "settings") => () => agentPane.set(agentPane.get() === p ? "chat" : p);
const AGENT: ToolWindow = {
  id: "agent", side: "right", icon: "tool.agent", shortcut: alt(0), source: "agent",
  renderer: { title: "Agent", Component: AgentWindow }, watch: agentPane as Atom<unknown>,
  actions: () => [
    { id: "new", icon: "new-chat", label: "New chat", run: () => { chatControl.get()?.newThread(); agentPane.set("chat"); } },
    { id: "history", icon: "history", label: "Chats", active: agentPane.get() === "history", run: pane("history") },
    { id: "settings", icon: "settings", label: "Agents", active: agentPane.get() === "settings", run: pane("settings") },
    hide("right"),
  ],
};

/** The widget types the toolbar and the editor take; everything else is a tool window. */
export const PLACED_ELSEWHERE = new Set(["summary@1", "lineage@2"]);

/** The tool windows of the page showing, in stripe order, each with the widget it shows: the left
 *  side's on every page; then the graph's (the Paper page lays out its own cards and has none); with
 *  a chat service, the Agent window last on the right. */
export function toolWindows(widgets: readonly Widget[], agent = false, paper = false): (ToolWindow & { widget: Widget })[] {
  const known = SPECS.flatMap((s) => {
    const widget = widgets.find((w) => w.type === s.source);
    return widget ? [{ ...s, widget }] : [];
  });
  const claimed = new Set([...SPECS.map((s) => s.source), ...PLACED_ELSEWHERE]);
  const unknown = widgets.filter((w) => !claimed.has(w.type)).map((widget) => ({
    id: `unknown:${widget.type}`, side: "bottom" as const, icon: "tool.gaps" as const, source: widget.type,
    renderer: unknownRenderer(widget), actions: () => [hide("bottom")], widget,
  }));
  const own = (w: ToolWindow) => ({ ...w, widget: { id: w.id, type: w.id } });
  const agents = agent ? [own(AGENT)] : [];
  if (!paper) return [...known, ...agents, ...unknown];
  return [...known.filter((w) => w.side === "left"), ...agents];
}
