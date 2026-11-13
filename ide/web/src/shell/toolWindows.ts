// The tool windows: what each shows (a renderer fed by a view-model widget type), where it docks,
// its stripe icon and shortcut, and its header actions. Some are fed by the page instead of the view:
// Trades, the stage the Runs page shows (state/shown.ts), Coins and News, the Market page's level (with an
// overview service), and the Agent, by the chat service, so it appears only when the page's server has
// one. Bottom tools belong to the editor page that supplies their context.
import type { ComponentType } from "react";
import type { Widget } from "../model/types";
import { bottomToolOnPage, type ToolPage } from "../model/toolScope";
import type { IconName } from "../icons/registry";
import type { HeaderAction } from "../components/PanelHeader";
import { agentPane, chatControl } from "../state/agent";
import { requestFocus } from "../state/linking";
import { selection } from "../state/selection";
import { hideSide, type Side } from "../state/shell";
import type { Atom } from "../state/atom";
import { sourceTreeControl, versionTreeControl, type TreeControl } from "../state/versionTree";
import { RENDERERS, type Renderer } from "../widgets/registry";
import { CoinsWindow } from "../widgets/market/CoinsWindow";
import { NewsTools, NewsWindow } from "../widgets/market/NewsWindow";
import { TradesTools, TradesWindow } from "../widgets/paper/TradesWindow";
import { AgentWindow } from "./agent/AgentWindow";

export type ToolWindow = {
  id: string; side: Side; icon: IconName; shortcut?: { keys: string; binding: string };
  source: string; renderer: Renderer; actions: () => HeaderAction[];
  /** Controls the header shows between its title and its actions; `titled` when they bring their own
   *  title (tabs, the first of which names the window). */
  tools?: ComponentType; titled?: boolean;
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
  { id: "versions", side: "left", icon: "tool.versions", shortcut: alt(1), source: "lineage", renderer: RENDERERS.tree,
    actions: () => treeActions(versionTreeControl) },
  { id: "sources", side: "left", icon: "tool.sources", shortcut: alt(7), source: "sources", renderer: RENDERERS.sources,
    actions: () => treeActions(sourceTreeControl) },
  { id: "inspector", side: "right", icon: "tool.inspector", shortcut: alt(2), source: "candidate-detail", renderer: RENDERERS.detail,
    actions: () => [{ id: "locate", icon: "locate", label: "Locate in graph", run: () => { const id = selection.get(); if (id) requestFocus(id); } }, hide("right")] },
  { id: "progress", side: "bottom", icon: "tool.progress", shortcut: alt(3), source: "progress", renderer: RENDERERS.progress, actions: () => [hide("bottom")] },
  { id: "readings", side: "bottom", icon: "tool.readings", shortcut: alt(4), source: "scatter", renderer: RENDERERS.scatter, actions: () => [hide("bottom")] },
  { id: "table", side: "bottom", icon: "tool.table", shortcut: alt(5), source: "table", renderer: RENDERERS.table, actions: () => [hide("bottom")] },
  { id: "gaps", side: "bottom", icon: "tool.gaps", shortcut: alt(6), source: "notes", renderer: RENDERERS.notes, actions: () => [hide("bottom")] },
];

const TRADES: ToolWindow = {
  id: "trades", side: "bottom", icon: "tool.trades", shortcut: alt(9), source: "trades",
  renderer: { title: "Trades", Component: TradesWindow }, tools: TradesTools, titled: true, actions: () => [hide("bottom")],
};

const COINS: ToolWindow = {
  id: "coins", side: "bottom", icon: "tool.coins", source: "coins", renderer: { title: "Coins", Component: CoinsWindow }, actions: () => [hide("bottom")],
};
const NEWS: ToolWindow = {
  id: "news", side: "bottom", icon: "tool.news", source: "news", renderer: { title: "News", Component: NewsWindow }, tools: NewsTools, titled: true,
  actions: () => [hide("bottom")],
};

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

/** The tool windows in stripe order, each with the widget it shows: the view's, then Trades; with an
 *  overview service, Coins and News; with a chat service, the Agent window last on the right. */
export function toolWindows(widgets: readonly Widget[], agent = false, market = false, page: ToolPage = "research"): (ToolWindow & { widget: Widget })[] {
  const known = SPECS.flatMap((s) => {
    const widget = widgets.find((w) => w.type === s.source);
    if (widget) return [{ ...s, widget }];
    // Runs and Market show their own details, so Details stays without a line's view.
    return (page === "runs" || page === "market") && s.id === "inspector"
      ? [{ ...s, widget: { id: `${page}-details`, type: "candidate-detail", items: [], default: null } }] : [];
  });
  const own = (w: ToolWindow) => ({ ...w, widget: { id: w.id, type: w.id } });
  return [...known, own(TRADES), ...(market ? [own(COINS), own(NEWS)] : []), ...(agent ? [own(AGENT)] : [])]
    .filter((w) => w.side !== "bottom" || bottomToolOnPage(w.id, page));
}
