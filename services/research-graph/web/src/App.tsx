import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { Tooltip } from "radix-ui";
import { tinykeys } from "tinykeys";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import {
  ChevronDown, ChevronUp, Command as CommandIcon, GitBranch, Monitor, Moon, PanelBottom, PanelRight, Sun,
} from "lucide-react";
import type { DetailWidget, LineageWidget, SummaryWidget, View, Widget } from "./types";
import { pct, readingColor, ROLE, verdict } from "./format";
import { requestFocus, useHovered } from "./store";
import { RoleMark, Tip } from "./ui";
import { REGISTRY, unknown, type Entry } from "./widgets/registry";

// The shell, laid out like an IDE: a title bar with the line and its readout, the lineage canvas
// with a resizable bottom panel (table, scatter, gaps) and an inspector on the right, and a status
// bar. Panels resize, collapse and remember their sizes; ⌘K jumps anywhere.
const TAB = 30;

// Browser storage may be missing or blocked (private windows, previews): the page works without it.
const storage = {
  getItem: (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } },
  setItem: (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* ignore */ } },
};

type Theme = "system" | "light" | "dark";
const THEMES: Theme[] = ["system", "light", "dark"];

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (storage.getItem("rg-theme") as Theme) || "system");
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    storage.setItem("rg-theme", theme);
  }, [theme]);
  return [theme, () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])] as const;
}

function Dimming() {
  const hovered = useHovered();
  if (!hovered) return null;
  const id = CSS.escape(hovered);
  return <style>{`.rg [data-v]{opacity:.22} .rg [data-v="${id}"]{opacity:1} .rg .react-flow__edge{opacity:.25}`}</style>;
}

function IconButton({ label, keys, active, onClick, children }: {
  label: string; keys?: string; active?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <Tip content={<span>{label}{keys && <span className="kbd ml-2">{keys}</span>}</span>} side="bottom">
      <button className="press grid h-7 w-7 place-items-center" onClick={onClick} aria-label={label}
              style={{ color: active ? "var(--ink-1)" : "var(--ink-3)" }}>{children}</button>
    </Tip>
  );
}

function Palette({ open, onOpenChange, lineage, onSelect, actions }: {
  open: boolean; onOpenChange: (open: boolean) => void; lineage?: LineageWidget; onSelect: (id: string) => void;
  actions: { label: string; keys?: string; run: () => void }[];
}) {
  const nodes = useMemo(() => [...(lineage?.nodes ?? [])].sort((a, b) => (b.x ?? -1) - (a.x ?? -1)), [lineage]);
  const close = (run: () => void) => () => { onOpenChange(false); run(); };
  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="跳转或执行命令"
                    overlayClassName="fixed inset-0 z-40 bg-black/20"
                    contentClassName="float fixed left-1/2 top-[14%] z-50 w-[620px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden p-0">
      <Command.Input placeholder="版本名、改动内容或命令…" autoFocus
                     className="w-full border-b bg-transparent px-3.5 py-2.5 text-[13.5px] outline-none" style={{ borderColor: "var(--rule)" }} />
      <Command.List className="max-h-[380px] overflow-auto p-1">
        <Command.Empty className="px-3 py-6 text-center faint">没有匹配的版本或命令</Command.Empty>
        <Command.Group heading="命令">
          {actions.map((a) => (
            <Command.Item key={a.label} onSelect={close(a.run)} className="flex cursor-pointer items-center rounded px-2.5 py-1.5 muted">
              {a.label}{a.keys && <span className="kbd ml-auto">{a.keys}</span>}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading={`版本 · ${nodes.length}`}>
          {nodes.map((n) => {
            const ok = verdict(n.reading, lineage?.targets ?? null);
            return (
              <Command.Item key={n.id} value={`${n.id} ${n.change ?? ""}`} onSelect={close(() => { onSelect(n.id); requestFocus(n.id); })}
                            className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5">
                <RoleMark role={n.role} size={12} />
                <span className="mono shrink-0 text-[12.5px]">{n.id}</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] faint">{n.change}</span>
                {n.reading.annual_return != null && (
                  <span className="mono shrink-0 text-[11px]">
                    <span style={{ color: readingColor(ok.ret) }}>{pct(n.reading.annual_return)}</span>
                    <span className="ghost"> │ </span>
                    <span style={{ color: readingColor(ok.dd) }}>{pct(n.reading.max_drawdown)}</span>
                  </span>
                )}
              </Command.Item>
            );
          })}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function StatusBar({ view, lineage, summary, selected }: { view: View; lineage?: LineageWidget; summary?: SummaryWidget; selected: string | null }) {
  const hovered = useHovered();
  const focus = lineage?.nodes.find((n) => n.id === (hovered ?? selected));
  const ok = focus ? verdict(focus.reading, lineage?.targets ?? null) : null;
  const commit = view.scope?.ledger_commit;
  return (
    <footer className="flex h-[22px] shrink-0 items-center gap-4 border-t px-2.5 text-[11px] faint" style={{ borderColor: "var(--rule)", background: "var(--panel)" }}>
      <span className="inline-flex items-center gap-1"><GitBranch size={11} />{view.source === "ledger" ? "账本" : "会话"}</span>
      {commit && <Tip content={`账本提交 ${commit}`}><span className="mono">{commit.slice(0, 8)}</span></Tip>}
      {view.line.window && <span className="mono">{view.line.window.join(" → ")}</span>}
      {summary && <span>{summary.versions} 个版本 · {summary.research_runs} 次研究运行 · {summary.masked_runs} 次失去资格</span>}
      {focus && (
        <span className="ml-auto inline-flex items-center gap-1.5 muted">
          <RoleMark role={focus.role} size={11} />
          <span className="mono">{focus.id}</span>
          <span>{ROLE[focus.role]?.label}</span>
          {focus.reading.annual_return != null && ok && (
            <span className="mono"><span style={{ color: readingColor(ok.ret) }}>{pct(focus.reading.annual_return)}</span>
              <span className="ghost"> │ </span><span style={{ color: readingColor(ok.dd) }}>{pct(focus.reading.max_drawdown)}</span></span>
          )}
        </span>
      )}
    </footer>
  );
}

export function App({ view }: { view: View }) {
  const detail = view.widgets.find((w) => w.type === "candidate-detail/1") as DetailWidget | undefined;
  const lineage = view.widgets.find((w) => w.type === "lineage/2") as LineageWidget | undefined;
  const summary = view.widgets.find((w) => w.type === "summary/1") as SummaryWidget | undefined;
  const [selected, setSelected] = useState<string | null>(detail?.default ?? null);
  const [palette, setPalette] = useState(false);
  const [theme, cycleTheme] = useTheme();
  const entries: [Widget, Entry][] = view.widgets.map((w) => [w, REGISTRY[w.type] ?? unknown(w)]);
  const of = (region: Entry["region"]) => entries.filter(([, e]) => e.region === region);
  const dock = of("dock");
  const [tab, setTab] = useState<string>(dock[0]?.[0].id ?? "");
  const dockRef = usePanelRef(), drawerRef = usePanelRef();
  const [dockOpen, setDockOpen] = useState(true), [drawerOpen, setDrawerOpen] = useState(true);
  const across = useDefaultLayout({ id: "rg-across", storage }), down = useDefaultLayout({ id: "rg-down", storage });
  const ctx = { selected, onSelect: (id: string) => { setSelected(id); drawerRef.current?.expand(); }, targets: view.targets };
  const toggle = (ref: typeof dockRef) => () => (ref.current?.isCollapsed() ? ref.current.expand() : ref.current?.collapse());
  const current = lineage?.trail.at(-1)?.candidate;
  const actions = [
    ...(current ? [{ label: "定位当前推荐", keys: ".", run: () => requestFocus(current) }] : []),
    { label: "回到横轴起点", keys: "Home", run: () => requestFocus("") },
    { label: drawerOpen ? "收起详情" : "展开详情", keys: "⌘B", run: toggle(drawerRef) },
    { label: dockOpen ? "收起底部面板" : "展开底部面板", keys: "⌘J", run: toggle(dockRef) },
    ...dock.map(([w, e]) => ({ label: `底部面板：${e.label}`, run: () => { setTab(w.id); dockRef.current?.expand(); } })),
    { label: `切换主题（现在：${{ system: "跟随系统", light: "浅色", dark: "深色" }[theme]}）`, run: cycleTheme },
  ];

  useEffect(() => tinykeys(window, {
    "$mod+KeyK": (e) => { e.preventDefault(); setPalette((open) => !open); },
    "$mod+KeyB": (e) => { e.preventDefault(); toggle(drawerRef)(); },
    "$mod+KeyJ": (e) => { e.preventDefault(); toggle(dockRef)(); },
    Period: (e) => { if (!typing(e) && current) requestFocus(current); },
    Home: (e) => { if (!typing(e)) requestFocus(""); },
  }), [current]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <div className="rg flex h-full flex-col overflow-hidden">
        <Dimming />
        <header className="flex h-10 shrink-0 items-center gap-4 border-b pl-3 pr-1.5" style={{ borderColor: "var(--rule)", background: "var(--panel)" }}>
          <Tip content={view.line.bundle} side="bottom">
            <div className="flex min-w-0 shrink items-baseline gap-2">
              <span className="mono truncate text-[12.5px] font-semibold">{view.line.bundle.replace(/^research-line-/, "")}</span>
              {view.line.start && <span className="mono hidden truncate text-[11px] faint xl:inline">起点 {view.line.start}</span>}
            </div>
          </Tip>
          <span className="h-4 w-px shrink-0" style={{ background: "var(--rule-2)" }} />
          <div className="min-w-0 flex-1">{of("bar").map(([w, e]) => <div key={w.id}>{e.render(w, ctx)}</div>)}</div>
          <button className="press inline-flex shrink-0 items-center gap-2 border px-2 py-1 text-[11.5px] faint"
                  style={{ borderColor: "var(--rule-2)" }} onClick={() => setPalette(true)}>
            <CommandIcon size={12} />跳转…<span className="kbd">⌘K</span>
          </button>
          <div className="flex shrink-0 items-center">
            <IconButton label="底部面板" keys="⌘J" active={dockOpen} onClick={toggle(dockRef)}><PanelBottom size={15} /></IconButton>
            <IconButton label="详情" keys="⌘B" active={drawerOpen} onClick={toggle(drawerRef)}><PanelRight size={15} /></IconButton>
            <IconButton label={`主题：${{ system: "跟随系统", light: "浅色", dark: "深色" }[theme]}`} onClick={cycleTheme}>
              {theme === "system" ? <Monitor size={14} /> : theme === "light" ? <Sun size={14} /> : <Moon size={14} />}
            </IconButton>
          </div>
        </header>

        <Group orientation="horizontal" className="min-h-0 flex-1" defaultLayout={across.defaultLayout} onLayoutChanged={across.onLayoutChanged}>
          <Panel id="main" minSize="35">
            <Group orientation="vertical" defaultLayout={down.defaultLayout} onLayoutChanged={down.onLayoutChanged}>
              <Panel id="canvas" minSize="25">
                {of("canvas").map(([w, e]) => <div key={w.id} className="h-full">{e.render(w, ctx)}</div>)}
              </Panel>
              <Separator />
              <Panel id="dock" panelRef={dockRef} defaultSize="30" minSize="14" collapsible collapsedSize={TAB}
                     onResize={(size) => setDockOpen(size.inPixels > TAB + 1)}>
                <section className="flex h-full flex-col" style={{ background: "var(--panel)" }}>
                  <nav className="flex shrink-0 items-stretch border-b px-1" style={{ height: TAB, borderColor: "var(--rule)" }}>
                    {dock.map(([w, e]) => (
                      <button key={w.id} onClick={() => { setTab(w.id); dockRef.current?.expand(); }}
                              className="relative px-3 text-[12px] transition-colors duration-150"
                              style={{ color: tab === w.id && dockOpen ? "var(--ink-1)" : "var(--ink-3)" }}>
                        {e.label}
                        <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full transition-opacity duration-150"
                              style={{ background: "var(--accent)", opacity: tab === w.id && dockOpen ? 1 : 0 }} />
                      </button>
                    ))}
                    <button className="press my-1 ml-auto grid w-7 place-items-center faint" onClick={toggle(dockRef)} aria-label={dockOpen ? "收起" : "展开"}>
                      {dockOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                  </nav>
                  <div className="min-h-0 flex-1 overflow-auto">
                    {dock.filter(([w]) => w.id === tab).map(([w, e]) => <div key={w.id} className="h-full">{e.render(w, ctx)}</div>)}
                  </div>
                </section>
              </Panel>
            </Group>
          </Panel>
          <Separator />
          <Panel id="inspector" panelRef={drawerRef} defaultSize="27" minSize="18" collapsible collapsedSize={0}
                 onResize={(size) => setDrawerOpen(size.inPixels > 1)}>
            <aside className="h-full overflow-auto" style={{ background: "var(--panel)" }}>
              {of("drawer").map(([w, e]) => <div key={w.id}>{e.render(w, ctx)}</div>)}
            </aside>
          </Panel>
        </Group>

        <StatusBar view={view} lineage={lineage} summary={summary} selected={selected} />
        <Palette open={palette} onOpenChange={setPalette} lineage={lineage} onSelect={ctx.onSelect} actions={actions} />
      </div>
    </Tooltip.Provider>
  );
}

function typing(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}
