import { fixed } from "../../lib/paperApi";
import type { Held, PriceLine } from "../../model/paper";

const SWATCH: Record<PriceLine["kind"] | "average", string> = { target: "bg-meets", stop: "bg-fail", other: "bg-fg-faint", entry: "bg-fg", average: "bg-fg-muted" };
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fixed(Math.abs(n), 2)}`;

/** The chart's price lines named in text at its top left, as a trading chart's legend: the held position
 *  (side, size, average entry, open P&L), then each working order (target, stop, entry) with its price.
 *  A swatch of the line's colour ties each to its line; the text itself stays in the text colours. */
export function ChartLegend({ orders, held, places, size }: { orders: readonly PriceLine[]; held: Held | null; places: number; size: number }) {
  if (!held && !orders.length) return null;
  const sorted = [...orders].sort((a, b) => b.price - a.price);
  return (
    <div className="pointer-events-none absolute left-1 top-1 z-10 flex flex-col gap-0.5 rounded-control bg-island px-1.5 py-1 font-mono text-small">
      {held && (
        <span className="flex items-center gap-1.5">
          <span className={`h-0.5 w-2.5 rounded-full ${SWATCH.average}`} />
          <span className="text-fg">{held.long ? "LONG" : "SHORT"} {fixed(held.quantity, size)}</span>
          <span className="text-fg-muted">@ {fixed(held.average, places)}</span>
          {held.pnl != null && <span className="text-fg">{signed(held.pnl)} USDT</span>}
        </span>
      )}
      {sorted.map((o) => (
        <span key={o.id} className="flex items-center gap-1.5">
          <span className={`h-0.5 w-2.5 rounded-full ${SWATCH[o.kind]}`} />
          <span className="w-5 text-fg-muted">{o.label}</span>
          <span className="text-fg">{fixed(o.price, places)}</span>
          {held && o.kind !== "entry" && <span className="text-fg-faint">{signed((o.price / held.average - 1) * 100)}%</span>}
          {o.kind === "entry" && <span className="text-fg-faint">{o.side} {o.quantity}</span>}
        </span>
      ))}
    </div>
  );
}
