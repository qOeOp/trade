import { useMemo } from "react";
import { amount, symbolOf, type JournalLine } from "../../lib/paperApi";
import { eventMs, utc } from "../../model/paper";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { Missing } from "../../components/Missing";
import { useStream } from "../../state/paperStream";

const last = (value: unknown) => (value == null ? "" : String(value).split(".").pop() ?? "");
const price = (value: unknown) => (value == null || value === "None" ? <Missing /> : String(value).split(" ")[0]);
const money = (value: unknown) => {
  const n = amount(value);
  return n == null ? <Missing /> : <span className={n < 0 ? "text-fail" : n > 0 ? "text-meets" : ""}>{n.toFixed(2)}</span>;
};
const empty = (what: string) => <p className="p-3 text-dense text-fg-faint">{what}</p>;

type Order = { id: string; ms: number; symbol: string; side: string; type: string; quantity: string; price: unknown; trigger: unknown; reduce: boolean; status: string; working: boolean };
const WORKING = new Set(["Initialized", "Submitted", "Accepted", "Triggered", "Updated", "PendingUpdate", "PendingCancel"]);

/** Every order of the run from its events: what it was (side, type, quantity, price) and its latest status. */
function ordersOf(lines: readonly JournalLine[]): Order[] {
  const found = new Map<string, Order>();
  for (const l of lines) {
    if (l.kind !== "order" || !l.client_order_id) continue;
    const id = String(l.client_order_id), status = String(l.type ?? "").replace(/^Order/, "");
    const o = found.get(id) ?? { id, ms: eventMs(l), symbol: symbolOf(l.instrument_id), side: "", type: "", quantity: "", price: null, trigger: null, reduce: false, status, working: true };
    if (l.order_side) o.side = last(l.order_side);
    if (l.order_type) o.type = last(l.order_type);
    if (l.quantity) o.quantity = String(l.quantity);
    if (l.price !== undefined) o.price = l.price;
    if (l.trigger_price !== undefined) o.trigger = l.trigger_price;
    if (l.reduce_only !== undefined) o.reduce = Boolean(l.reduce_only);
    o.status = status;
    o.working = WORKING.has(status);
    found.set(id, o);
  }
  return [...found.values()];
}

const order = columns<Order>();
const ORDER_COLUMNS: Column<Order>[] = [
  order.accessor("ms", { header: "Time (UTC)", cell: (c) => <span className="font-mono text-small text-fg-faint">{utc(c.getValue())}</span> }) as Column<Order>,
  order.accessor("symbol", { header: "Contract" }) as Column<Order>,
  order.accessor("side", { header: "Side" }) as Column<Order>,
  order.accessor("type", { header: "Type", cell: (c) => `${c.getValue()}${c.row.original.reduce ? " · reduce" : ""}` }) as Column<Order>,
  order.accessor("quantity", { header: "Quantity", meta: { numeric: true } }) as Column<Order>,
  order.accessor((o) => (o.type.includes("STOP") ? o.trigger : o.price), { id: "price", header: "Price", meta: { numeric: true }, cell: (c) => price(c.getValue()) }) as Column<Order>,
  order.accessor("status", { header: "Status", cell: (c) => <span className={c.row.original.working ? "text-fg" : "text-fg-faint"}>{c.getValue()}</span> }) as Column<Order>,
];

/** The run's orders, working ones first, then the rest newest first. */
export function Orders() {
  const s = useStream();
  const rows = useMemo(() => ordersOf(s?.lines ?? []).sort((a, b) => Number(b.working) - Number(a.working) || b.ms - a.ms), [s?.lines]);
  if (!s) return empty("Open a paper run in the Paper panel");
  return rows.length ? <DataTable data={rows} columns={ORDER_COLUMNS} rowId={(o) => o.id} /> : empty("No orders yet");
}

type Position = { id: string; symbol: string; side: string; qty: string; open: unknown; close: unknown; mark: unknown; unrealized: unknown; realized: unknown; ms: number; held: boolean };
const position = columns<Position>();
const POSITION_COLUMNS: Column<Position>[] = [
  position.accessor("symbol", { header: "Contract" }) as Column<Position>,
  position.accessor("side", { header: "Side", cell: (c) => <span className={c.row.original.held ? "text-fg" : "text-fg-faint"}>{c.getValue()}</span> }) as Column<Position>,
  position.accessor("qty", { header: "Quantity", meta: { numeric: true } }) as Column<Position>,
  position.accessor("open", { header: "Avg open", meta: { numeric: true }, cell: (c) => price(c.getValue()) }) as Column<Position>,
  position.accessor((p) => (p.held ? p.mark : p.close), { id: "now", header: "Mark / close", meta: { numeric: true }, cell: (c) => price(c.getValue()) }) as Column<Position>,
  position.accessor("unrealized", { header: "Open P&L", meta: { numeric: true }, cell: (c) => money(c.getValue()) }) as Column<Position>,
  position.accessor("realized", { header: "Realized", meta: { numeric: true }, cell: (c) => money(c.getValue()) }) as Column<Position>,
  position.accessor("ms", { header: "Since (UTC)", cell: (c) => <span className="font-mono text-small text-fg-faint">{utc(c.getValue())}</span> }) as Column<Position>,
];

/** Open positions at the last minute, then the closed ones, newest first. */
export function Positions() {
  const s = useStream();
  const rows = useMemo(() => {
    const open: Position[] = (s?.state?.positions ?? []).map((p) => {
      const opened = s?.lines.find((l) => l.kind === "position" && l.position_id === p.position_id && l.type === "PositionOpened");
      return { id: p.position_id, symbol: symbolOf(p.instrument_id), side: (amount(p.signed_qty) ?? 0) >= 0 ? "LONG" : "SHORT", qty: p.signed_qty,
               open: p.avg_px_open, close: null, mark: p.mark, unrealized: p.unrealized_pnl, realized: p.realized_pnl, ms: opened ? eventMs(opened) : 0, held: true };
    });
    const closed: Position[] = (s?.lines ?? []).filter((l) => l.kind === "position" && l.type === "PositionClosed").map((l, i) => ({
      id: `${String(l.position_id)}-${i}`, symbol: symbolOf(l.instrument_id), side: last(l.side) === "FLAT" ? "Closed" : last(l.side), qty: String(l.quantity ?? ""),
      open: l.avg_px_open, close: l.avg_px_close, mark: null, unrealized: null, realized: l.realized_pnl, ms: eventMs(l), held: false,
    })).reverse();
    return [...open, ...closed];
  }, [s?.state, s?.lines]);
  if (!s) return empty("Open a paper run in the Paper panel");
  return rows.length ? <DataTable data={rows} columns={POSITION_COLUMNS} rowId={(p) => p.id} /> : empty("No positions yet");
}
