import type { LiveEventRow } from "../lib/liveTradingDto";
import { DataTable, columns } from "./DataTable";
import { Section } from "./Section";

const col = columns<LiveEventRow>();
const cols = [
  col.accessor("event_type", { header: "Native event" }),
  col.accessor("instrument_id", { header: "Instrument", cell: ({ getValue }) => getValue() ?? "Unknown" }),
  col.accessor((row) => row.order_side ?? row.side ?? null, { id: "side", header: "Side", cell: ({ getValue }) => getValue() ?? "Unknown" }),
  col.accessor("quantity", { header: "Quantity", cell: ({ getValue }) => getValue() ?? "—" }),
  col.accessor("last_qty", { header: "Last fill qty", cell: ({ getValue }) => getValue() ?? "—" }),
  col.accessor("last_px", { header: "Last fill price", cell: ({ getValue }) => getValue() ?? "—" }),
  col.accessor("client_order_id", { header: "Client order ID", cell: ({ getValue }) => getValue() ?? "—" }),
  col.accessor("position_id", { header: "Position ID", cell: ({ getValue }) => getValue() ?? "—" }),
  col.accessor((row) => row.ts_event ?? row.observed_ns, { id: "time", header: "Native / observed (ns)", cell: ({ getValue }) => getValue() ?? "Unknown" }),
];

export function LiveEvents({ kind, rows, embedded = false }: { kind: "Order" | "Position"; rows: readonly LiveEventRow[] | null | undefined; embedded?: boolean }) {
  const body = <>
    <p className="mb-3 text-small text-fg-faint">Up to 200 retained native events. These are not current {kind === "Order" ? "orders" : "positions"}; an empty list does not establish a flat account.</p>
    {rows == null ? <p className="text-dense text-fg-muted">Event evidence is unavailable.</p> : rows.length === 0 ? <p className="text-dense text-fg-muted">No retained events of this kind in the returned source.</p>
      : <div className="overflow-x-auto"><DataTable data={[...rows]} columns={cols} rowId={(row) => `${row.event_ref.source}:${row.event_ref.cursor}`} sticky={false} /></div>}
  </>;
  return embedded ? body : <Section title={`${kind} events`} open={false}>{body}</Section>;
}
