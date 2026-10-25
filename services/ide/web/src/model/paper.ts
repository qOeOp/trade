// What a paper run's journal means on the page: each line's category and description, the fills as
// chart markers, the positions as spans, the working orders as price lines and the days as returns.
import { amount, fixed, symbolOf, type JournalLine, type OpenOrder, type OpenPosition, type Precision } from "../lib/paperApi";

export type Category = "system" | "data" | "order" | "position" | "account" | "strategy" | "lifecycle";
export const CATEGORIES: readonly Category[] = ["system", "data", "order", "position", "account", "strategy", "lifecycle"];
export const CATEGORY_LABEL: Record<Category, string> = {
  system: "System", data: "Data", order: "Orders", position: "Positions", account: "Account", strategy: "Strategy", lifecycle: "Lifecycle",
};
const KIND: Record<string, Category> = {
  started: "system", waiting: "system", socket: "system", stop_requested: "system", stopping: "system",
  summary_written: "system", stopped_before_start: "system", data_gap: "data", late_bar: "data", order: "order",
  position: "position", funding_settlement: "account", protection_gap: "strategy", refusal: "strategy",
  instrument_status: "lifecycle",
};
/** A line's category in the Events list; bars and minute snapshots are not events. */
export const categoryOf = (line: JournalLine): Category | null => KIND[line.kind] ?? null;

const MS = 1e6;
/** When the event happened, in ms: the venue's stamp where it has one, else the runner's clock. */
export const eventMs = (line: JournalLine) => Number(line.ts_event ?? line.settlement_ns ?? line.wall_ns) / MS;

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
/** A UTC time as 2026-10-25 14:03:09. */
export function utc(ms: number): string {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const last = (value: unknown) => String(value ?? "").split(".").pop() ?? "";  // OrderSide.BUY → BUY
/** BUY → Buy, LONG → Long, STOP_MARKET → stop market. */
export const word = (value: unknown) => { const w = last(value).toLowerCase().replace(/_/g, " "); return w.charAt(0).toUpperCase() + w.slice(1); };
const NONE: Precision = { price: -1, size: -1 };

/** One line in words, without its time, contract or category; prices and sizes in the contract's decimals. */
export function describe(line: JournalLine, digits: ReadonlyMap<string, Precision> = new Map()): string {
  const f = line, d = digits.get(symbolOf(line.instrument_id)) ?? NONE;
  const qtyPx = (qty: unknown, px: unknown) => `${fixed(qty, d.size) ?? ""}${px != null && px !== "None" ? ` @ ${fixed(px, d.price)}` : ""}`;
  switch (line.kind) {
    case "order": {
      const what = String(f.type ?? "").replace(/^Order/, "");
      if (what === "Filled") return `Filled ${word(f.order_side)} ${qtyPx(f.last_qty, f.last_px)} · ${word(f.order_type).toLowerCase()}`;
      if (what === "Initialized") return `New ${word(f.order_side)} ${word(f.order_type).toLowerCase()} ${qtyPx(f.quantity, f.price ?? f.trigger_price)}${f.reduce_only ? " · reduce only" : ""}`;
      if (what === "Rejected" || what === "Denied") return String(f.reason ?? what);
      return what;
    }
    case "position": {
      const what = String(f.type ?? "").replace(/^Position/, "");
      if (what === "Closed") return `Closed · realized ${fixed(f.realized_pnl, 2) ?? ""} USDT`;
      return `${what} ${word(f.side).toLowerCase()} ${fixed(Math.abs(amount(f.signed_qty) ?? 0), d.size)}${f.avg_px_open ? ` · avg ${fixed(f.avg_px_open, d.price)}` : ""}`;
    }
    case "data_gap": return `${f.missing_bars} one-minute bars missing`;
    case "late_bar": return `Bar ${Math.round(Number(f.late_ns) / 1e9)} s late`;
    case "socket": return `${String(f.endpoint ?? "").replace(/^binance-futures-/, "Binance ").replace(/-/g, " ")} ${word(f.state).toLowerCase()}`;
    case "funding_settlement": return `Funding settled at ${f.stream_rate}, mark ${f.mark ?? "unknown"}`;
    case "protection_gap": return `Position ${f.position} exceeds its stop orders (${f.stop_quantity})`;
    case "refusal": return `Refused: ${f.code}`;
    case "started": return `Started on ${(f.symbols as string[] | undefined)?.length ?? 0} contracts`;
    case "waiting": return `Waiting for the input start, ${utc(Number(f.until_ns) / MS)}`;
    case "stop_requested": return `Stop requested (${f.reason ?? "?"}), ${f.open_orders} working orders`;
    case "stopping": return `Stopping, ${f.open_orders} working orders left`;
    case "summary_written": return `Summary written (${f.stop_reason})`;
    case "stopped_before_start": return `Stopped before the start (${f.reason})`;
    case "instrument_status": return String(f.status ?? "").slice(0, 120);
    default: return line.kind;
  }
}

export type Exit = "stop" | "target" | "other";
export type Fill = { ms: number; symbol: string; buy: boolean; px: number; qty: number; opening: boolean; exit: Exit | null; line: JournalLine };

const exitOf = (orderType: string): Exit =>
  orderType.includes("STOP") ? "stop" : /LIMIT|TAKE_PROFIT/.test(orderType) ? "target" : "other";

/** The fills in journal order, each opening (adding to the position) or closing with how it closed. */
export function fills(lines: readonly JournalLine[]): Fill[] {
  const held = new Map<string, number>();
  const found: Fill[] = [];
  for (const line of lines) {
    if (line.kind !== "order" || line.type !== "OrderFilled") continue;
    const symbol = symbolOf(line.instrument_id), buy = last(line.order_side) === "BUY";
    const qty = amount(line.last_qty) ?? 0, before = held.get(symbol) ?? 0, after = before + (buy ? qty : -qty);
    held.set(symbol, after);
    const opening = Math.abs(after) > Math.abs(before) && Math.sign(after) !== -Math.sign(before);
    found.push({ ms: eventMs(line), symbol, buy, px: amount(line.last_px) ?? 0, qty, opening,
                 exit: opening ? null : exitOf(last(line.order_type)), line });
  }
  return found;
}

/** Where a contract held a position, from its fills: [start, end (null while open), long]. */
export function spans(found: readonly Fill[], symbol: string): [number, number | null, boolean][] {
  const out: [number, number | null, boolean][] = [];
  let held = 0;
  for (const fill of found) {
    if (fill.symbol !== symbol) continue;
    const before = held;
    held += fill.buy ? fill.qty : -fill.qty;
    if (Math.abs(held) < 1e-12) held = 0;
    if (before === 0 && held !== 0) out.push([fill.ms, null, held > 0]);
    else if (before !== 0 && held === 0) { const open = out[out.length - 1]; if (open) open[1] = fill.ms; }
    else if (Math.sign(before) !== Math.sign(held)) {
      const open = out[out.length - 1]; if (open) open[1] = fill.ms;
      out.push([fill.ms, null, held > 0]);
    }
  }
  return out;
}

/** Closed positions that made money, of all closed: a report dimension, never a target. */
export function winRate(lines: readonly JournalLine[]): number | null {
  const closed = lines.filter((l) => l.kind === "position" && l.type === "PositionClosed");
  return closed.length ? closed.filter((l) => (amount(l.realized_pnl) ?? 0) > 0).length / closed.length : null;
}

export type PriceLine = { id: string; price: number; kind: Exit | "entry"; label: string; side: string; quantity: string };
/** A contract's working orders as price lines: stops, targets (reduce-only limits) and limit entries. */
export function priceLines(orders: readonly OpenOrder[], symbol: string): PriceLine[] {
  return orders.filter((o) => symbolOf(o.instrument_id) === symbol).flatMap((o) => {
    const type = last(o.type), stop = type.includes("STOP");
    const price = amount(stop ? o.trigger_price : o.price) ?? amount(o.price);
    if (price == null) return [];
    const kind = stop ? "stop" : o.reduce_only ? "target" : "entry";
    return [{ id: o.client_order_id, price, kind, label: kind === "entry" ? "Entry" : kind === "stop" ? "SL" : "TP", side: last(o.side), quantity: o.quantity }];
  });
}

export type Held = { long: boolean; quantity: number; average: number; pnl: number | null };
/** The contract's open position at the last minute, if it holds one. */
export function heldOf(positions: readonly OpenPosition[], symbol: string): Held | null {
  const p = positions.find((x) => symbolOf(x.instrument_id) === symbol), qty = amount(p?.signed_qty), average = amount(p?.avg_px_open);
  return p && qty && average != null ? { long: qty > 0, quantity: Math.abs(qty), average, pnl: amount(p.unrealized_pnl) } : null;
}

export type Day = { day: string; ret: number; fills: number };
/** Each UTC day's return from the equity path (the last equity of the day over the day before's), with its fills. */
export function days(equity: readonly [number, number][], starting: number, found: readonly Fill[]): Day[] {
  const closes = new Map<string, number>();
  for (const [ns, value] of equity) closes.set(utcDay(ns / MS), value);
  const counts = new Map<string, number>();
  for (const f of found) counts.set(utcDay(f.ms), (counts.get(utcDay(f.ms)) ?? 0) + 1);
  let previous = starting;
  return [...closes].sort(([a], [b]) => a.localeCompare(b)).map(([day, close]) => {
    const ret = close / previous - 1;
    previous = close;
    return { day, ret, fills: counts.get(day) ?? 0 };
  });
}
