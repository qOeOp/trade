import { Fragment, type ReactNode } from "react";
import { meets } from "../../model/semantics";
import { span } from "../../model/trades";
import { signed } from "../../lib/paperApi";
import { pnlClass } from "../../theme/roles";
import { Missing } from "../../components/Missing";
import { Tip } from "../../components/Tip";

const STEPS = 5;  // the drawdown track is graduated in fifths of the limit

type N = number | null | undefined;
/** One stage's readings. `account` and `stats` are absent where the page has none (the graph page),
 *  their values null until read; `stale` ones are held unseen while the next report is read. `dd` is the
 *  drawdown at the end (`ended`) or when last seen, or the run's stop. */
export type Facts = {
  basis: string; limit: number | null; minimum: number | null;
  mdd: N; annual: N; short?: number; sharpe: N; winRate: N;
  account?: { ret: N; needed: N; ahead: N; usdt: N; dd: N | "stop"; ended: boolean; stale: boolean };
  stats?: { pf: N; avgWin: N; avgLoss: N; perTrade: N; hold: N; inMarket: N; streak: N; stale: boolean };
};

/** A paper run's return is annualized once it has run this long. */
export const ANNUAL_DAYS = 30;
const digits = (n: number) => (Math.abs(n) * 100).toFixed(2);
const pct = (n: number, places = 2) => `${(Math.abs(n) * 100).toFixed(places)}%`;
const sign = (n: number, plus = true) => (n > 0 && plus ? "+" : n < 0 ? "−" : "");
const shown = (n: N, text: (n: number) => ReactNode) => (n == null ? <Missing /> : text(n));
const amount = (n: N) => shown(n, (v) => <span className={pnlClass(v)}>{signed(v)}</span>);
const Said = ({ ok, yes, no }: { ok: boolean; yes: string; no: string }) => <span className={ok ? "text-meets" : "text-misses"}>{ok ? yes : no}</span>;

/** The deepest drawdown so far (quiet) and the drawdown now (in the text colour) along a track to the
 *  limit, graduated in fifths, its end marked in the missed-target colour. */
function Track({ used, now }: { used: number; now: number }) {
  return (
    <div className="relative h-1.5">
      <div className="absolute inset-0 flex gap-px overflow-hidden rounded-full">
        {Array.from({ length: STEPS }, (_, i) => {
          const fill = (part: number) => `${Math.max(0, Math.min(1, part * STEPS - i)) * 100}%`;
          return (
            <span key={i} className="relative flex-1 bg-grid">
              <span className="absolute inset-y-0 left-0 bg-fg-muted/45" style={{ width: fill(used) }} />
              <span className="absolute inset-y-0 left-0 bg-fg" style={{ width: fill(now) }} />
            </span>
          );
        })}
      </div>
      <span className="absolute -top-0.75 right-0 h-3 w-0.5 rounded-full bg-misses" />
    </div>
  );
}
const track = (f: Facts) => f.limit === null || f.mdd == null ? null
  : <Track used={f.mdd / f.limit} now={(typeof f.account?.dd === "number" ? f.account.dd : f.mdd) / f.limit} />;
const Drawdown = ({ f }: { f: Facts }) => <Tip content={f.basis}><span>Max drawdown</span></Tip>;

type Row = { name: ReactNode; n?: ReactNode; u?: string; sub?: boolean; tone?: string; stale?: boolean; track?: ReactNode };
type Group = { title: string; aside?: string; rows: Row[] };
const num = (n: N, text: (n: number) => string, u?: string): Pick<Row, "n" | "u"> => (n == null ? { n: <Missing /> } : { n: text(n), u });

/** Narrow: one ledger. Each reading a line, its name at the left, its number on one right edge and its
 *  unit in a faint column after it; what a target asks and the verdict stand indented under it. */
function Ledger({ f }: { f: Facts }) {
  const { account: a, stats: t } = f, dd = meets(f.mdd, f.limit, false), yearly = meets(f.annual, f.minimum, true);
  const hold = t?.hold == null ? null : span(t.hold);
  const groups: Group[] = [
    { title: "Targets", rows: [
      { name: <Drawdown f={f} />, ...num(f.mdd, digits, "%"), track: track(f) },
      ...dd === null ? [] : [{ name: <><Said ok={dd} yes="Within" no="Over" /> the limit</>, ...num(f.limit, digits, "%"), sub: true }],
      ...a ? [a.dd === "stop" ? { name: "At the stop", sub: true } : { name: a.ended ? "Below the peak at the end" : "Below the peak when last seen", ...num(a.dd, digits, "%"), sub: true, stale: a.stale },
        { name: "Return", ...num(a.ret, (n) => `${sign(n)}${digits(n)}`, "%"), stale: a.stale },
        // what the minimum annual return asks for by now, and the pace against it, where there is a minimum
        ...f.minimum === null ? [] : [{ name: "Needed by now", ...num(a.needed, (n) => `${sign(n)}${digits(n)}`, "%"), sub: true, stale: a.stale },
          { name: a.ahead == null ? "Pace" : <><Said ok={a.ahead >= 0} yes="On pace" no="Behind pace" /> · {signed(a.usdt ?? null, 0)} USDT</>,
            ...num(a.ahead, (n) => signed(n * 100), "pt"), sub: true, stale: a.stale }]] : [],
      { name: "Annual return", ...num(f.annual, (n) => `${sign(n)}${digits(n)}`, "%") },
      ...f.minimum === null ? [] : [{ name: yearly === null ? "The minimum" : <><Said ok={yearly} yes="Meets" no="Misses" /> the minimum</>, ...num(f.minimum, digits, "%"), sub: true }],
      ...f.short == null ? [] : [{ name: `Too short: ${Math.floor(f.short)} of ${ANNUAL_DAYS} days`, sub: true }],
    ] },
    { title: "Ratios", rows: [
      { name: "Sharpe", ...num(f.sharpe, (n) => `${sign(n, false)}${Math.abs(n).toFixed(2)}`) },
      ...t ? [{ name: "Profit factor", ...num(t.pf, (n) => n.toFixed(2)), stale: t.stale }] : [],
      { name: "Win rate", ...num(f.winRate, digits, "%") },
    ] },
    ...t ? [
      { title: "Trades", aside: "USDT", rows: [{ name: "Average win", n: amount(t.avgWin) }, { name: "Average loss", n: amount(t.avgLoss) }, { name: "Per trade", n: amount(t.perTrade) }].map((r) => ({ ...r, stale: t.stale })) },
      // the hold's last unit stands in the unit column ("1h 5" "m"), so its number ends on the same edge
      { title: "Time", rows: [{ name: "Average hold", ...hold === null ? { n: <Missing /> } : { n: hold.slice(0, -1), u: hold.slice(-1) } },
        { name: "In market", ...num(t.inMarket, digits, "%") }, { name: "Losing streak", ...num(t.streak, (n) => `${n}`) }].map((r) => ({ ...r, stale: t.stale })) },
    ] : [],
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] pb-2">
      {groups.map((g) => (
        <Fragment key={g.title}>
          <div className="col-span-full grid grid-cols-subgrid border-t border-line-strong pt-2 pb-0.5 text-small text-fg-faint first:pt-1.5">
            <span>{g.title}</span>{g.aside && <span className="text-right">{g.aside}</span>}
          </div>
          {g.rows.map((r, i) => (
            <Fragment key={i}>
              <div className={`col-span-full grid grid-cols-subgrid items-baseline py-0.5 ${i > 0 && !r.sub ? "border-t border-line" : ""} ${r.stale ? "invisible" : ""}`}>
                <span className={`min-w-0 truncate pr-3 ${r.sub ? "pl-3 text-fg-faint" : "text-fg-muted"}`}>{r.name}</span>
                <span className={`text-right whitespace-nowrap tabular-nums ${r.sub ? "text-fg-muted" : ""}`}>{r.n}</span>
                <span className="min-w-[2ch] pl-px text-fg-faint">{r.u}</span>
              </div>
              {r.track && <div className="col-span-full grid grid-cols-subgrid pt-0.5 pb-1.5"><div className="col-span-2">{r.track}</div></div>}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

type Cell = { name: string; value: ReactNode; stale?: boolean };

/** Wide: the drawdown and the return each a line, the value with what the target asks at the right edge
 *  and the verdict under it; every other reading in two columns of cells divided by rules, name at the
 *  left and value at the cell's right edge, under small group headings. The grid is pulled out by a
 *  cell's padding and its rule and clipped, so the left cells start at the card's edge and the right
 *  cells end at it. */
function Strip({ f }: { f: Facts }) {
  const { account: a, stats: t } = f, dd = meets(f.mdd, f.limit, false);
  const ddNote = a?.dd === "stop" ? "at the stop" : typeof a?.dd === "number" ? (a.ended ? `${pct(a.dd)} below the peak at the end` : `last seen ${pct(a.dd)} below the peak`) : null;
  const lines = [
    { name: "Max drawdown", value: shown(f.mdd, pct), context: f.limit === null ? null : `of ${pct(f.limit, 0)} limit`, track: track(f),
      note: [dd === null ? null : <Said ok={dd} yes="Within limit" no="Over limit" />, ddNote] },
    ...a ? [{ name: "Return", value: shown(a.ret, (n) => `${sign(n)}${pct(n)}`), context: a.needed == null ? null : `of ${sign(a.needed)}${pct(a.needed)} needed`, track: null, stale: a.stale,
      note: a.ahead == null ? [] : [<Said ok={a.ahead >= 0} yes="On pace" no="Behind pace" />, `${signed(a.ahead * 100)} pt`, `${signed(a.usdt ?? null, 0)} USDT`] }] : [],
  ];
  const annual = f.short != null ? <span className="text-small text-fg-faint">Too short · {Math.floor(f.short)} of {ANNUAL_DAYS} d</span>
    : shown(f.annual, (n) => { const ok = meets(n, f.minimum, true); return <span className={ok === null ? pnlClass(n) : ok ? "text-meets" : "text-misses"}>{sign(n)}{pct(n)}</span>; });
  const groups: { title: string; aside?: string; cells: Cell[] }[] = [
    { title: "Returns", aside: f.minimum === null ? undefined : `minimum ${pct(f.minimum, 0)} a year`, cells: [
      { name: "Annual return", value: annual }, { name: "Sharpe", value: shown(f.sharpe, (n) => `${sign(n, false)}${Math.abs(n).toFixed(2)}`) },
      ...t ? [{ name: "Profit factor", value: shown(t.pf, (n) => n.toFixed(2)), stale: t.stale }] : [], { name: "Win rate", value: shown(f.winRate, pct) }] },
    ...t ? [
      { title: "Trades", aside: "USDT", cells: [{ name: "Average win", value: amount(t.avgWin) }, { name: "Average loss", value: amount(t.avgLoss) },
        { name: "Per trade", value: amount(t.perTrade) }, { name: "Losing streak", value: shown(t.streak, (n) => `${n}`) }].map((c) => ({ ...c, stale: t.stale })) },
      { title: "Time", cells: [{ name: "Average hold", value: shown(t.hold, span) }, { name: "In market", value: shown(t.inMarket, pct) }].map((c) => ({ ...c, stale: t.stale })) },
    ] : [],
  ];
  return (
    <div className="pb-2">
      <div className="border-t border-line-strong">
        {lines.map((l, i) => (
          <div key={l.name} className={`flex flex-col gap-1 py-1.5 ${i > 0 ? "border-t border-line" : ""} ${"stale" in l && l.stale ? "invisible" : ""}`}>
            <div className="flex items-baseline justify-between gap-3 whitespace-nowrap">
              <span className="text-fg-muted">{l.name === "Max drawdown" ? <Drawdown f={f} /> : l.name}</span>
              <span className="tabular-nums">{l.value}{l.context && <span className="text-fg-faint"> {l.context}</span>}</span>
            </div>
            {l.track}
            {l.note.some(Boolean) && <p className="text-small text-fg-faint">{l.note.filter(Boolean).map((x, j) => <span key={j}>{j > 0 && " · "}{x}</span>)}</p>}
          </div>
        ))}
      </div>
      <div className="overflow-hidden"><div className="-mx-3"><div className="-ml-px grid grid-cols-2">
        {groups.map((g) => (
          <Fragment key={g.title}>
            <div className="col-span-full ml-px flex justify-between border-t border-line-strong px-3 pt-1.5 pb-0.5 text-small text-fg-faint"><span>{g.title}</span>{g.aside && <span>{g.aside}</span>}</div>
            {g.cells.map((c) => (
              <div key={c.name} className={`flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 whitespace-nowrap border-l border-line-strong px-3 py-0.5 ${c.stale ? "invisible" : ""}`}>
                <span className="shrink-0 text-fg-muted">{c.name}</span><span className="ml-auto tabular-nums">{c.value}</span>
              </div>
            ))}
          </Fragment>
        ))}
      </div></div></div>
    </div>
  );
}

/** The card's readings as a ledger, or as lines over a two-column strip once the card is 42rem wide (a
 *  widened inspector). Each form keeps its own sizes; the width only chooses which one stands. */
export function Board({ f }: { f: Facts }) {
  return (
    <div data-readings className="@container">
      <div className="@2xl:hidden"><Ledger f={f} /></div>
      <div className="hidden @2xl:block"><Strip f={f} /></div>
    </div>
  );
}
