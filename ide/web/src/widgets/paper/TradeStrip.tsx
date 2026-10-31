import { useState, type MouseEvent } from "react";
import { fixed } from "../../lib/paperApi";
import type { Closed } from "../../model/trades";
import { pickedTrade, tradesTab } from "../../state/paperStream";
import { pnlClass } from "../../theme/roles";

const MOST = 120;  // trades shown, the latest
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fixed(Math.abs(n), 2)}`;
const when = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The closed trades' profit and loss in the order they closed, each a bar up or down from zero on one
 *  scale (the latest MOST, the latest at the right, none wider than 8px), so streaks, the size of wins
 *  against losses and an outlier read at a glance, lower with few trades. Above it the count with the best
 *  and worst trade, or under the pointer that trade; a click picks it in Trades, as an arrow on the
 *  charts does. */
export function TradeStrip({ trades }: { trades: readonly Closed[] }) {
  const [at, setAt] = useState<number | null>(null);
  const closed = trades.filter((t) => t.pnl !== null).reverse(), shown = closed.slice(-MOST);
  if (!shown.length) return <p className="text-small text-fg-faint">No closed trades yet</p>;
  const scale = Math.max(...shown.map((t) => Math.abs(t.pnl!)), 1e-9), pnl = closed.map((t) => t.pnl!);
  const best = Math.max(...pnl), worst = Math.min(...pnl), hovered = at === null ? null : shown[at];
  const index = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(shown.length - 1, Math.floor(((e.clientX - box.left) / box.width) * shown.length)));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-small tabular-nums">
        {hovered ? <>
          <span className="truncate text-fg-muted">{hovered.symbol} {hovered.long ? "long" : "short"} · {when.format(hovered.closed)}</span>
          <span className={pnlClass(hovered.pnl)}>{signed(hovered.pnl!)}</span>
        </> : <>
          <span className="text-fg-muted">{closed.length > MOST ? <>Last {MOST} <span className="text-fg-faint">of</span> {closed.length}</> : `${closed.length} trades`}</span>
          <span className="text-fg-faint">best <span className={pnlClass(best)}>{signed(best)}</span> · worst <span className={pnlClass(worst)}>{signed(worst)}</span></span>
        </>}
      </div>
      <div role="img" aria-label={`${closed.length} closed trades, profit and loss each`} className={`relative flex cursor-pointer justify-end ${shown.length < 20 ? "h-10" : "h-14"} ${shown.length > 60 ? "gap-px" : "gap-0.5"}`}
           onMouseMove={(e) => setAt(index(e))} onMouseLeave={() => setAt(null)}
           onClick={(e) => { pickedTrade.set(shown[index(e)]!.id); tradesTab.set("trades"); }}>
        <i className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
        {shown.map((t, i) => {
          const h = `max(1px, ${(Math.abs(t.pnl!) / scale) * 48}%)`;
          return (
            <span key={t.id} className="relative max-w-2 min-w-px flex-1">
              <i className={`absolute inset-x-0 ${t.pnl! >= 0 ? "bg-pnl-up" : "bg-pnl-down"} ${at === null || at === i ? "" : "opacity-45"}`}
                 style={t.pnl! >= 0 ? { bottom: "50%", height: h } : { top: "50%", height: h }} />
            </span>
          );
        })}
      </div>
    </div>
  );
}
