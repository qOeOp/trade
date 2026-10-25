// What each of the run's levels on a contract chart says: the position by side, size and open P&L; a
// target or stop by name and what the position books if it fills (by its distance from the last price
// while flat); a limit entry by side, size and distance. Prices and sizes in the contract's decimals,
// U+2212 minus.
import { fixed } from "../../lib/paperApi";
import type { Held, PriceLine } from "../../model/paper";
import type { seriesColors } from "./chartTheme";
import type { Level, Part } from "./levels";

type Colors = ReturnType<typeof seriesColors>;
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
export const signed = (n: number, digits: number) => `${sign(n)}${fixed(Math.abs(n), digits)}`;
const percent = (n: number) => `${sign(n)}${Math.abs(n * 100).toFixed(2)}%`;

/** The levels, given the held position (with the time of its entry bar) and the last price. */
export function chartLevels({ orders, held, from, mark, places, size, c }: {
  orders: readonly PriceLine[]; held: Held | null; from: number | null; mark: number | null; places: number; size: number; c: Colors;
}): Level[] {
  const away = (price: number) => (mark ? percent(price / mark - 1) : "");
  const levels: Level[] = orders.map((o) => {
    const price = fixed(o.price, places) ?? "";
    if (o.kind === "entry") {
      const name = `${o.side === "BUY" ? "Buy" : "Sell"} ${fixed(o.quantity, size)}`;
      return { id: o.id, price: o.price, color: c.limit, parts: [{ text: name, color: c.fg }, { text: away(o.price), color: c.limit }],
               pinned: `${name} ${price} · ${away(o.price)}`, axis: price, tag: c.limitTag, tagText: c.limit };
    }
    const stop = o.kind === "stop", color = stop ? c.pnlDown : c.pnlUp, name = stop ? "Stop" : "Target";
    const made = held ? (o.price - held.average) * held.quantity * (held.long ? 1 : -1) : null;
    const parts: Part[] = [{ text: name, color }, { text: made === null ? away(o.price) : signed(made, 2), color: c.muted }];
    return { id: o.id, price: o.price, color, parts, pinned: `${name} ${price} · ${away(o.price)}`, axis: price,
             tag: stop ? c.downTag : c.upTag, tagText: color };
  });
  if (held) {
    const side = held.long ? "Long" : "Short", qty = fixed(held.quantity, size) ?? "";
    const parts: Part[] = [{ text: side, color: held.long ? c.up : c.down }, { text: qty, color: c.fg }];
    if (held.pnl !== null) parts.push({ text: signed(held.pnl, 2), color: held.pnl >= 0 ? c.pnlUp : c.pnlDown });
    levels.push({ id: "average", price: held.average, color: c.position, parts, from: from ?? undefined,
                  pinned: `${side} ${qty} @ ${fixed(held.average, places)}`, axis: fixed(held.average, places) ?? "", tag: c.tag, tagText: c.fg });
  }
  return levels;
}
