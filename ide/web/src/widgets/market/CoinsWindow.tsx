import { useMemo } from "react";
import { change, funding, price, usd } from "../../lib/format";
import { capOf, coinsAt, type Coin } from "../../model/market";
import { marketCoin, useMarketView, useSnapshot } from "../../state/market";
import { useOnMarketPage } from "../../state/shell";
import { pnlClass } from "../../theme/roles";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { Missing } from "../../components/Missing";

const col = columns<Coin>();
const money = (key: "marketCap" | "fdv" | "volume24h", header: string) =>
  col.accessor(key, { header, meta: { numeric: true }, sortUndefined: "last", cell: (c) => (c.getValue() == null ? <Missing /> : usd(c.getValue())) }) as Column<Coin>;
const signed = (key: "change24h" | "funding", header: string, format: (x: number) => string) =>
  col.accessor(key, { header, meta: { numeric: true }, sortUndefined: "last",
    cell: (c) => (c.getValue() == null ? <Missing /> : <span className={pnlClass(c.getValue())}>{format(c.getValue())}</span>) }) as Column<Coin>;

const COLUMNS: Column<Coin>[] = [
  col.accessor("base", { header: "Coin", sortFn: "alphanumeric",
    cell: (c) => <span className="inline-flex min-w-0 gap-2"><span>{c.getValue()}</span><span className="truncate text-fg-faint">{c.row.original.name}</span></span> }) as Column<Coin>,
  col.accessor("sector", { header: "Sector", sortFn: "alphanumeric" }) as Column<Coin>,
  col.accessor("price", { header: "Price", meta: { numeric: true }, cell: (c) => price(c.getValue()) }) as Column<Coin>,
  signed("change24h", "Change 24h", (x) => change(x)),
  signed("funding", "Funding", funding),
  col.accessor(capOf, { id: "cap", header: "Market cap", meta: { numeric: true }, cell: (c) => usd(c.row.original.marketCap ?? c.row.original.fdv) }) as Column<Coin>,
  money("fdv", "FDV"),
  money("volume24h", "Volume 24h"),
];

/** The coins of the level the Market page shows, the folded tail included, as one sortable table; a row
 *  picks its coin as a tile does. Outside the Market page it says where it belongs. */
export function CoinsWindow() {
  const snapshot = useSnapshot(), { path, coin, size } = useMarketView(), page = useOnMarketPage();
  const coins = useMemo(() => (snapshot ? coinsAt(snapshot, path, size) : []), [snapshot, path, size]);
  if (!page) return <p className="p-4 text-fg-faint">The coins of the Market page's level.</p>;
  if (!snapshot) return <p className="p-4 text-fg-faint">Reading the market…</p>;
  return (
    <DataTable data={coins} columns={COLUMNS} rowId={(c) => c.symbol} selected={coin}
               initialSort={[{ id: "cap", desc: true }]} onRow={(c) => marketCoin.set(c.symbol)} />
  );
}
