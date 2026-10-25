import { useMemo, type ReactNode } from "react";
import { fixed, precisions, type Precision } from "../../lib/paperApi";
import { utc } from "../../model/paper";
import { holdings, span, trades, type Working } from "../../model/trades";
import { Missing } from "../../components/Missing";
import { useStream } from "../../state/paperStream";
import { useScope } from "./ContractScope";
import { useNow } from "./RunStrip";

const ROW = "grid h-6 grid-cols-[6.5rem_6rem_5rem_minmax(5.5rem,1fr)_minmax(5.5rem,1fr)_6.5rem_6rem_6rem] items-center gap-2 border-b border-line px-3";
const NUM = "text-right font-mono tabular-nums";
const KIND: Record<Working["kind"], string> = { target: "TP", stop: "SL", entry: "Entry", other: "Exit" };
const HOW: Record<string, string> = { stop: "Stop", target: "Target", other: "Other" };
const show = (value: string | null) => value ?? <Missing />;
const signed = (n: number, digits: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fixed(Math.abs(n), digits)}`;
const money = (n: number | null) => (n == null ? <Missing /> : <span className="text-fg">{signed(n, 2)}</span>);
const pctOf = (price: number | null, from: number | null) => (price == null || !from ? "" : `${price >= from ? "+" : "−"}${Math.abs((price / from - 1) * 100).toFixed(2)}%`);

/** A section's title and count, and its column names while it has rows. */
function Header({ title, count, cells, empty }: { title: string; count: number; cells: readonly string[]; empty?: string }) {
  return (
    <>
      <div className="sticky top-0 z-[1] flex h-7 items-end bg-island px-3 pb-1 text-small font-semibold text-fg">
        {title}<span className="ml-1.5 font-normal text-fg-faint">{count}{count === 0 && empty ? ` · ${empty}` : ""}</span>
      </div>
      {count > 0 && <div className={`${ROW} text-small text-fg-faint`}>{cells.map((c, i) => <span key={i} className={i >= 2 ? "text-right" : ""}>{c}</span>)}</div>}
    </>
  );
}
const Cells = ({ children, faint = false }: { children: ReactNode; faint?: boolean }) => <div className={`${ROW} ${faint ? "text-fg-muted" : ""}`}>{children}</div>;

/** The run's trading, the first place to look while it runs: what it holds (size, average entry, mark,
 *  open P&L, fees and funding so far, age) with the stop and target protecting each position nested
 *  under it (how far from the mark, and what it books if hit), entries still working, then the closed
 *  trades with how each ended. On a contract tab only that contract shows, unless the header asks for all. */
export function Positions() {
  const s = useStream();
  const only = useScope();
  const now = useNow(30_000);
  const p = useMemo(() => precisions(s?.lines ?? []), [s?.lines]);
  const book = useMemo(() => holdings(s?.lines ?? [], s?.state?.positions ?? null, s?.state?.orders ?? [], !!s?.seal), [s?.lines, s?.state, s?.seal]);
  const closed = useMemo(() => trades(s?.lines ?? []), [s?.lines]);
  if (!s) return <p className="p-3 text-dense text-fg-faint">Open a paper run in the Paper panel</p>;
  const mine = <T extends { symbol: string }>(rows: readonly T[]) => (only ? rows.filter((r) => r.symbol === only) : rows);
  const open = mine(book.open), pending = mine(book.pending), done = mine(closed);
  const of = (symbol: string): Precision => p.get(symbol) ?? { price: -1, size: -1 };
  return (
    <div className="text-dense">
      <Header title={s.seal ? "Open at the stop" : "Open"} count={open.length} empty={s.seal ? "the run ended flat" : "flat"}
              cells={["Contract", "Side", "Size", "Entry", "Mark", "Open P&L", "Fees, funding", "Age"]} />
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
          {o.orders.map((w) => {
            const hit = w.price != null && o.average != null ? (w.price - o.average) * o.quantity * (o.long ? 1 : -1) : null;
            return (
              <Cells key={w.id} faint>
                <span className="pl-4 text-fg-faint">↳</span>
                <span className="col-span-3 truncate">{KIND[w.kind]} · {w.type.toLowerCase()} @ <span className="font-mono tabular-nums text-fg">{show(fixed(w.price, of(o.symbol).price))}</span></span>
                <span className={`${NUM} text-fg-faint`}>{pctOf(w.price, o.mark) && `${pctOf(w.price, o.mark)} away`}</span>
                <span className={`${NUM} text-fg-faint`}>{hit == null ? "" : `${signed(hit, 2)} if hit`}</span><span /><span />
              </Cells>
            );
          })}
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
      <Header title="Closed" count={done.length} empty="none yet" cells={["Contract", "Side", "Size", "Entry", "Exit", "P&L", "Closed by", "Held"]} />
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
