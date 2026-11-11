import { useMemo } from "react";
import { change, funding, price, ratio, usd } from "../../lib/format";
import { capOf, coinsAt, type Coin } from "../../model/market";
import { marketCoin, useMarketView, useOverviewService, useSnapshot } from "../../state/market";
import { usePhone } from "../../state/phone";
import { useOnMarketPage } from "../../state/shell";
import { pnlClass } from "../../theme/roles";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { Missing } from "../../components/Missing";

const col = columns<Coin>();
const money = (key: "volume24h" | "oi", header: string) =>
  col.accessor(key, { header, meta: { numeric: true }, sortUndefined: "last", cell: (c) => (c.getValue() == null ? <Missing /> : usd(c.getValue())) }) as Column<Coin>;
const signed = (key: "change1h" | "change4h" | "change24h" | "change7d" | "oiChange24h" | "funding", header: string, format: (x: number) => string) =>
  col.accessor(key, { header, meta: { numeric: true }, sortUndefined: "last",
    cell: (c) => (c.getValue() == null ? <Missing /> : <span className={pnlClass(c.getValue())}>{format(c.getValue())}</span>) }) as Column<Coin>;

const COLUMNS: Column<Coin>[] = [
  col.accessor("base", { header: "Coin", sortFn: "alphanumeric",
    cell: (c) => <span className="inline-flex min-w-0 max-w-full gap-2"><span>{c.getValue()}</span><span className="truncate text-fg-faint">{c.row.original.name}</span></span> }) as Column<Coin>,
  col.accessor((c) => (c.subsector ? `${c.sector} · ${c.subsector}` : c.sector), { id: "sector", header: "Sector", sortFn: "alphanumeric" }) as Column<Coin>,
  col.accessor("price", { header: "Price", meta: { numeric: true }, cell: (c) => price(c.getValue()) }) as Column<Coin>,
  signed("change1h", "1h", (x) => change(x)),
  signed("change4h", "4h", (x) => change(x)),
  signed("change24h", "24h", (x) => change(x)),
  signed("change7d", "7d", (x) => change(x)),
  signed("funding", "Funding", funding),
  money("oi", "OI"),
  signed("oiChange24h", "OI 24h", (x) => change(x)),
  col.accessor("longShort", { header: "L / S", meta: { numeric: true }, sortUndefined: "last", cell: (c) => (c.getValue() == null ? <Missing /> : ratio(c.getValue())) }) as Column<Coin>,
  col.accessor(capOf, { id: "cap", header: "Market cap", meta: { numeric: true }, cell: (c) => usd(c.row.original.marketCap ?? c.row.original.fdv) }) as Column<Coin>,
  money("volume24h", "Volume 24h"),
  col.accessor((c) => c.liquidations.long + c.liquidations.short, { id: "liquidations", header: "Liquidations", meta: { numeric: true },
    cell: (c) => (c.getValue() ? usd(c.getValue()) : <Missing />) }) as Column<Coin>,
];

// A phone's width: the coin, where it stands and what it pays; the rest are in its sheet.
const PHONE_WIDTHS: Record<string, string | undefined> = { base: undefined, price: "w-24", change24h: "w-16", funding: "w-18" };
const PHONE_COLUMNS = COLUMNS.flatMap((c) => {
  const key = (c as { accessorKey?: string }).accessorKey ?? "";
  return key in PHONE_WIDTHS ? [{ ...c, meta: { ...c.meta, width: PHONE_WIDTHS[key] } } as Column<Coin>] : [];
});

/** What the Coins and News windows say before the overview's first snapshot: not served, offline, or reading. */
export function MarketPending() {
  const service = useOverviewService();
  return <p className="p-4 text-fg-faint">{service === "absent" ? "Market data is not served by this IDE."
    : service === "offline" ? "Market data offline. Reconnecting automatically."
    : "Reading the market…"}</p>;
}

/** The coins of the level the Market page shows, the folded tail included, as one sortable table; a row
 *  picks its coin as a tile does. Outside the Market page it says where it belongs. */
export function CoinsWindow() {
  const snapshot = useSnapshot(), { path, coin, size } = useMarketView(), page = useOnMarketPage(), phone = usePhone();
  const coins = useMemo(() => (snapshot ? coinsAt(snapshot, path, size) : []), [snapshot, path, size]);
  if (!page) return <p className="p-4 text-fg-faint">The coins of the Market page's level.</p>;
  if (!snapshot) return <MarketPending />;
  if (!coins.length) return <p className="p-4 text-fg-faint">{path.length ? "This level is not in the latest snapshot." : "No coins in this snapshot."}</p>;
  return (
    <DataTable data={coins} columns={phone ? PHONE_COLUMNS : COLUMNS} rowId={(c) => c.symbol} selected={coin} fixed={phone}
               initialSort={[{ id: "cap", desc: true }]} onRow={(c) => marketCoin.set(c.symbol)} />
  );
}
