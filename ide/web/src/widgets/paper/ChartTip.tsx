import { useAtom, type Atom } from "../../state/atom";
import type { Tip } from "./candleEvents";

const OFF = 14;  // px between the pointer and the tooltip

/** The tooltip of whatever the pointer rests on in a chart: a title and its rows, below and right of the
 *  pointer, or left of or above it where the chart has no room, in the page's tooltip style. */
export function ChartTip({ tip }: { tip: Atom<Tip | null> }) {
  const t = useAtom(tip);
  if (!t) return null;
  // Placed once its size is known: a new function each render, so React calls it on every one.
  const place = (e: HTMLDivElement | null) => {
    const box = e?.parentElement;
    if (!e || !box) return;
    const left = t.x + OFF + e.offsetWidth > box.clientWidth - 70 ? t.x - OFF - e.offsetWidth : t.x + OFF;
    const top = t.y + OFF + e.offsetHeight > box.clientHeight ? t.y - OFF - e.offsetHeight : t.y + OFF;
    Object.assign(e.style, { left: `${Math.max(0, left)}px`, top: `${Math.max(0, top)}px`, visibility: "visible" });
  };
  return (
    <div ref={place} style={{ visibility: "hidden" }}
         className="pointer-events-none absolute z-10 max-w-80 rounded-card border border-popup-border bg-tooltip px-3 py-2 text-dense text-fg shadow-popup">
      <div className="font-semibold">{t.title}</div>
      {t.rows.map((r, i) => <div key={i} className={`tabular-nums ${r.faint ? "text-fg-faint" : ""}`}>{r.text}</div>)}
    </div>
  );
}
