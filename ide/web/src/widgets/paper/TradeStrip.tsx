import { useRef, useState, type MouseEvent, type WheelEvent } from "react";
import { IconButton } from "../../components/IconButton";
import { fixed } from "../../lib/paperApi";
import type { Closed } from "../../model/trades";
import { pickedTrade, tradesTab } from "../../state/paperStream";
import { pnlClass } from "../../theme/roles";

const PAGE = 30;   // trades a page shows
const NOTCH = 24;  // px of sideways wheel or swipe that move the page one trade
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fixed(Math.abs(n), 2)}`;
const when = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "2-digit" });

/** The closed trades' profit and loss in the order they closed, PAGE at a time (the latest first shown,
 *  at the right), each a bar up or down from zero midway between the line above it and the one under it, on
 *  the page's scale (its largest win or loss half the height), so streaks, the size of wins against
 *  losses and an outlier read at a glance. The page's trades share the width evenly, each bar
 *  centred in its share and three fifths of it wide (1–8px); no line is drawn at zero. A sideways wheel
 *  or swipe moves the page a trade at a time, the arrows a page; under it the page's dates and place.
 *  Above it the count with the best and worst trade, or under the pointer that trade; a click picks it in
 *  Trades, as an arrow on the charts does. */
export function TradeStrip({ trades }: { trades: readonly Closed[] }) {
  const [at, setAt] = useState<number | null>(null), [end, setEnd] = useState<number | null>(null), swept = useRef(0);
  const closed = trades.filter((t) => t.pnl !== null).reverse(), n = closed.length;
  const last = Math.min(n, end ?? n), first = Math.max(0, last - PAGE), shown = closed.slice(first, last);
  if (!shown.length) return <p className="text-small text-fg-faint">No closed trades yet</p>;
  // To `to` (the page's end, exclusive), held within the trades; at the latest it follows new ones.
  const move = (to: number) => { const k = Math.max(Math.min(PAGE, n), Math.min(n, to)); setEnd(k >= n ? null : k); };
  const scale = Math.max(...shown.map((t) => Math.abs(t.pnl!)), 1e-9), pnl = closed.map((t) => t.pnl!);
  const best = Math.max(...pnl), worst = Math.min(...pnl), hovered = at === null ? null : shown[at];
  const index = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(shown.length - 1, Math.floor(((e.clientX - box.left) / box.width) * shown.length)));
  };
  const sweep = (e: WheelEvent<HTMLDivElement>) => {
    if (n <= PAGE || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;  // up and down scroll the panel
    swept.current += e.deltaX;
    const by = Math.trunc(swept.current / NOTCH);
    if (by) { swept.current -= by * NOTCH; move(last + by); }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-small tabular-nums">
        {hovered ? <>
          <span className="truncate text-fg-muted">{hovered.symbol} {hovered.long ? "long" : "short"} · {when.format(hovered.closed)}</span>
          <span className={pnlClass(hovered.pnl)}>{signed(hovered.pnl!)}</span>
        </> : <>
          <span className="text-fg-muted">{n} trades</span>
          <span className="text-fg-faint">best <span className={pnlClass(best)}>{signed(best)}</span> · worst <span className={pnlClass(worst)}>{signed(worst)}</span></span>
        </>}
      </div>
      <div role="img" aria-label={`${n} closed trades, profit and loss each`} className="flex h-28 cursor-pointer py-2"
           onMouseMove={(e) => setAt(index(e))} onMouseLeave={() => setAt(null)} onWheel={sweep}
           onClick={(e) => { pickedTrade.set(shown[index(e)]!.id); tradesTab.set("trades"); }}>
        {shown.map((t, i) => {
          const h = `max(1px, ${(Math.abs(t.pnl!) / scale) * 50}%)`;
          return (
            <span key={t.id} className="relative min-w-0 flex-1">
              <i className={`absolute left-1/2 w-[clamp(1px,60%,8px)] -translate-x-1/2 ${t.pnl! >= 0 ? "bg-pnl-up" : "bg-pnl-down"} ${at === null || at === i ? "" : "opacity-45"}`}
                 style={t.pnl! >= 0 ? { bottom: "50%", height: h } : { top: "50%", height: h }} />
            </span>
          );
        })}
      </div>
      {/* The font's digits sit a pixel low in their line: raised so they centre on the arrows. */}
      {n > PAGE && (
        <div className="flex items-center justify-between gap-3 text-small tabular-nums text-fg-faint">
          <span className="relative -top-px truncate">{day.format(shown[0]!.closed)} – {day.format(shown.at(-1)!.closed)}</span>
          <span className="flex shrink-0 items-center gap-1">
            <IconButton icon="chevron-left" label="Earlier trades" disabled={first === 0} onClick={() => move(last - PAGE)} />
            <span className="relative -top-px text-fg-muted">{first + 1}–{last} <span className="text-fg-faint">of</span> {n}</span>
            <IconButton icon="chevron-right" label="Later trades" disabled={last === n} onClick={() => move(last + PAGE)} />
          </span>
        </div>
      )}
    </div>
  );
}
