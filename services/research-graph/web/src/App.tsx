import { useState } from "react";
import type { DetailWidget, View } from "./types";
import { PREDICTION, STATUS } from "./format";
import { REGISTRY, UNKNOWN } from "./widgets/registry";

// Widgets in the order the view lists them; the detail panel sits beside the lineage on wide screens.
const ORDER = ["summary/1", "lineage/1", "candidate-detail/1", "scatter/1", "notes/1"];

export function App({ view }: { view: View }) {
  const detail = view.widgets.find((w) => w.type === "candidate-detail/1") as DetailWidget | undefined;
  const [selected, setSelected] = useState<string | null>(detail?.default ?? null);
  const widgets = [...view.widgets].sort((a, b) => {
    const ia = ORDER.indexOf(a.type), ib = ORDER.indexOf(b.type);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const line = view.line;
  return (
    <div className="mx-auto max-w-[1880px] px-5 py-5">
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">{line.bundle}</h1>
        <div className="muted">
          {[view.source === "ledger" ? "账本视图" : "会话视图", line.start && `起点 ${line.start}`,
            line.window && `开发窗口 ${line.window.join(" → ")}`, line.market_commit && `市场提交 ${line.market_commit.slice(0, 12)}`]
            .filter(Boolean).join(" · ")}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs muted">
          {Object.values(STATUS).map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color, border: "1px solid var(--ink-2)" }} />{s.label}
            </span>
          ))}
          {Object.values(PREDICTION).filter((p) => p.glyph).map((p) => (
            <span key={p.label}><b style={{ color: p.color }}>{p.glyph}</b> {p.label}</span>
          ))}
          <span>浅黄底：推荐保持不变 · 拖动画布平移、滚轮缩放、节点可拖动</span>
        </div>
      </header>
      <main className="grid grid-cols-12 gap-4">
        {widgets.map((w) => {
          const entry = REGISTRY[w.type] ?? UNKNOWN;
          const body = entry.render(w, { selected, onSelect: setSelected });
          return entry.framed ? (
            <section key={w.id} className={`card flex flex-col p-4 ${entry.span}`} data-type={w.type}>
              {w.title && <h2 className="mb-2 text-sm font-semibold">{w.title}</h2>}
              <div className={entry.height || "min-h-0 flex-1"}>{body}</div>
            </section>
          ) : <div key={w.id} className={entry.span}>{body}</div>;
        })}
      </main>
    </div>
  );
}
