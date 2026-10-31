// The run's trading as the Positions window shows it: what it holds with the orders protecting each
// position, entries still working, and the closed trades with how each ended.
import { amount, symbolOf, type JournalLine, type OpenOrder, type OpenPosition } from "../lib/paperApi";
import { eventMs, last, type Exit } from "./paper";

export type Working = { id: string; kind: Exit | "entry"; side: string; type: string; quantity: string; price: number | null };
export type Open = {
  id: string; symbol: string; long: boolean; quantity: number; average: number | null; mark: number | null;
  pnl: number | null; fees: number | null; since: number; atStop: boolean; orders: Working[];
};
export type Closed = { id: string; symbol: string; long: boolean; quantity: number; entry: number | null; exit: number | null; pnl: number | null; opened: number; closed: number; how: Exit };

const TYPE: Record<string, string> = { MARKET: "Market", LIMIT: "Limit", STOP_MARKET: "Stop market", STOP_LIMIT: "Stop limit", MARKET_IF_TOUCHED: "If touched", LIMIT_IF_TOUCHED: "Limit if touched" };
/** STOP_MARKET → Stop market. */
export const orderType = (raw: unknown) => TYPE[last(raw)] ?? last(raw);
const kindOf = (o: OpenOrder): Working["kind"] => (last(o.type).includes("STOP") ? "stop" : o.reduce_only ? "target" : "entry");
const working = (o: OpenOrder): Working => ({
  id: o.client_order_id, kind: kindOf(o), side: last(o.side), type: orderType(o.type), quantity: o.quantity,
  price: amount(kindOf(o) === "stop" ? o.trigger_price : o.price) ?? amount(o.price),
});

/** The latest PositionOpened time of each position id before `until`. */
function openedAt(lines: readonly JournalLine[], positionId: unknown, until = Infinity): number {
  let at = 0;
  for (const l of lines) if (l.kind === "position" && l.type === "PositionOpened" && l.position_id === positionId && eventMs(l) <= until) at = eventMs(l);
  return at;
}

/** Open positions at the last minute (or, for a sealed run, those its journal leaves open at the stop),
 *  each with its working reduce-only orders; then the entries working without a position. */
export function holdings(lines: readonly JournalLine[], positions: readonly OpenPosition[] | null, orders: readonly OpenOrder[], sealed: boolean) {
  const open: Open[] = [];
  if (sealed) {
    const latest = new Map<string, JournalLine>();
    for (const l of lines) if (l.kind === "position" && l.position_id) latest.set(String(l.position_id), l);
    for (const l of latest.values()) {
      if (l.type === "PositionClosed") continue;
      const qty = amount(l.signed_qty) ?? 0;
      open.push({ id: String(l.position_id), symbol: symbolOf(l.instrument_id), long: qty >= 0, quantity: Math.abs(qty), average: amount(l.avg_px_open),
                  mark: null, pnl: null, fees: amount(l.realized_pnl), since: openedAt(lines, l.position_id), atStop: true, orders: [] });
    }
  } else {
    for (const p of positions ?? []) {
      const qty = amount(p.signed_qty) ?? 0, symbol = symbolOf(p.instrument_id);
      open.push({ id: p.position_id, symbol, long: qty >= 0, quantity: Math.abs(qty), average: amount(p.avg_px_open), mark: amount(p.mark),
                  pnl: amount(p.unrealized_pnl), fees: amount(p.realized_pnl), since: openedAt(lines, p.position_id), atStop: false,
                  orders: orders.filter((o) => symbolOf(o.instrument_id) === symbol && o.reduce_only).map(working).sort((a, b) => (b.price ?? 0) - (a.price ?? 0)) });
    }
  }
  const held = new Set(open.map((p) => p.symbol));
  const pending = sealed ? [] : orders.filter((o) => !o.reduce_only && !held.has(symbolOf(o.instrument_id))).map((o) => ({ ...working(o), symbol: symbolOf(o.instrument_id) }));
  return { open, pending };
}

/** Each closed position as a trade: its side and size, entry and exit, realized P&L (fees included), how
 *  long it was held and what closed it (the closing order's kind), newest first. One pass over the lines,
 *  and once a list of lines (the Account, the Trades window and its card all ask). */
export function trades(lines: readonly JournalLine[]): Closed[] {
  const known = made.get(lines);
  if (known) return known;
  const orderType = new Map<string, string>(), filled = new Map<string, number>(), side = new Map<string, unknown>(), opened = new Map<string, number[]>();
  const closes: JournalLine[] = [];
  for (const l of lines) {
    if (l.kind === "position") {
      if (l.type === "PositionOpened") { const at = opened.get(String(l.position_id)) ?? []; at.push(eventMs(l)); opened.set(String(l.position_id), at); }
      else if (l.type === "PositionClosed") closes.push(l);
    }
    if (l.kind !== "order" || !l.client_order_id) continue;
    const id = String(l.client_order_id);
    if (l.order_side && !side.has(id)) side.set(id, l.order_side);
    if (l.order_type) orderType.set(id, last(l.order_type));
    if (l.type === "OrderFilled") filled.set(id, (filled.get(id) ?? 0) + (amount(l.last_qty) ?? 0));
  }
  const found = closes.map((l, i) => {
    const closing = String(l.closing_order_id ?? ""), type = orderType.get(closing) ?? "", openingSide = side.get(String(l.opening_order_id ?? "")), closed = eventMs(l);
    // The latest opening at or before the close.
    const opening = (opened.get(String(l.position_id)) ?? []).reduce((at, t) => (t <= closed && t > at ? t : at), 0);
    return {
      id: `${String(l.position_id)}-${i}`, symbol: symbolOf(l.instrument_id), long: openingSide ? last(openingSide) === "BUY" : true,
      quantity: filled.get(closing) ?? 0, entry: amount(l.avg_px_open), exit: amount(l.avg_px_close), pnl: amount(l.realized_pnl),
      opened: opening, closed,
      how: type.includes("STOP") ? "stop" as const : /LIMIT|TAKE_PROFIT/.test(type) ? "target" as const : "other" as const,
    };
  }).reverse();
  made.set(lines, found);
  return found;
}
const made = new WeakMap<readonly JournalLine[], Closed[]>();

/** A duration as 2d 4h, 3h 12m or 45m. */
export function span(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000)), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}
