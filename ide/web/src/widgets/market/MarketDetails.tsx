import { useMemo, type ReactNode } from "react";
import { change, funding, plural, price, usd, when } from "../../lib/format";
import { capOf, coinsAt, group, MORE, type Coin, type Snapshot } from "../../model/market";
import { openPath, useMarketView, useOverviewService, useSnapshot } from "../../state/market";
import { pnlClass } from "../../theme/roles";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { KeyValues } from "../../components/KeyValues";
import { CardGroup, Section } from "../../components/Section";

const Signed = ({ x, children }: { x: number | null; children: ReactNode }) => <span className={pnlClass(x)}>{children}</span>;
// A mover must trade this much a day, so a thin contract's jump does not lead the list.
const LIQUID = 5e6;

type Row = { name: string; cap: number; value: number | null; up: number; down: number; coins: number };
const col = columns<Row>();
const SECTORS: Column<Row>[] = [
  col.accessor("name", { header: "Sector", sortFn: "alphanumeric" }) as Column<Row>,
  col.accessor("cap", { header: "Market cap", meta: { numeric: true }, cell: (c) => usd(c.getValue(), 1) }) as Column<Row>,
  col.accessor("value", { header: "24h", meta: { numeric: true }, sortUndefined: "last",
    cell: (c) => <Signed x={c.getValue()}>{change(c.getValue())}</Signed> }) as Column<Row>,
  col.accessor((r) => r.up - r.down, { id: "breadth", header: "↑ / ↓", meta: { numeric: true }, cell: (c) => `${c.row.original.up} / ${c.row.original.down}` }) as Column<Row>,
];

const breadth = (coins: readonly Coin[], title: string) => {
  const g = group("sector", title, [...coins], "marketCap", "change24h");
  return [["Market cap", usd(g.cap)], ["Volume 24h", usd(coins.reduce((a, c) => a + c.volume24h, 0))],
    ["Change 24h", <Signed x={g.value}>{change(g.value)} <span className="text-fg-faint">weighted by cap</span></Signed>],
    ["Median 24h", <Signed x={g.median}>{change(g.median)}</Signed>], ["Up / down", `${g.up} / ${g.down} of ${plural(coins.length, "coin")}`]] as const;
};

/** The five liquid coins that rose most, and the five that fell most. */
function Movers({ coins }: { coins: readonly Coin[] }) {
  const liquid = [...coins].filter((c) => c.volume24h >= LIQUID).sort((a, b) => b.change24h - a.change24h);
  const line = (c: Coin) => [c.base, <Signed key={c.symbol} x={c.change24h}>{change(c.change24h)}</Signed>] as const;
  return (
    <div className="grid grid-cols-2 gap-x-6">
      <KeyValues items={liquid.slice(0, 5).map(line)} />
      <KeyValues items={liquid.slice(-5).reverse().map(line)} />
    </div>
  );
}

function Sources({ snapshot }: { snapshot: Snapshot }) {
  return <KeyValues labels="fixed" items={Object.entries(snapshot.sources).map(([k, s]) => [k, s.error ? <span className="text-fail">{s.error}</span> : when(s.updated)] as const)} />;
}

function CoinDetail({ c, snapshot }: { c: Coin; snapshot: Snapshot }) {
  const peers = snapshot.coins.filter((x) => x.sector === c.sector).sort((a, b) => capOf(b) - capOf(a));
  return (
    <CardGroup title={`${c.base} · ${c.name}`}>
      <Section title="Perpetual" aside={c.symbol}>
        <KeyValues labels="fixed" items={[["Price", price(c.price)], ["Change 24h", <Signed x={c.change24h}>{change(c.change24h)}</Signed>],
          ["Funding", <Signed x={c.funding}>{funding(c.funding)}</Signed>], ["Volume 24h", usd(c.volume24h)]]} />
      </Section>
      <Section title="Coin">
        <KeyValues labels="fixed" items={[["Market cap", usd(c.marketCap)], ["FDV", usd(c.fdv)],
          ["Sector", `${c.sector} · #${peers.indexOf(c) + 1} of ${peers.length} by cap`]]} />
      </Section>
    </CardGroup>
  );
}

/** Details on the Market page: the picked coin, else the level the heatmap shows: its breadth, its
 *  sectors (at All) and its movers; and when each source was last read. */
export function MarketDetails() {
  const snapshot = useSnapshot(), service = useOverviewService(), { path, coin, size } = useMarketView();
  const coins = useMemo(() => (snapshot ? coinsAt(snapshot, path, size) : []), [snapshot, path, size]);
  if (!snapshot) return <p className="p-4 text-fg-faint">{service === "offline" ? "Market data offline" : "Reading the market…"}</p>;
  const picked = coin ? snapshot.coins.find((c) => c.symbol === coin) : undefined;
  const title = path.length ? (path.at(-1) === MORE ? `${path[0]} · the rest` : path[0]!) : "All perpetuals";
  const rows: Row[] = path.length ? [] : snapshot.sectors.flatMap((name) => {
    const g = group("sector", name, snapshot.coins.filter((c) => c.sector === name), "marketCap", "change24h");
    return g.coins.length ? [{ name, cap: g.cap, value: g.value, up: g.up, down: g.down, coins: g.coins.length }] : [];
  });
  return (
    <div className="space-y-3 px-2 pb-3 text-dense">
      {picked && <CoinDetail c={picked} snapshot={snapshot} />}
      <CardGroup title={title}>
        <Section title="Breadth"><KeyValues labels="fixed" items={breadth(coins, title)} /></Section>
        {!!rows.length && (
          <Section title="Sectors" aside={`${rows.length}`}>
            <DataTable data={rows} columns={SECTORS} rowId={(r) => r.name} sticky={false} initialSort={[{ id: "cap", desc: true }]} onRow={(r) => openPath([r.name])} />
          </Section>
        )}
        <Section title="Movers" aside="Volume 24h ≥ $5M"><Movers coins={coins} /></Section>
      </CardGroup>
      <CardGroup title="Sources"><Section title="Last read" open={false}><Sources snapshot={snapshot} /></Section></CardGroup>
    </div>
  );
}
