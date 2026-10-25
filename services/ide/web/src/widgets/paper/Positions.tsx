import { useMemo, useState, type ReactNode } from "react";
import { fixed, precisions, type Precision } from "../../lib/paperApi";
import { utc } from "../../model/paper";
import { holdings, span, trades, type Working } from "../../model/trades";
import { Missing } from "../../components/Missing";
import { PillButton } from "../../components/Tabs";
import { useAtom } from "../../state/atom";
import { paperTab } from "../../state/paper";
import { useStream } from "../../state/paperStream";
import { useNow } from "./RunStrip";

const ROW = "grid h-6 grid-cols-[6.5rem_6rem_5rem_minmax(5.5rem,1fr)_minmax(5.5rem,1fr)_6.5rem_6rem_6rem] items-center gap-2 border-b border-line px-3";
const NUM = "text-right font-mono tabular-nums";
const KIND: Record<Working["kind"], string> = { target: "TP", stop: "SL", entry: "Entry", other: "Exit" };
const HOW: Record<string, string> = { stop: "Stop", target: "Target", other: "Other" };
const show = (value: string | null) => value ?? <Missing />;
const money = (n: number | null) => (n == null ? <Missing /> : <span className="text-fg">{n > 0 ? "+" : n < 0 ? "−" : ""}{fixed(Math.abs(n), 2)}</span>);
const pctOf = (price: number | null, from: number | null) => (price == null || !from ? "" : `${price >= from ? "+" : "−"}${Math.abs((price / from - 1) * 100).toFixed(2)}%`);

function Header({ title, count, cells }: { title: string; count: number; cells: readonly string[] }) {
  return (
    <>
      <div className="sticky top-0 z-[1] flex h-7 items-end bg-island px-3 pb-1 text-small font-semibold text-fg">{title}<span className="ml-1.5 font-normal text-fg-faint">{count}</span></div>
      <div className={`${ROW} text-small text-fg-faint`}>{cells.map((c, i) => <span key={c} className={i > 2 ? "text-right" : ""}>{c}</span>)}</div>
    </>
  );
}
const Cells = ({ children, faint = false }: { children: ReactNode; faint?: boolean }) => <div className={`${ROW} ${faint ? "text-fg-muted" : ""}`}>{children}</div>;

/** The run's trading, the first place to look while it runs: what it holds (size, average entry, mark,
 *  open P&L, fees and funding so far, age) with the stop and target protecting each position nested
 *  under it, entries still working, then the closed trades with how each ended. On a contract tab only
 *  that contract shows, unless "All contracts" is on. */
export function Positions() {
  const s = useStream();
  const tab = useAtom(paperTab);
  const [all, setAll] = useState(false);
  const now = useNow(30_000);
  const p = useMemo(() => precisions(s?.lines ?? []), [s?.lines]);
  const book = useMemo(() => holdings(s?.lines ?? [], s?.state?.positions ?? null, s?.state?.orders ?? [], !!s?.seal), [s?.lines, s?.state, s?.seal]);
  const closed = useMemo(() => trades(s?.lines ?? []), [s?.lines]);
  if (!s) return <p className="p-3 text-dense text-fg-faint">Open a paper run in the Paper panel</p>;
  const only = tab && !all ? tab : null;
  const mine = <T extends { symbol: string }>(rows: readonly T[]) => (only ? rows.filter((r) => r.symbol === only) : rows);
  const open = mine(book.open), pending = mine(book.pending), done = mine(closed);
  const of = (symbol: string): Precision => p.get(symbol) ?? { price: -1, size: -1 };
  const wins = done.filter((t) => (t.pnl ?? 0) > 0).length;
  return (
    <div className="text-dense">
      {tab && <div className="flex h-7 items-center gap-2 px-3 text-small text-fg-muted">
        {only ? `${only} only` : "All contracts"}
        <PillButton onClick={() => setAll(!all)}>{all ? `Only ${tab}` : "All contracts"}</PillButton>
      </div>}
      <Header title={s.seal ? "Open at the stop" : "Open"} count={open.length} cells={["Contract", "Side", "Size", "Entry", "Mark", "Open P&L", "Fees, funding", "Age"]} />
      {open.length === 0 && <p className="px-3 py-1.5 text-fg-faint">{s.seal ? "None: the run ended flat" : "Flat"}</p>}
      {open.map((o) => (
        <div key={o.id}>
          <Cells>
            <span className="font-mono">{o.symbol}</span><span>{o.long ? "Long" : "Short"}</span>
            <span className={NUM}>{show(fixed(o.quantity, of(o.symbol).size))}</span>
            <span className={NUM}>{show(fixed(o.average, of(o.symbol).price))}</span>
            <span className={NUM}>{o.atStop ? <span className="text-fg-faint">booked at end</span> : show(fixed(o.mark, of(o.symbol).price))}</span>
            <span className={NUM}>{money(o.pnl)}</span><span className={NUM}>{money(o.fees)}</span>
            <span className={`${NUM} text-fg-muted`}>{o.since ? span((s.seal?.stopped_ns ? s.seal.stopped_ns / 1e6 : now) - o.since) : <Missing />}</span>
          </Cells>
          {o.orders.map((w) => (
            <Cells key={w.id} faint>
              <span className="pl-4 text-fg-faint">↳ {KIND[w.kind]}</span><span>{w.type}</span>
              <span className={NUM}>{show(fixed(w.quantity, of(o.symbol).size))}</span>
              <span className={NUM}>{show(fixed(w.price, of(o.symbol).price))}</span>
              <span className={`${NUM} text-fg-faint`}>{pctOf(w.price, o.average)}</span><span /><span /><span />
            </Cells>
          ))}
        </div>
      ))}
      {pending.length > 0 && <>
        <Header title="Working entries" count={pending.length} cells={["Contract", "Order", "Size", "Price", "", "", "", ""]} />
        {pending.map((w) => (
          <Cells key={w.id}>
            <span className="font-mono">{w.symbol}</span><span>{w.side === "BUY" ? "Buy" : "Sell"} {w.type.toLowerCase()}</span>
            <span className={NUM}>{show(fixed(w.quantity, of(w.symbol).size))}</span><span className={NUM}>{show(fixed(w.price, of(w.symbol).price))}</span>
            <span /><span /><span /><span />
          </Cells>
        ))}
      </>}
      <Header title="Closed" count={done.length} cells={["Contract", "Side", "Size", "Entry", "Exit", "P&L", "Closed by", "Held"]} />
      {done.length === 0 ? <p className="px-3 py-1.5 text-fg-faint">No closed trades yet</p>
        : <p className="px-3 py-1 text-small text-fg-muted">{wins} of {done.length} made money</p>}
      {done.map((t) => (
        <Cells key={t.id}>
          <span className="font-mono" title={`Closed ${utc(t.closed)} UTC`}>{t.symbol}</span><span>{t.long ? "Long" : "Short"}</span>
          <span className={NUM}>{show(fixed(t.quantity, of(t.symbol).size))}</span>
          <span className={NUM}>{show(fixed(t.entry, of(t.symbol).price))}</span><span className={NUM}>{show(fixed(t.exit, of(t.symbol).price))}</span>
          <span className={NUM}>{money(t.pnl)}</span><span className="text-right text-fg-muted">{HOW[t.how]}</span>
          <span className={`${NUM} text-fg-muted`}>{t.opened ? span(t.closed - t.opened) : <Missing />}</span>
        </Cells>
      ))}
    </div>
  );
}
