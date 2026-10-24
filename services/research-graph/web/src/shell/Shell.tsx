import { useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import type { LineageWidget } from "../model/types";
import { useView, useWidget } from "../model/view";
import { bind } from "../lib/keys";
import { storage } from "../lib/storage";
import { TabStrip } from "../components/TabStrip";
import { rendererOf } from "../widgets/registry";
import { CommandPalette } from "./CommandPalette";
import { commands } from "./commands";
import { Dimming } from "./Dimming";
import { Island } from "./Island";
import { MainToolbar } from "./MainToolbar";
import { StatusBar } from "./StatusBar";

const layoutStorage = { getItem: storage.get, setItem: storage.set };
const COLLAPSED_DOCK = 40;  // the dock collapses to its header row

// The window: toolbar and status bar on the frame, and between them the regions as rounded islands
// 6px apart — the canvas (editor), the dock below it and the inspector beside them; dragging the
// boundary between two islands resizes them. (Step 2 replaces the fixed regions with tool windows.)
export function Shell() {
  const view = useView();
  const lineage = useWidget<LineageWidget>("lineage/2");
  const placed = view.widgets.map((w) => ({ widget: w, renderer: rendererOf(w) }));
  const of = (region: string) => placed.filter((p) => p.renderer.region === region);
  const dock = of("dock");
  const [tab, setTab] = useState(dock[0]?.widget.id ?? null);
  const dockRef = usePanelRef(), inspectorRef = usePanelRef();
  const [dockOpen, setDockOpen] = useState(true), [inspectorOpen, setInspectorOpen] = useState(true);
  const across = useDefaultLayout({ id: "rg-islands-across", storage: layoutStorage });
  const down = useDefaultLayout({ id: "rg-islands-down", storage: layoutStorage });
  const actions = useMemo(() => {
    const toggle = (ref: typeof dockRef) => () => (ref.current?.isCollapsed() ? ref.current.expand() : ref.current?.collapse());
    return commands({ toggleDock: toggle(dockRef), toggleInspector: toggle(inspectorRef) });
  }, [dockRef, inspectorRef]);
  useEffect(() => bind(actions.flatMap((a) => (a.binding ? [{ keys: a.binding, run: a.run, whileTyping: a.id === "palette" }] : []))), [actions]);
  const active = dock.find((d) => d.widget.id === tab) ?? dock[0];

  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto] bg-frame">
      <Dimming />
      <MainToolbar actions={actions} dockOpen={dockOpen} inspectorOpen={inspectorOpen} />
      <Group orientation="horizontal" className="min-h-0 px-(--half-gap)" defaultLayout={across.defaultLayout} onLayoutChanged={across.onLayoutChanged}>
        <Panel id="main" minSize="35">
          <Group orientation="vertical" defaultLayout={down.defaultLayout} onLayoutChanged={down.onLayoutChanged}>
            <Panel id="editor" minSize="25">
              {of("editor").map(({ widget, renderer: { Component } }) => <Island key={widget.id} id="editor"><Component widget={widget} /></Island>)}
            </Panel>
            <Separator />
            <Panel id="dock" panelRef={dockRef} defaultSize="32" minSize="14" collapsible collapsedSize={COLLAPSED_DOCK}
                   onResize={(size) => setDockOpen(size.inPixels > COLLAPSED_DOCK + 1)}>
              <Island id="dock" header={<TabStrip items={dock.map((d) => ({ id: d.widget.id, label: d.renderer.title }))} active={active?.widget.id ?? null}
                                                 onSelect={(id) => { setTab(id); dockRef.current?.expand(); }} />}>
                {active && <active.renderer.Component widget={active.widget} />}
              </Island>
            </Panel>
          </Group>
        </Panel>
        <Separator />
        <Panel id="inspector" panelRef={inspectorRef} defaultSize="27" minSize="18" collapsible collapsedSize={0}
               onResize={(size) => setInspectorOpen(size.inPixels > 1)}>
          {of("inspector").map(({ widget, renderer: { title, Component } }) => (
            <Island key={widget.id} id="inspector" header={<h2 className="text-ui font-semibold">{title}</h2>}><Component widget={widget} /></Island>
          ))}
        </Panel>
      </Group>
      <StatusBar />
      <CommandPalette lineage={lineage} actions={actions} />
    </div>
  );
}
