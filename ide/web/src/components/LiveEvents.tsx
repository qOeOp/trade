import type { LiveEventRow } from "../lib/liveTradingDto";
import { dateTime, TIME_ZONE_LABEL } from "../lib/time";
import { liveEventTime } from "../model/liveEventTime";
import { useTimeZone } from "../state/timeZone";
import { DataTable, columns } from "./DataTable";
import { Section } from "./Section";

const col = columns<LiveEventRow>();
function TimeHeader() { return <>Time ({TIME_ZONE_LABEL[useTimeZone()]})</>; }
function EventTime({ row }: { row: LiveEventRow }) {
  const zone = useTimeZone(), time = liveEventTime(row);
  return time ? <time dateTime={new Date(time.ms).toISOString()} title={`${time.source === "event" ? "Native event" : "System observation"} · ${time.ns} ns`}>
    {dateTime(time.ms, zone, "millisecond")}{time.source === "observed" && <span className="text-fg-faint"> · observed</span>}
  </time> : <>—</>;
}
const cols = [
  col.accessor((row) => liveEventTime(row)?.ns, { id: "time", header: TimeHeader, sortFn: (a, b) => {
    const x = liveEventTime(a.original), y = liveEventTime(b.original);
    return x && y ? (BigInt(x.ns) < BigInt(y.ns) ? -1 : BigInt(x.ns) > BigInt(y.ns) ? 1 : 0) : x ? 1 : y ? -1 : 0;
  }, cell: ({ row }) => <EventTime row={row.original} /> }),
  col.accessor("event_type", { header: "Native event" }),
  col.accessor("instrument_id", { header: "Instrument", cell: ({ getValue }) => getValue() ?? "Unknown" }),
  col.accessor((row) => row.order_side ?? row.side ?? null, { id: "side", header: "Side", cell: ({ getValue }) => getValue() ?? "Unknown" }),
  col.accessor("quantity", { header: "Quantity", cell: ({ getValue }) => getValue() ?? "—" }),
  col.accessor("last_qty", { header: "Last fill qty", cell: ({ getValue }) => getValue() ?? "—" }),
  col.accessor("last_px", { header: "Last fill price", cell: ({ getValue }) => getValue() ?? "—" }),
  col.accessor("client_order_id", { header: "Client order ID", cell: ({ getValue }) => getValue() ?? "—" }),
  col.accessor("position_id", { header: "Position ID", cell: ({ getValue }) => getValue() ?? "—" }),
];

export function LiveEvents({ kind, rows, embedded = false }: { kind: "Order" | "Position"; rows: readonly LiveEventRow[] | null | undefined; embedded?: boolean }) {
  const body = <>
    <p className="mb-3 text-small text-fg-faint">Up to 200 retained native events. These are not current {kind === "Order" ? "orders" : "positions"}; an empty list does not establish a flat account.</p>
    {rows == null ? <p className="text-dense text-fg-muted">Event evidence is unavailable.</p> : rows.length === 0 ? <p className="text-dense text-fg-muted">No retained events of this kind in the returned source.</p>
      : <div className="overflow-x-auto"><DataTable data={[...rows]} columns={cols} rowId={(row) => `${row.event_ref.source}:${row.event_ref.cursor}`} sticky={false} /></div>}
  </>;
  return embedded ? body : <Section title={`${kind} events`} open={false}>{body}</Section>;
}
