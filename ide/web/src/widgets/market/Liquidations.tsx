import { dateTime, utcInstant, type TimeZone } from "../../lib/time";
import { useTimeZone } from "../../state/timeZone";
import { usd } from "../../lib/format";
import type { Coin, Sides, VenueRow } from "../../model/market";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { KeyValues } from "../../components/KeyValues";
import { Section } from "../../components/Section";

const DAY_MS = 86_400_000;
type Liquidated = { venue: string } & Sides;
const col = columns<Liquidated>();
const BY_VENUE: Column<Liquidated>[] = [
  col.accessor("venue", { header: "Exchange", enableSorting: false }) as Column<Liquidated>,
  col.accessor("long", { header: "Longs", meta: { numeric: true }, enableSorting: false, cell: (c) => usd(c.getValue()) }) as Column<Liquidated>,
  col.accessor("short", { header: "Shorts", meta: { numeric: true }, enableSorting: false, cell: (c) => usd(c.getValue()) }) as Column<Liquidated>,
];

export const liquidated = (coins: readonly Coin[]): Sides =>
  coins.reduce((a, c) => ({ long: a.long + c.liquidations.long, short: a.short + c.liquidations.short }), { long: 0, short: 0 });

/** The window the figures cover: 24h once recording has run a day, else since it began (UTC). */
const span = (since: string | null, zone: TimeZone) => (!since ? "connecting" : Date.now() - (utcInstant(since) ?? NaN) >= DAY_MS ? "24h" : `since ${dateTime(utcInstant(since), zone, "minute")}`);

/** An amount in its side's colour (longs in the falling one, as liquidation charts draw a long closed
 *  out), a side with none muted. */
const amount = (x: number, tone: string) => <span className={x ? tone : "text-fg-faint"}>{usd(x)}</span>;

/** Liquidations in a card: the total by the window, a bar of longs against shorts with each side's
 *  amount, a coin's by exchange, and what the figures leave out. */
export function Liquidations({ sides, since, venues }: { sides: Sides; since: string | null; venues?: readonly VenueRow[] }) {
  const zone = useTimeZone();
  const total = sides.long + sides.short, rows = venues?.flatMap((v) => (v.liquidations ? [{ venue: v.venue, ...v.liquidations }] : [])) ?? [];
  return (
    <Section title="Liquidations" aside={`${usd(total)} · ${span(since, zone)}`}>
      <div className="mb-1.5 flex h-1 gap-0.5 overflow-hidden rounded-full bg-hover">
        {total > 0 && <><i className="block bg-pnl-down" style={{ flex: sides.long }} /><i className="block bg-pnl-up" style={{ flex: sides.short }} /></>}
      </div>
      <KeyValues labels="fixed" items={[["Longs", amount(sides.long, "text-pnl-down")], ["Shorts", amount(sides.short, "text-pnl-up")]]} />
      {!!rows.length && <div className="mt-2"><DataTable data={rows} columns={BY_VENUE} rowId={(v) => v.venue} sticky={false} /></div>}
      <p className="mt-2 text-small text-fg-faint">Binance, Bybit and OKX since connecting, Binance's and OKX's in part; Gate's the whole day.</p>
    </Section>
  );
}
