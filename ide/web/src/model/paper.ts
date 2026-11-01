// What a paper run's journal means on the page: each line's category and description, the fills as
// chart markers, the positions as spans, the working orders as price lines and the days as returns.
import { brief, clockSpan, plural } from "../lib/format";
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
  instrument_status: "lifecycle", restart: "system",
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
const dayNames = new Map<number, string>();
/** A UTC day as 2026-10-25, each day's name made once (a run's minutes ask for the same few). */
export const utcDay = (ms: number) => {
  const day = Math.floor(ms / 86_400_000);
  let name = dayNames.get(day);
  if (name === undefined) dayNames.set(day, (name = new Date(day * 86_400_000).toISOString().slice(0, 10)));
  return name;
};
/** When a run waiting for its daily warm-up starts on its data (ms): the last `waiting` line's time, else null. */
export function warmupAt(lines: readonly JournalLine[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.kind === "waiting") return Number(lines[i]!.until_ns) / MS;
  return null;
}

export const last = (value: unknown) => String(value ?? "").split(".").pop() ?? "";  // OrderSide.BUY → BUY
/** BUY → Buy, LONG → Long, STOP_MARKET → stop market. */
export const word = (value: unknown) => { const w = last(value).toLowerCase().replace(/_/g, " "); return w.charAt(0).toUpperCase() + w.slice(1); };
const NONE: Precision = { price: -1, size: -1 };

// Who or what asked a run to stop, in words.
const BY: Record<string, string> = { STOP_FILE: "by you", DURATION: "at its set duration", SIGTERM: "by a Docker or host restart", KILLED: "by a Docker or host restart", SIGINT: "by an interrupt" };
const by = (reason: unknown) => BY[String(reason)] ?? `by ${word(reason).toLowerCase()}`;

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
    case "started": return `Started on ${plural((f.symbols as string[] | undefined)?.length ?? 0, "contract")}`;
    case "waiting": return `Waiting for the input start, ${utc(Number(f.until_ns) / MS)}`;
    case "stop_requested": return `Stop requested ${by(f.reason)}, ${plural(Number(f.open_orders ?? 0), "working order")}`;
    case "stopping": return `Stopping, ${f.open_orders} working orders left`;
    case "summary_written": return "Summary written";
    case "stopped_before_start": return `Stopped before the start ${by(f.reason)}`;
    case "instrument_status": return String(f.status ?? "").slice(0, 120);
    case "restart": {
      const on = Array.isArray(f.symbols) ? ` · ${plural(f.symbols.length, "contract")}` : "";
      return `${f.again ?? `Started again after ${brief(clockSpan(Number(f.from_ns) / MS, Number(f.to_ns) / MS))}`}${on}`;
    }
    default: return line.kind;
  }
}

/** A stretch a chain was paused or offline, from the earlier run's stop to the next one's start (ms), with
 *  what happened at the stop and how the next run took over (ending.ts). */
export type Restart = { from: number; to: number; gap: "paused" | "offline"; lead: string; resumed: string };
/** The restarts a joined journal holds (model/chain.ts). */
export const restartsOf = (lines: readonly JournalLine[]): Restart[] =>
  lines.filter((l) => l.kind === "restart").map((l) => ({ from: Number(l.from_ns) / MS, to: Number(l.to_ns) / MS,
    gap: l.gap === "paused" ? "paused" : "offline", lead: String(l.lead ?? ""), resumed: String(l.resumed ?? "restarted") }));

export type Exit = "stop" | "target" | "other";
export type Fill = { ms: number; symbol: string; buy: boolean; px: number; qty: number; opening: boolean; exit: Exit | null; line: JournalLine };

const exitOf = (orderType: string): Exit =>
  orderType.includes("STOP") ? "stop" : /LIMIT|TAKE_PROFIT/.test(orderType) ? "target" : "other";

/** The fills in journal order, each opening (adding to the position) or closing with how it closed; a
 *  restart holds nothing (the account died with the run before it). */
export function fills(lines: readonly JournalLine[]): Fill[] {
  const held = new Map<string, number>();
  const found: Fill[] = [];
  for (const line of lines) {
    if (line.kind === "restart") held.clear();
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

/** Where a contract held a position, from its fills: [start, end (null while open), long]; one still open
 *  at a restart ends where the run before it stopped. */
export function spans(found: readonly Fill[], symbol: string, restarts: readonly Restart[] = []): [number, number | null, boolean][] {
  const out: [number, number | null, boolean][] = [];
  let held = 0, r = 0;
  const upTo = (ms: number) => {
    for (; r < restarts.length && restarts[r]!.from <= ms; r++) if (held !== 0) { held = 0; const open = out[out.length - 1]; if (open) open[1] = restarts[r]!.from; }
  };
  for (const fill of found) {
    if (fill.symbol !== symbol) continue;
    upTo(fill.ms);
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
  upTo(Infinity);
  return out;
}

/** Where any contract held a position between `start` and `end` (ms): every contract's spans joined, an
 *  open one running to `end`, so two held at once count once. */
export function heldUnion(found: readonly Fill[], start: number, end: number, restarts: readonly Restart[] = []): [number, number][] {
  const held = [...new Set(found.map((f) => f.symbol))].flatMap((s) => spans(found, s, restarts).map(([from, to]) => [Math.max(from, start), Math.min(to ?? end, end)] as [number, number]))
    .filter(([x, y]) => y > x).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [x, y] of held) { const top = out.at(-1); if (top && x <= top[1]) top[1] = Math.max(top[1], y); else out.push([x, y]); }
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
