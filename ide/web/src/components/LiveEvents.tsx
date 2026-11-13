import type { LiveEventRow } from "../lib/liveTradingDto";
import { dateTime, TIME_ZONE_LABEL } from "../lib/time";
import { eventSideReader } from "../model/liveEventSide";
import { liveEventTime } from "../model/liveEventTime";
import { useTimeZone } from "../state/timeZone";
import { DataTable, columns } from "./DataTable";
import { Section } from "./Section";
import { MISSING } from "../lib/format";

const col = columns<LiveEventRow>();
function TimeHeader() { return <>Time ({TIME_ZONE_LABEL[useTimeZone()]})</>; }
function EventTime({ row }: { row: LiveEventRow }) {
  const zone = useTimeZone(), time = liveEventTime(row);
  return time ? <time dateTime={new Date(time.ms).toISOString()} title={`${time.source === "event" ? "Native event" : "System observation"} · ${time.ns} ns`}>
    {dateTime(time.ms, zone, "millisecond")}{time.source === "observed" && <span className="text-fg-faint"> · observed</span>}
  </time> : <>{MISSING}</>;
}
const eventColumns = (side: (row: LiveEventRow) => string | null | undefined) => [
  col.accessor((row) => liveEventTime(row)?.ns, { id: "time", header: TimeHeader, sortFn: (a, b) => {
    const x = liveEventTime(a.original), y = liveEventTime(b.original);
    return x && y ? (BigInt(x.ns) < BigInt(y.ns) ? -1 : BigInt(x.ns) > BigInt(y.ns) ? 1 : 0) : x ? 1 : y ? -1 : 0;
  }, cell: ({ row }) => <EventTime row={row.original} /> }),
  col.accessor("event_type", { header: "Native event" }),
  col.accessor("instrument_id", { header: "Instrument", cell: ({ getValue }) => getValue() ?? "Unknown" }),
  col.accessor(side, { id: "side", header: "Side", cell: ({ getValue }) => getValue() === undefined ? "—" : getValue() ?? "Unknown" }),
  col.accessor("quantity", { header: "Quantity", cell: ({ getValue }) => getValue() ?? MISSING }),
  col.accessor("last_qty", { header: "Last fill qty", cell: ({ getValue }) => getValue() ?? MISSING }),
  col.accessor("last_px", { header: "Last fill price", cell: ({ getValue }) => getValue() ?? MISSING }),
  col.accessor("client_order_id", { header: "Client order ID", cell: ({ getValue }) => getValue() ?? MISSING }),
  col.accessor("position_id", { header: "Position ID", cell: ({ getValue }) => getValue() ?? MISSING }),
];

export function LiveEvents({ kind, rows, embedded = false }: { kind: "Order" | "Position"; rows: readonly LiveEventRow[] | null | undefined; embedded?: boolean }) {
  const cols = eventColumns(eventSideReader(kind, rows ?? []));
  const body = <>
    <p className="mb-3 text-small text-fg-faint">Up to 200 retained native events. These are not current {kind === "Order" ? "orders" : "positions"}; an empty list does not establish a flat account.</p>
    <p className="mb-3 text-small text-fg-faint">{kind === "Order" ? "Side uses the known direction of the same order. " : ""}For Side, — means no direction is available; Unknown marks invalid or conflicting direction evidence.</p>
    {rows == null ? <p className="text-dense text-fg-muted">Event evidence is unavailable.</p> : rows.length === 0 ? <p className="text-dense text-fg-muted">No retained events of this kind in the returned source.</p>
      : <div className="overflow-x-auto"><DataTable data={[...rows]} columns={cols} rowId={(row) => `${row.event_ref.source}:${row.event_ref.cursor}`} sticky={false} /></div>}
  </>;
  return embedded ? body : <Section title={`${kind} events`} open={false}>{body}</Section>;
}
