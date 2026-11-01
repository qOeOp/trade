// The Performance cards' parts (Performance.tsx): how the closed trades ended and by
// contract; what moved equity is Flow.tsx.
import { fixed } from "../../lib/paperApi";
import { MISSING } from "../../lib/format";
import type { Account, TradeStats } from "../../model/account";
import { pnlClass } from "../../theme/roles";
import { Tip } from "../../components/Tip";

export const signed = (n: number | null, digits = 2) => (n == null ? MISSING : `${n > 0 ? "+" : n < 0 ? "−" : ""}${fixed(Math.abs(n), digits)}`);

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
