import { Fragment } from "react";
import { signed } from "../../lib/paperApi";
import { MISSING } from "../../lib/format";
import type { Account, TradeStats } from "../../model/account";
import type { Backtest } from "../../model/backtest";
import { pnlClass } from "../../theme/roles";
import { Section } from "../../ui/Section";
import { Tip } from "../../ui/Tip";
import { TradeStrip } from "./TradeStrip";

/** A paper run's performance as cards in Details: its closed trades one by one and how they ended, by
 *  side and by contract (with more than one). What they say stands in the version card (detail/Readings);
 *  what moved equity is Bridge.tsx. */
export function Performance({ a, stats, exitNet = [] }: { a: Account; stats: TradeStats; exitNet?: Backtest["exitNet"] }) {
  const by = byContract(a.trades), closed = stats.sides.long.n + stats.sides.short.n > 0;
  return (
    <>
      <Section title="Trades" open={closed}><div className="flex flex-col gap-3">
        <TradeStrip trades={a.trades} />
        <Exits exits={stats.exits} />
        {exitNet.length > 0 && <ExitNet rows={exitNet} />}
      </div></Section>
      {closed && <Section title="Long and short" aside="closed trades, after fees"><Sides sides={stats.sides} /></Section>}
      {by.size > 1 && <Section title="By contract" aside="closed trades, after fees"><Contracts by={by} /></Section>}
    </>
  );
}

const EXITS = [["target", "Target", "bg-pnl-up"], ["stop", "Stop", "bg-pnl-down"], ["other", "Other", "bg-fg-muted"]] as const;

/** How the closed trades ended: at their target, at their stop or otherwise, as one bar in those shares
 *  under their counts. */
function Exits({ exits }: { exits: TradeStats["exits"] }) {
  const total = exits.target + exits.stop + exits.other;
  if (!total) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3 text-small tabular-nums">
        <span className="mr-auto text-fg-muted">Exits</span>
        {EXITS.map(([key, name, tone]) => <span key={key} className="inline-flex items-center gap-1.5 text-fg-muted"><i className={`size-1.5 rounded-full ${tone}`} />{name} <span className="text-fg">{exits[key]}</span></span>)}
      </div>
      <div className="flex h-1 gap-px overflow-hidden rounded-full">
        {EXITS.map(([key, , tone]) => exits[key] > 0 && <i key={key} className={`glide ${tone}`} style={{ flexGrow: exits[key] }} />)}
      </div>
    </div>
  );
}

/** The closed cycles' net by the order type that closed them (a backtest's report). */
function ExitNet({ rows }: { rows: Backtest["exitNet"] }) {
  const words = (type: string) => { const s = type.toLowerCase().replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-dense tabular-nums">
      <span className="text-small text-fg-faint">Closing order</span><span className="text-right text-small text-fg-faint">Net P&L</span>
      {rows.map((r) => (
        <Fragment key={r.type}>
          <span className="text-fg-muted">{words(r.type)}</span>
          <span className={`text-right ${r.net === null ? "text-fg-faint" : pnlClass(r.net)}`}>{signed(r.net)}</span>
        </Fragment>
      ))}
    </div>
  );
}

type SideStat = { n: number; won: number; pnl: number };
type ContractStat = SideStat & { long: SideStat; short: SideStat };

/** Each contract's closed trades, when the run has more than one: total and per-side (Long / Short)
 *  trade counts, wins, and net profit and loss. */
function byContract(trades: Account["trades"]) {
  const by = new Map<string, ContractStat>();
  for (const t of trades) {
    if (t.pnl === null) continue;
    const prev = by.get(t.symbol) ?? { n: 0, won: 0, pnl: 0, long: { n: 0, won: 0, pnl: 0 }, short: { n: 0, won: 0, pnl: 0 } };
    const win = t.pnl > 0 ? 1 : 0;
    const side = t.long ? prev.long : prev.short;
    const nextSide: SideStat = { n: side.n + 1, won: side.won + win, pnl: side.pnl + t.pnl };
    by.set(t.symbol, {
      n: prev.n + 1, won: prev.won + win, pnl: prev.pnl + t.pnl,
      long: t.long ? nextSide : prev.long,
      short: t.long ? prev.short : nextSide,
    });
  }
  return by;
}

function Contracts({ by }: { by: ReturnType<typeof byContract> }) {
  const rows = [...by].sort((a, b) => b[1].pnl - a[1].pnl);
  const winPct = (s: SideStat) => (s.n ? `${((s.won / s.n) * 100).toFixed(1)}%` : MISSING);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3 gap-y-1.5 text-dense tabular-nums">
      <span /><span className="text-right text-small text-fg-faint">Long / Short</span>
      <span className="text-right text-small text-fg-faint">Win rate</span><span className="text-right text-small text-fg-faint">P&L</span>
      {rows.map(([symbol, c]) => (
        <Tip key={symbol} content={
          <div className="space-y-0.5 tabular-nums">
            <div className="font-mono font-semibold text-fg">{symbol} · {c.n} closed {c.n === 1 ? "trade" : "trades"}</div>
            <div className="text-fg-muted">Long: {c.long.n} ({winPct(c.long)} win) · <span className={c.long.n ? pnlClass(c.long.pnl) : ""}>{c.long.n ? signed(c.long.pnl) : MISSING}</span></div>
            <div className="text-fg-muted">Short: {c.short.n} ({winPct(c.short)} win) · <span className={c.short.n ? pnlClass(c.short.pnl) : ""}>{c.short.n ? signed(c.short.pnl) : MISSING}</span></div>
          </div>
        }>
          <div className="col-span-full grid grid-cols-subgrid items-center py-0.5">
            <span className="truncate text-fg-muted">{symbol}</span>
            <span className="flex flex-col items-end gap-0.5">
              <span className="text-small">
                <span className="text-pnl-up">{c.long.n}L</span>
                <span className="mx-1 text-fg-faint">·</span>
                <span className="text-pnl-down">{c.short.n}S</span>
              </span>
              <span className="flex h-1 w-16 gap-px overflow-hidden rounded-full bg-grid">
                {c.long.n > 0 && <i className="bg-pnl-up" style={{ flexGrow: c.long.n }} />}
                {c.short.n > 0 && <i className="bg-pnl-down" style={{ flexGrow: c.short.n }} />}
              </span>
            </span>
            <span className="text-right">{winPct(c)}</span>
            <span className={`text-right ${pnlClass(c.pnl)}`}>{signed(c.pnl)}</span>
          </div>
        </Tip>
      ))}
    </div>
  );
}

const SIDES = [["long", "Long", "bg-pnl-up"], ["short", "Short", "bg-pnl-down"]] as const;

/** Which way the run leans: its closed trades' shares long and short as one bar under them, and each
 *  side's count, win rate and profit and loss. */
function Sides({ sides }: { sides: TradeStats["sides"] }) {
  const long = Math.round((sides.long.n / (sides.long.n + sides.short.n)) * 100), shares = { long, short: 100 - long };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-small tabular-nums text-fg-muted">
          {SIDES.map(([key, name, tone]) => <span key={key} className="inline-flex items-center gap-1.5"><i className={`size-1.5 rounded-full ${tone}`} />{name} <span className="text-fg">{shares[key]}%</span></span>)}
        </div>
        <div className="flex h-1 gap-px overflow-hidden rounded-full">
          {SIDES.map(([key, , tone]) => sides[key].n > 0 && <i key={key} className={`glide ${tone}`} style={{ flexGrow: sides[key].n }} />)}
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,auto)] gap-x-4 gap-y-1 text-dense tabular-nums">
        <span /><span className="text-right text-small text-fg-faint">Trades</span>
        <span className="text-right text-small text-fg-faint">Win rate</span><span className="text-right text-small text-fg-faint">P&L</span>
        {SIDES.map(([key, name]) => {
          const s = sides[key];
          return [
            <span key={`${key}-name`} className="text-fg-muted">{name}</span>,
            <span key={`${key}-n`} className="text-right">{s.n}</span>,
            <span key={`${key}-won`} className="text-right">{s.n ? `${((s.won / s.n) * 100).toFixed(1)}%` : MISSING}</span>,
            <span key={`${key}-pnl`} className={`text-right ${s.n ? pnlClass(s.pnl) : "text-fg-faint"}`}>{s.n ? signed(s.pnl) : MISSING}</span>,
          ];
        })}
      </div>
    </div>
  );
}
