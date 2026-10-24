import { PanelHeader } from "../components/PanelHeader";
import type { Side } from "../state/shell";
import { Island } from "./Island";
import type { ToolWindow } from "./toolWindows";

type Shown = ToolWindow & { widget: { id: string; type: string } };

/** The island of one side, showing its open tool window under a header: its title and actions. The
 *  stripe beside the island switches between the side's tool windows, as in IntelliJ. */
export function ToolWindowIsland({ side, open }: { side: Side; open: Shown }) {
  const { Component } = open.renderer;
  return <Island id={side} header={<PanelHeader title={open.renderer.title} actions={open.actions()} />}><Component widget={open.widget as never} /></Island>;
}
