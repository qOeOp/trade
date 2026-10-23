import { useState } from "react";
import { ChevronDown, ChevronUp, Info, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import type { DetailWidget, Focus, View, Widget } from "./types";
import { PREDICTION, STATUS } from "./format";
import { REGISTRY, unknown, type Entry } from "./widgets/registry";

// The shell: a slim top bar, the lineage canvas on the whole screen below it, a right drawer for
// the selected version and a bottom dock whose tabs hold every other widget.
const DOCK_HEIGHT = 360, TAB_HEIGHT = 38, DRAWER_WIDTH = 440;

function Legend({ onClose }: { onClose: () => void }) {
  return (
    <div className="card pointer-events-auto w-60 p-3 text-xs muted shadow-sm">
      <div className="mb-1.5 flex items-center justify-between font-semibold" style={{ color: "var(--ink-1)" }}>
        图例<button onClick={onClose} aria-label="收起图例"><X size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {Object.values(STATUS).map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color, border: "1px solid var(--ink-2)" }} />{s.label}
          </span>
        ))}
        {Object.values(PREDICTION).filter((p) => p.glyph).map((p) => (
          <span key={p.label}><b style={{ color: p.color }}>{p.glyph}</b> {p.label}</span>
        ))}
      </div>
      <div className="mt-2 leading-relaxed">
        浅黄底：推荐保持不变。底部轨道：◆ 推荐判断 · ● 用户消息 · ⓘ 提问 · ▲ 资格变化 · ■ Goal。
        拖动画布平移，滚轮缩放，节点可拖动，点节点看详情。
      </div>
    </div>
  );
}

export function App({ view }: { view: View }) {
  const detail = view.widgets.find((w) => w.type === "candidate-detail/1") as DetailWidget | undefined;
  const [selected, setSelected] = useState<string | null>(detail?.default ?? null);
  const [drawer, setDrawer] = useState(true);
  const [legend, setLegend] = useState(false);
  const entries: [Widget, Entry][] = view.widgets.map((w) => [w, REGISTRY[w.type] ?? unknown(w)]);
  const of = (region: Entry["region"]) => entries.filter(([, e]) => e.region === region);
  const dock = of("dock");
  const [tab, setTab] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const ctx = {
    selected,
    onSelect: (id: string) => { setSelected(id); setDrawer(true); },
    focus,
    onFocus: (f: Omit<Focus, "seq">) => {
      setFocus((prev) => ({ ...f, seq: (prev?.seq ?? 0) + 1 }));
      if (f.candidate) { setSelected(f.candidate); setDrawer(true); }
    },
  };
  const line = view.line;
  const dockHeight = tab ? DOCK_HEIGHT : TAB_HEIGHT;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-6 border-b px-4 py-2.5" style={{ borderColor: "var(--rule)", background: "var(--surface-1)" }}>
        <div className="min-w-0 shrink-0">
          <div className="truncate text-[15px] font-semibold">{line.bundle}</div>
          <div className="truncate text-[11.5px] faint">
            {[view.source === "ledger" ? "账本视图" : "会话视图", line.window && `开发窗口 ${line.window.join(" → ")}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="min-w-0 flex-1">{of("bar").map(([w, e]) => <div key={w.id}>{e.render(w, ctx)}</div>)}</div>
        <button className="shrink-0 muted" onClick={() => setDrawer(!drawer)} title={drawer ? "收起详情" : "展开详情"}>
          {drawer ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0" style={{ bottom: dockHeight, right: drawer ? DRAWER_WIDTH : 0 }}>
          {of("canvas").map(([w, e]) => <div key={w.id} className="h-full w-full">{e.render(w, ctx)}</div>)}
          <div className="pointer-events-none absolute left-3 top-8 z-20">
            {legend ? <Legend onClose={() => setLegend(false)} /> : (
              <button className="card pointer-events-auto p-1.5 muted" onClick={() => setLegend(true)} title="图例"><Info size={16} /></button>
            )}
          </div>
        </div>

        {drawer && (
          <aside className="absolute right-0 top-0 overflow-auto border-l p-3"
                 style={{ width: DRAWER_WIDTH, bottom: dockHeight, borderColor: "var(--rule)", background: "var(--surface-0)" }}>
            {of("drawer").map(([w, e]) => <div key={w.id}>{e.render(w, ctx)}</div>)}
          </aside>
        )}

        <section className="absolute inset-x-0 bottom-0 flex flex-col border-t" style={{ height: dockHeight, borderColor: "var(--rule)", background: "var(--surface-1)" }}>
          <nav className="flex shrink-0 items-center gap-1 px-2" style={{ height: TAB_HEIGHT }}>
            {dock.map(([w, e]) => (
              <button key={w.id} onClick={() => setTab(tab === w.id ? null : w.id)}
                      className="rounded-md px-3 py-1 text-[12.5px]"
                      style={{ background: tab === w.id ? "var(--surface-0)" : undefined, color: tab === w.id ? "var(--ink-1)" : "var(--ink-2)" }}>
                {e.label}
              </button>
            ))}
            <button className="ml-auto muted" onClick={() => setTab(tab ? null : dock[0]?.[0].id ?? null)} title={tab ? "收起" : "展开"}>
              {tab ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </button>
          </nav>
          {tab && (
            <div className="min-h-0 flex-1 overflow-auto px-4 pb-3">
              {dock.filter(([w]) => w.id === tab).map(([w, e]) => <div key={w.id} className="h-full">{e.render(w, ctx)}</div>)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
