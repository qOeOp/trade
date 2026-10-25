import { PanelHeader } from "../components/PanelHeader";
import { atom, useAtom } from "../state/atom";
import type { Side } from "../state/shell";
import { Island } from "./Island";
import type { ToolWindow } from "./toolWindows";

type Shown = ToolWindow & { widget: { id: string; type: string } };
const STILL = atom<unknown>(null);

/** The island of one side, showing its open tool window under a header: its title, controls and
 *  actions. The stripe beside the island switches between the side's tool windows, as in IntelliJ. */
export function ToolWindowIsland({ side, open }: { side: Side; open: Shown }) {
  const { Component } = open.renderer, Tools = open.tools;
  useAtom(open.watch ?? STILL);
  return <Island id={side} header={<PanelHeader title={open.renderer.title} actions={open.actions()}>
    {Tools && <div className="flex min-w-0 flex-1 items-center gap-2"><Tools /></div>}
  </PanelHeader>}><Component widget={open.widget as never} /></Island>;
}
