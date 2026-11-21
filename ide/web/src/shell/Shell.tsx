import { useEffect, useMemo } from "react";
import { Group, Panel, Separator, usePanelRef, type LayoutChangedMeta } from "react-resizable-panels";
import type { LineageWidget } from "../model/types";
import { useView, useWidget } from "../model/view";
import { bind } from "../lib/keys";
import { useAgentService } from "../state/agent";
import { useOverviewService } from "../state/market";
import { usePaperPanel } from "../state/paper";
import { PaperDialogs } from "../widgets/paper/PaperDialogs";
import { setSideSize, SIDES, useShell, type Side } from "../state/shell";
import { AgentRuntime } from "./agent/AgentRuntime";
import { CommandPalette } from "./CommandPalette";
import { commands } from "./commands";
import { Dimming } from "./Dimming";
import { Editor } from "./Editor";
import { RunDriver } from "./RunDriver";
import { MainToolbar } from "./MainToolbar";
import { StatusBar } from "./StatusBar";
import { Stripe } from "./Stripe";
import { ToolWindowIsland } from "./ToolWindowIsland";
import { toolWindows } from "./toolWindows";

const MIN: Record<Side, number> = { left: 200, right: 260, split: 140, bottom: 140 };
// The editor keeps at least this share of the width: a narrower window shrinks the sides first.
const EDITOR_MIN = "45%";

// The window as IntelliJ lays it out: toolbar and status bar on the frame; between them a stripe on
// each side and the islands: the open left tool window, the editor (the lineage canvas, a source or the
// Runs page) with the open bottom tool window under it, and the open right tool window, or in split mode
// the two right slots one above the other (Details over the Agent). The run the Runs
// page shows is worked out once (RunDriver), as Details, the Trades window and the toolbar read it on
// either page. A hidden side takes no space; sizes are
// pixels and come back when a side reopens. The window's width bounds every row, so a long name or
// a wide table scrolls or truncates inside its island instead of pushing the sides off screen.
export function Shell() {
  const view = useView();
  const lineage = useWidget<LineageWidget>("lineage");
  const agent = useAgentService() === "present";
  const paper = usePaperPanel();
  const overview = useOverviewService(), market = overview === "present" || overview === "offline";
  const { open, size, page, split } = useShell();
  const windows = useMemo(() => toolWindows(view.widgets, agent, market, page, split), [view.widgets, agent, market, page, split]);
  const actions = useMemo(() => commands(windows, market), [windows, market]);
  useEffect(() => bind(actions.flatMap((a) => (a.binding ? [{ keys: a.binding, run: a.run, whileTyping: a.whileTyping }] : []))), [actions]);
  const shown = (side: Side) => windows.find((w) => w.side === side && w.id === open[side]);
  const left = shown("left"), right = shown("right"), lower = shown("split"), bottom = shown("bottom");
  const refs = { left: usePanelRef(), right: usePanelRef(), split: usePanelRef(), bottom: usePanelRef() };
  // Sizes are kept only when the user drags a boundary; re-layouts from opening or closing a side are not.
  const keep = (_: unknown, meta: LayoutChangedMeta) => {
    if (!meta.isUserInteraction) return;
    for (const s of SIDES) { const px = refs[s].current?.getSize().inPixels; if (px) setSideSize(s, px); }
  };
  const side = (s: Side, w: NonNullable<typeof left>) => (
    <Panel id={s} panelRef={refs[s]} defaultSize={size[s]} minSize={MIN[s]}>
      <ToolWindowIsland side={s} open={w} />
    </Panel>
  );
  // The right side's width is the right slot's size; with both slots open, the lower one keeps its height.
  const rightSide = right && lower
    ? <Panel id="right" panelRef={refs.right} defaultSize={size.right} minSize={MIN.right}>
        <Group orientation="vertical" onLayoutChanged={keep}>
          <Panel id="right-top" minSize={MIN.split}><ToolWindowIsland side="right" open={right} /></Panel>
          <Separator />{side("split", lower)}
        </Group>
      </Panel>
    : right ? side("right", right)
    : lower && <Panel id="right" panelRef={refs.right} defaultSize={size.right} minSize={MIN.right}><ToolWindowIsland side="split" open={lower} /></Panel>;

  const frame = (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-frame">
      <Dimming />
      <RunDriver />
      <MainToolbar />
      <div className="flex min-h-0 min-w-0">
        <Stripe side="left" windows={windows} actions={actions} />
        <Group orientation="horizontal" className="min-w-0 flex-1" onLayoutChanged={keep}>
          {left && <>{side("left", left)}<Separator /></>}
          <Panel id="centre" minSize={EDITOR_MIN}>
            <Group orientation="vertical" onLayoutChanged={keep}>
              <Panel id="editor" minSize="25%">
                <Editor />
              </Panel>
              {bottom && <><Separator />{side("bottom", bottom)}</>}
            </Group>
          </Panel>
          {rightSide && <><Separator />{rightSide}</>}
        </Group>
        <Stripe side="right" windows={windows} actions={actions} />
      </div>
      <StatusBar />
      <CommandPalette lineage={lineage} actions={actions} />
      {paper && <PaperDialogs />}
    </div>
  );
  // The chat runtime sits above the islands, so a thread keeps streaming while its window is closed.
  return agent ? <AgentRuntime>{frame}</AgentRuntime> : frame;
}
