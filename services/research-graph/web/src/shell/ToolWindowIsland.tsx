import { PanelHeader } from "../components/PanelHeader";
import { TabStrip } from "../components/TabStrip";
import { showToolWindow, type Side } from "../state/shell";
import { Island } from "./Island";
import type { ToolWindow } from "./toolWindows";

type Shown = ToolWindow & { widget: { id: string; type: string } };

/** The island of one side, showing its open tool window under a header: the title (or, at the
 *  bottom, a tab per bottom tool window) and the window's actions. */
export function ToolWindowIsland({ side, open, windows }: { side: Side; open: Shown; windows: readonly Shown[] }) {
  const peers = windows.filter((w) => w.side === side);
  const { Component } = open.renderer;
  const header = side === "bottom" && peers.length > 1
    ? <PanelHeader actions={open.actions()}>
        <TabStrip items={peers.map((w) => ({ id: w.id, label: w.renderer.title }))} active={open.id} onSelect={(id) => showToolWindow(id, side)} />
      </PanelHeader>
    : <PanelHeader title={open.renderer.title} actions={open.actions()} />;
  return <Island id={side} header={header}><Component widget={open.widget as never} /></Island>;
}
