import { useMemo, type ReactNode } from "react";
import { change, funding, price, ratio, usd } from "../../lib/format";
import { capOf, coinsAt, type Coin } from "../../model/market";
import { heldWords, type LocalContract } from "../../model/marketLocal";
import { marketCoin, useMarketView, useOverviewService, useSnapshot } from "../../state/market";
import { useMarketLocal } from "../../state/marketLocal";
import { Icon } from "../../icons/Icon";
import { Tip } from "../../ui/Tip";
import { useOnMarketPage } from "../../state/shell";
import { pnlClass } from "../../theme/roles";
import { columns, DataTable, type Column } from "../../ui/DataTable";
import { Missing, TableSkeleton } from "../../ui/Missing";

/** A coin's row: the overview's coin and, when the market directory holds its bars, that contract (null: not held or unknown). */
type Row = Coin & { local: LocalContract | null };
const col = columns<Row>();
const money = (key: "volume24h" | "oi", header: string) =>
  col.accessor(key, { header, meta: { numeric: true }, sortUndefined: "last", cell: (c) => (c.getValue() == null ? <Missing /> : usd(c.getValue())) }) as Column<Row>;
const signed = (key: "change1h" | "change4h" | "change24h" | "change7d" | "oiChange24h" | "funding", header: string, format: (x: number) => string) =>
  col.accessor(key, { header, meta: { numeric: true }, sortUndefined: "last",
    cell: (c) => (c.getValue() == null ? <Missing /> : <span className={pnlClass(c.getValue())}>{format(c.getValue())}</span>) }) as Column<Row>;

const COLUMNS: Column<Row>[] = [
  col.accessor("base", { header: "Coin", sortFn: "alphanumeric",
    cell: (c) => <span className="inline-flex min-w-0 max-w-full gap-2"><span>{c.getValue()}</span><span className="max-w-16 truncate text-fg-faint" title={c.row.original.name}>{c.row.original.name}</span></span> }) as Column<Row>,
  col.accessor((c) => (c.subsector ? `${c.sector} · ${c.subsector}` : c.sector), { id: "sector", header: "Sector", sortFn: "alphanumeric" }) as Column<Row>,
  col.accessor("price", { header: "Price", meta: { numeric: true }, cell: (c) => price(c.getValue()) }) as Column<Row>,
  signed("change1h", "1h", (x) => change(x)),
  signed("change4h", "4h", (x) => change(x)),
  signed("change24h", "24h", (x) => change(x)),
  signed("change7d", "7d", (x) => change(x)),
  signed("funding", "Funding", funding),
  money("oi", "OI"),
  signed("oiChange24h", "OI 24h", (x) => change(x)),
  col.accessor("longShort", { header: "L / S", meta: { numeric: true }, sortUndefined: "last", cell: (c) => (c.getValue() == null ? <Missing /> : ratio(c.getValue())) }) as Column<Row>,
  col.accessor(capOf, { id: "cap", header: "Market cap", meta: { numeric: true }, cell: (c) => usd(c.row.original.marketCap ?? c.row.original.fdv) }) as Column<Row>,
  money("volume24h", "Volume 24h"),
  col.accessor((c) => c.liquidations.long + c.liquidations.short, { id: "liquidations", header: "Liquidations", meta: { numeric: true },
    cell: (c) => (c.getValue() ? usd(c.getValue()) : <Missing />) }) as Column<Row>,
];

/** What the Market windows say while the overview service is not to be had: not served or offline; null otherwise. */
export const marketDown = (service: ReturnType<typeof useOverviewService>): string | null =>
  service === "absent" ? "Market data is not served by this IDE." : service === "offline" ? "Market data offline. Reconnecting automatically." : null;

/** What a Market window shows before the overview's first snapshot: that the service is down, else `children`. */
export function MarketPending({ children }: { children: ReactNode }) {
  const down = marketDown(useOverviewService());
  return down ? <p className="p-4 text-fg-faint">{down}</p> : <>{children}</>;
}

/** The Local column, headed by its mark alone so the table keeps its width: the mark on each coin the market directory
 *  holds bars of, its span in the tooltip; a coin it does not hold reads as any other empty cell. */
const localMark = (label: string) => <span role="img" aria-label={label} className="inline-flex align-middle text-fg-muted"><Icon name="local-data" size={12} /></span>;
const localColumn = (marketDay: string) => (col.accessor((c) => (c.local ? 1 : 0), { id: "local",
  header: () => <Tip content="Bars held in the local market directory">{localMark("Local")}</Tip>,
  cell: (c) => { const held = c.row.original.local;
    return held ? <Tip content={heldWords(held, marketDay)}>{localMark("Bars held locally")}</Tip> : <Missing />; } }) as Column<Row>);

/** The coins of the level the Market page shows, the folded tail included, as one sortable table; a row
 *  picks its coin as a tile does. Outside the Market page it says where it belongs. */
export function CoinsWindow() {
  const snapshot = useSnapshot(), { path, coin, size } = useMarketView(), page = useOnMarketPage();
  const local = useMarketLocal();
  const coins = useMemo(() => (snapshot ? coinsAt(snapshot, path, size) : []).map((c): Row => ({ ...c, local: local?.held.get(c.symbol) ?? null })),
    [snapshot, path, size, local]);
  const columns = useMemo(() => (local ? [COLUMNS[0]!, localColumn(local.marketDay), ...COLUMNS.slice(1)] : COLUMNS), [local]);
  if (!page) return <p className="p-4 text-fg-faint">The coins of the Market page's level.</p>;
  if (!snapshot) return <MarketPending><TableSkeleton cols={COLUMNS.length} /></MarketPending>;
  if (!coins.length) return <p className="p-4 text-fg-faint">{path.length ? "This level is not in the latest snapshot." : "No coins in this snapshot."}</p>;
  return (
    <DataTable data={coins} columns={columns} rowId={(c) => c.symbol} selected={coin}
               initialSort={[{ id: "cap", desc: true }]} onRow={(c) => marketCoin.set(c.symbol)} />
  );
}
