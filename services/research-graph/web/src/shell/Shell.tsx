import { useEffect, useMemo } from "react";
import { Group, Panel, Separator, usePanelRef, type LayoutChangedMeta } from "react-resizable-panels";
import type { LineageWidget } from "../model/types";
import { useView, useWidget } from "../model/view";
import { bind } from "../lib/keys";
import { Toaster } from "../components/Toaster";
import { useLoadNotices } from "./notices";
import { setSideSize, useShell, type Side } from "../state/shell";
import { CommandPalette } from "./CommandPalette";
import { commands } from "./commands";
import { Dimming } from "./Dimming";
import { Editor } from "./Editor";
import { MainToolbar } from "./MainToolbar";
import { StatusBar } from "./StatusBar";
import { Stripe } from "./Stripe";
import { ToolWindowIsland } from "./ToolWindowIsland";
import { toolWindows } from "./toolWindows";

const MIN: Record<Side, number> = { left: 240, right: 300, bottom: 140 };

// The window as IntelliJ lays it out: toolbar and status bar on the frame; between them a stripe on
// each side and the islands: the open left tool window, the editor (the lineage canvas) with the open
// bottom tool window under it, and the open right tool window. A hidden side takes no space; sizes are
// pixels and come back when a side reopens. The window's width bounds every row, so a long name or
// a wide table scrolls or truncates inside its island instead of pushing the sides off screen.
export function Shell() {
  const view = useView();
  const lineage = useWidget<LineageWidget>("lineage/2");
  const windows = useMemo(() => toolWindows(view.widgets), [view]);
  const { open, size } = useShell();
  const actions = useMemo(() => commands(windows), [windows]);
  useLoadNotices();
  useEffect(() => bind(actions.flatMap((a) => (a.binding ? [{ keys: a.binding, run: a.run, whileTyping: a.whileTyping }] : []))), [actions]);
  const shown = (side: Side) => windows.find((w) => w.side === side && w.id === open[side]);
  const left = shown("left"), right = shown("right"), bottom = shown("bottom");
  const refs = { left: usePanelRef(), right: usePanelRef(), bottom: usePanelRef() };
  // Sizes are kept only when the user drags a boundary; re-layouts from opening or closing a side are not.
  const keep = (_: unknown, meta: LayoutChangedMeta) => {
    if (!meta.isUserInteraction) return;
    for (const s of ["left", "right", "bottom"] as const) { const px = refs[s].current?.getSize().inPixels; if (px) setSideSize(s, px); }
  };
  const side = (s: Side, w: NonNullable<typeof left>) => (
    <Panel id={s} panelRef={refs[s]} defaultSize={size[s]} minSize={MIN[s]}>
      <ToolWindowIsland side={s} open={w} windows={windows} />
    </Panel>
  );

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-frame">
      <Dimming />
      <MainToolbar />
      <div className="flex min-h-0 min-w-0">
        <Stripe side="left" windows={windows} />
        <Group key={`${!!left}${!!right}`} orientation="horizontal" className="min-w-0 flex-1" onLayoutChanged={keep}>
          {left && <>{side("left", left)}<Separator /></>}
          <Panel id="centre" minSize="30%">
            <Group key={`${!!bottom}`} orientation="vertical" onLayoutChanged={keep}>
              <Panel id="editor" minSize="25%">
                <Editor />
              </Panel>
              {bottom && <><Separator />{side("bottom", bottom)}</>}
            </Group>
          </Panel>
          {right && <><Separator />{side("right", right)}</>}
        </Group>
        <Stripe side="right" windows={windows} />
      </div>
      <StatusBar />
      <CommandPalette lineage={lineage} actions={actions} />
      <Toaster />
    </div>
  );
}
