import type { ReactNode } from "react";
import { change, funding, price, ratio, usd } from "../../lib/format";
import { capOf, type Coin, type Snapshot, type VenueRow } from "../../model/market";
import { useCoinDetail } from "../../state/market";
import { pnlClass } from "../../theme/roles";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { KeyValues } from "../../components/KeyValues";
import { Missing } from "../../components/Missing";
import { CardGroup, Section } from "../../components/Section";
import { CoinLine } from "./CoinLine";
import { MarketRuns } from "./MarketRuns";
import { Liquidations } from "./Liquidations";

export const Signed = ({ x, children }: { x: number | null; children: ReactNode }) => <span className={pnlClass(x)}>{children}</span>;
const or = (x: number | null, show: (x: number) => ReactNode) => (x === null ? <Missing /> : show(x));

const col = columns<VenueRow>();
const VENUES: Column<VenueRow>[] = [
  col.accessor("venue", { header: "Exchange", enableSorting: false }) as Column<VenueRow>,
  col.accessor("oi", { header: "Open interest", meta: { numeric: true }, enableSorting: false, cell: (c) => or(c.getValue(), (x) => usd(x)) }) as Column<VenueRow>,
  col.accessor("funding", { header: "Funding", meta: { numeric: true }, enableSorting: false,
    cell: (c) => or(c.getValue(), (x) => <Signed x={x}>{funding(x)}</Signed>) }) as Column<VenueRow>,
  col.accessor("intervalHours", { header: "Every", meta: { numeric: true }, enableSorting: false, cell: (c) => or(c.getValue(), (x) => `${x}h`) }) as Column<VenueRow>,
];

/** The four windows' changes side by side, each under its window. */
const Windows = ({ c }: { c: Coin }) => (
  <div className="mb-1 grid grid-cols-4 gap-2">
    {([["1h", c.change1h], ["4h", c.change4h], ["24h", c.change24h], ["7d", c.change7d]] as const).map(([w, x]) => (
      <div key={w} className="flex flex-col"><span className="text-fg-faint">{w}</span><Signed x={x}>{change(x)}</Signed></div>
    ))}
  </div>
);

/** The picked coin in Details: its Binance perpetual (the windows' changes, funding, open interest and
 *  the long/short ratio), its seven-day line, its open interest and funding on each exchange listing it
 *  with their total, its liquidations by exchange, the coin's market cap and place in its sector, and the
 *  paper runs trading it. */
export function CoinDetails({ c, snapshot }: { c: Coin; snapshot: Snapshot }) {
  const detail = useCoinDetail(c.symbol);
  const peers = snapshot.coins.filter((x) => x.sector === c.sector).sort((a, b) => capOf(b) - capOf(a));
  const total = detail?.venues.reduce((a, v) => a + (v.oi ?? 0), 0) ?? 0;
  return (
    <CardGroup title={`${c.base} · ${c.name}`}>
      <Section title="Perpetual" aside={c.symbol}>
        <KeyValues labels="fixed" items={[["Price", price(c.price)], ["Change", <Windows c={c} />],
          ["Funding", <Signed x={c.funding}>{funding(c.funding)}</Signed>], ["Volume 24h", usd(c.volume24h)],
          ["Open interest", <>{usd(c.oi)} <Signed x={c.oiChange24h}>{change(c.oiChange24h)}</Signed> <span className="text-fg-faint">24h</span></>],
          ["Long / short", c.longShort === null ? null : <>{ratio(c.longShort)} <span className="text-fg-faint">accounts</span></>]]} />
      </Section>
      <Section title="7 days" aside="hourly closes">
        {detail?.line.length ? <CoinLine line={detail.line} /> : <p className="py-2 text-fg-faint">{detail ? "No closes yet" : "Reading…"}</p>}
      </Section>
      <Section title="Exchanges" aside={total ? `${usd(total)} open interest` : undefined}>
        {detail ? <DataTable data={detail.venues} columns={VENUES} rowId={(v) => v.venue} sticky={false} /> : <p className="py-2 text-fg-faint">Reading…</p>}
      </Section>
      <Liquidations sides={c.liquidations} since={snapshot.liquidationsSince} {...(detail ? { venues: detail.venues } : {})} />
      <Section title="Coin">
        <KeyValues labels="fixed" items={[["Market cap", usd(c.marketCap)], ["FDV", usd(c.fdv)],
          ["Sector", `${c.subsector ? `${c.sector} · ${c.subsector}` : c.sector} · #${peers.indexOf(c) + 1} of ${peers.length} by cap`]]} />
      </Section>
      <MarketRuns symbols={[c.symbol]} />
    </CardGroup>
  );
}
