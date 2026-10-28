// The Performance card's parts below its targets (Performance.tsx): how the closed trades ended, by
// contract, and what moved equity.
import { fixed } from "../../lib/paperApi";
import { MISSING } from "../../lib/format";
import type { Account, TradeStats } from "../../model/account";
import { pnlClass } from "../../theme/roles";
import { Tip } from "../../components/Tip";

export const signed = (n: number | null, digits = 2) => (n == null ? MISSING : `${n > 0 ? "+" : n < 0 ? "−" : ""}${fixed(Math.abs(n), digits)}`);

function Step({ name, value, from, to, x, total = false, hint }: { name: string; value: number; from: number; to: number; x: (n: number) => number; total?: boolean; hint?: string }) {
  return (
    <Tip content={hint}><div className={`grid grid-cols-[64px_minmax(0,1fr)_84px] items-center gap-2.5 text-dense ${total ? "mt-1 border-t border-line pt-1.5" : ""}`}>
      <span className={total ? "font-medium text-fg" : "text-fg-muted"}>{name}</span>
      <span className="relative h-2">
        <i className={`absolute inset-y-0 rounded-badge ${total ? "bg-fg-muted" : value >= 0 ? "bg-pnl-up" : "bg-pnl-down"}`}
           style={{ left: `${x(Math.min(from, to))}%`, width: `max(4px, ${Math.abs(x(to) - x(from))}%)` }} />
      </span>
      <span className={`text-right tabular-nums ${total ? "font-medium text-fg" : pnlClass(value)}`}>{signed(value)}</span>
    </div></Tip>
  );
}

const EXITS = [["target", "Target", "bg-pnl-up"], ["stop", "Stop", "bg-pnl-down"], ["other", "Other", "bg-fg-muted"]] as const;

/** How the closed trades ended: at their target, at their stop or otherwise, as one bar in those shares
 *  under their counts. */
export function Exits({ exits }: { exits: TradeStats["exits"] }) {
  const total = exits.target + exits.stop + exits.other;
  if (!total) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3.5 text-small tabular-nums">
        <span className="mr-auto text-fg-muted">Exits</span>
        {EXITS.map(([key, name, tone]) => <span key={key} className="inline-flex items-center gap-1.5 text-fg-muted"><i className={`size-1.5 rounded-full ${tone}`} />{name} <span className="text-fg">{exits[key]}</span></span>)}
      </div>
      <div className="flex h-1 gap-px overflow-hidden rounded-full">
        {EXITS.map(([key, , tone]) => exits[key] > 0 && <i key={key} className={tone} style={{ flexGrow: exits[key] }} />)}
      </div>
    </div>
  );
}

/** Each contract's closed trades, when the run has more than one: how many and their profit and loss
 *  together (byContract), as a bar from a zero line in the middle on one scale, the count on hover. */
export function byContract(trades: Account["trades"]) {
  const by = new Map<string, { n: number; pnl: number }>();
  for (const t of trades) if (t.pnl !== null) { const c = by.get(t.symbol) ?? { n: 0, pnl: 0 }; by.set(t.symbol, { n: c.n + 1, pnl: c.pnl + t.pnl }); }
  return by;
}

export function Contracts({ by }: { by: ReturnType<typeof byContract> }) {
  const rows = [...by].sort((a, b) => b[1].pnl - a[1].pnl), most = Math.max(...rows.map(([, c]) => Math.abs(c.pnl)), 1e-9);
  return (
    <div className="relative flex flex-col gap-0.75">
      <i className="absolute inset-y-0 left-[calc(74px+(100%-168px)/2)] w-px bg-line-strong" />
      {rows.map(([symbol, c]) => (
        <Tip key={symbol} content={`${c.n} closed ${c.n === 1 ? "trade" : "trades"}`}><div className="grid grid-cols-[64px_minmax(0,1fr)_84px] items-center gap-2.5 text-dense tabular-nums">
          <span className="truncate text-fg-muted">{symbol}</span>
          <span className="relative h-1">
            <i className={`absolute inset-y-0 rounded-full ${c.pnl >= 0 ? "left-1/2 bg-pnl-up" : "right-1/2 bg-pnl-down"}`} style={{ width: `max(3px, ${(Math.abs(c.pnl) / most) * 50}%)` }} />
          </span>
          <span className={`text-right ${pnlClass(c.pnl)}`}>{signed(c.pnl)}</span>
        </div></Tip>
      ))}
    </div>
  );
}

/** What moved equity since the start, as a waterfall: each step a bar from where the last ended, then
 *  the net from zero; the fees' share of gross profit shows over their row. */
export function Bridge({ a }: { a: Account }) {
  if (a.gross === null || a.net === null || a.open === null) return null;
  const steps: [string, number][] = [["Gross", a.gross], ["Fees", -a.fees], ["Funding", a.funding], ...(a.open || a.holding ? [["Open", a.open] as [string, number]] : [])];
  let at = 0;
  const bars = steps.map(([name, value]) => { const from = at; at += value; return { name, value, from, to: at }; });
  const lo = Math.min(0, a.net, ...bars.map((b) => Math.min(b.from, b.to))), hi = Math.max(0, a.net, ...bars.map((b) => Math.max(b.from, b.to)));
  const x = (n: number) => (hi > lo ? ((n - lo) / (hi - lo)) * 100 : 0);
  return (
    <div className="flex flex-col gap-0.75">
      {bars.map((b) => <Step key={b.name} {...b} x={x} hint={b.name === "Fees" && a.gross! > 0 && a.fees > 0 ? `Fees took ${Math.round((a.fees / a.gross!) * 100)}% of gross profit` : undefined} />)}
      <Step name="Net" value={a.net} from={0} to={a.net} x={x} total />
    </div>
  );
}
