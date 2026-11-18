import { useMemo } from "react";
import { change, funding, price, ratio, usd } from "../../lib/format";
import { capOf, coinsAt, type Coin } from "../../model/market";
import { marketCoin, useMarketView, useOverviewService, useSnapshot } from "../../state/market";
import { useOnMarketPage } from "../../state/shell";
import { pnlClass } from "../../theme/roles";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { Missing, TableSkeleton } from "../../components/Missing";

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

const COIN_HEADS = [["Coin"], ["Sector"], ["Price", true], ["1h", true], ["4h", true], ["24h", true], ["7d", true],
  ["Funding", true], ["OI", true], ["OI 24h", true], ["L / S", true], ["Market cap", true], ["Volume 24h", true], ["Liquidations", true]] as const;

/** What the Coins and News windows say before the overview's first snapshot: not served, offline, or a skeleton. */
export function MarketPending({ headers = COIN_HEADS }: { headers?: readonly (readonly [string, boolean?])[] }) {
  const service = useOverviewService();
  if (service === "absent") return <p className="p-4 text-fg-faint">Market data is not served by this IDE.</p>;
  if (service === "offline") return <p className="p-4 text-fg-faint">Market data offline. Reconnecting automatically.</p>;
  return <TableSkeleton headers={headers} rows={5} />;
}

/** The coins of the level the Market page shows, the folded tail included, as one sortable table; a row
 *  picks its coin as a tile does. Outside the Market page it says where it belongs. */
export function CoinsWindow() {
  const snapshot = useSnapshot(), { path, coin, size } = useMarketView(), page = useOnMarketPage();
  const coins = useMemo(() => (snapshot ? coinsAt(snapshot, path, size) : []), [snapshot, path, size]);
  if (!page) return <p className="p-4 text-fg-faint">The coins of the Market page's level.</p>;
  if (!snapshot) return <MarketPending />;
  if (!coins.length) return <p className="p-4 text-fg-faint">{path.length ? "This level is not in the latest snapshot." : "No coins in this snapshot."}</p>;
  return (
    <DataTable data={coins} columns={COLUMNS} rowId={(c) => c.symbol} selected={coin}
               initialSort={[{ id: "cap", desc: true }]} onRow={(c) => marketCoin.set(c.symbol)} />
  );
}
