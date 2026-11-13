import { useTimeZone } from "../../state/timeZone";
import { useMemo } from "react";
import { change, plural, usd, when } from "../../lib/format";
import { coinsAt, group, MORE, splits, subsectorLevel, type Coin, type Snapshot } from "../../model/market";
import { usePhone } from "../../state/phone";
import { openPath, useMarketView, useOverviewService, useSnapshot } from "../../state/market";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { KeyValues } from "../../components/KeyValues";
import { CardGroup, Section } from "../../components/Section";
import { CoinDetails, Signed } from "./CoinDetails";
import { GlobalMarket } from "./GlobalMarket";
import { liquidated, Liquidations } from "./Liquidations";
import { MarketRuns } from "./MarketRuns";
// A mover must trade this much a day, so a thin contract's jump does not lead the list.
const LIQUID = 5e6;

/** A group's row: its market cap, its change over each window weighted by cap, and its 24h breadth. */
type Row = { name: string; cap: number; h1: number | null; h24: number | null; d7: number | null; up: number; down: number };
const row = (name: string, coins: Coin[]): Row => {
  const g = group("sector", name, coins, "marketCap", "change24h");
  return { name, cap: g.cap, h1: group("sector", name, coins, "marketCap", "change1h").value, h24: g.value,
           d7: group("sector", name, coins, "marketCap", "change7d").value, up: g.up, down: g.down };
};
const col = columns<Row>();
const windowColumn = (key: "h1" | "h24" | "d7", header: string) => col.accessor(key, { header, meta: { numeric: true }, sortUndefined: "last",
  cell: (c) => <Signed x={c.getValue()}>{change(c.getValue(), 1)}</Signed> }) as Column<Row>;
const groupColumns = (header: string): Column<Row>[] => [
  col.accessor("name", { header, sortFn: "alphanumeric" }) as Column<Row>,
  col.accessor("cap", { header: "Market cap", meta: { numeric: true }, cell: (c) => usd(c.getValue(), 1) }) as Column<Row>,
  windowColumn("h1", "1h"), windowColumn("h24", "24h"), windowColumn("d7", "7d"),
  col.accessor((r) => r.up - r.down, { id: "breadth", header: "↑ / ↓", meta: { numeric: true }, cell: (c) => `${c.row.original.up} / ${c.row.original.down}` }) as Column<Row>,
];
const SECTORS = groupColumns("Sector"), SUBSECTORS = groupColumns("Sub-sector");

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
  const zone = useTimeZone();
  return <KeyValues labels="fixed" items={Object.entries(snapshot.sources).map(([k, s]) => [k, s.error ? <span className="text-fail-fg">{s.error}</span> : when(s.updated, zone)] as const)} />;
}

/** Details on the Market page: the picked coin, then the level the heatmap shows: at All the whole market
 *  first; its breadth, its sectors (at All) or sub-sectors (in a split sector) with their changes, its
 *  liquidations, its movers and below All the paper runs trading its coins; and when each source was last read.
 *  A phone shows the coin (`level` false) in a sheet over the level. */
export function MarketDetails({ level = true }: { level?: boolean }) {
  const snapshot = useSnapshot(), service = useOverviewService(), { path, coin, size } = useMarketView(), phone = usePhone();
  const coins = useMemo(() => (snapshot ? coinsAt(snapshot, path, size) : []), [snapshot, path, size]);
  if (!snapshot) return <p className="p-4 text-fg-faint">{service === "offline" ? "Market data offline. Reconnecting automatically." : "Reading the market…"}</p>;
  const picked = coin ? snapshot.coins.find((c) => c.symbol === coin) : undefined;
  const names = path.filter((p) => p !== MORE);
  const title = path.length ? `${names.join(" · ")}${path.at(-1) === MORE ? " · the rest" : ""}` : "All perpetuals";
  const sub = path.length === 1 && splits(coins);
  const rows: Row[] = !path.length ? snapshot.sectors.flatMap((name) => { const of = snapshot.coins.filter((c) => c.sector === name); return of.length ? [row(name, of)] : []; })
    : sub ? subsectorLevel(path[0]!, coins, "marketCap", "change24h").map((n) => row(n.name, n.coins)) : [];
  return (
    <div className="space-y-3 px-2 pb-3 text-dense">
      {picked && (level ? !phone : true) && <CoinDetails c={picked} snapshot={snapshot} />}
      {!level ? null : <>
      {!path.length && <CardGroup title="Crypto market"><GlobalMarket g={snapshot.global} /></CardGroup>}
      <CardGroup title={title}>
        <Section title="Breadth"><KeyValues labels="fixed" items={breadth(coins, title)} /></Section>
        {!!rows.length && (
          <Section title={sub ? "Sub-sectors" : "Sectors"} aside={`${rows.length}`}>
            <DataTable data={rows} columns={sub ? SUBSECTORS : SECTORS} rowId={(r) => r.name} sticky={false} initialSort={[{ id: "cap", desc: true }]}
                       onRow={(r) => openPath(sub ? [path[0]!, r.name] : [r.name])} />
          </Section>
        )}
        <Liquidations sides={liquidated(coins)} since={snapshot.liquidationsSince} />
        <Section title="Movers" aside="Volume 24h ≥ $5M"><Movers coins={coins} /></Section>
        {!!path.length && <MarketRuns symbols={coins.map((c) => c.symbol)} />}
      </CardGroup>
      <CardGroup title="Sources"><Section title="Last read" open={false}><Sources snapshot={snapshot} /></Section></CardGroup>
      </>}
    </div>
  );
}
