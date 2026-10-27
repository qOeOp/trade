import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { fixed, precisions, type Precision } from "../../lib/paperApi";
import { MISSING } from "../../lib/format";
import { holdings, span, trades, type Closed } from "../../model/trades";
import { useNow } from "../../components/hooks/useNow";
import { useAtom } from "../../state/atom";
import { pickedTrade, type Stream } from "../../state/paperStream";
import { pnlClass } from "../../theme/roles";

const HOW: Record<Closed["how"], string> = { stop: "Stop", target: "Target", other: "Other" };
const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const signed = (n: number | null) => (n == null ? MISSING : `${n > 0 ? "+" : n < 0 ? "−" : ""}${fixed(Math.abs(n), 2)}`);
// Figures sit right, words left. Size and how a trade closed give way first when the page is narrow;
// the contract column goes when one contract shows.
const DETAIL = "@max-[1120px]/page:hidden";
const CELL = "h-9 whitespace-nowrap px-3 first:pl-5 last:pr-5 border-t border-line";
const HEAD = "sticky top-0 z-[1] h-8 whitespace-nowrap bg-island px-3 text-small font-normal text-fg-faint first:pl-5 last:pr-5";

type Cell = ReactNode | [ReactNode, string];
function Row({ cells, open = false, picked = false }: { cells: (Cell | null)[]; open?: boolean; picked?: boolean }) {
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (picked) ref.current?.scrollIntoView({ block: "nearest" }); }, [picked]);
  return (
    <tr ref={ref} data-selected={picked ? "" : undefined} className={open ? "bg-island-alt" : "transition-colors hover:bg-row-hover"}>
      {cells.filter((c) => c !== null).map((c, i) => { const [body, extra] = Array.isArray(c) ? c : [c, ""]; return <td key={i} className={`${CELL} ${extra.includes("text-left") ? "" : "text-right"} ${extra}`}>{body}</td>; })}
    </tr>
  );
}
const Faint = ({ children }: { children: ReactNode }) => <span className="text-fg-faint">{children}</span>;

/** The trades of the contract the chart shows (or of every contract on Equity), newest first, with what
 *  is open pinned on top on a tinted row: its mark in the exit's place, its stop and target under
 *  "Closed by", and "holding"; entries still working follow it. Sizes in the contract's lot decimals. The
 *  trade picked on the equity chart is highlighted and scrolled into view. */
export function Trades({ s, only }: { s: Stream; only: string | null }) {
  const now = useNow(30_000);
  const picked = useAtom(pickedTrade);
  const digits = useMemo(() => precisions(s.lines), [s.lines]);
  const book = useMemo(() => holdings(s.lines, s.state?.positions ?? null, s.state?.orders ?? [], !!s.seal), [s.lines, s.state, s.seal]);
  const closedList = useMemo(() => trades(s.lines), [s.lines]);
  const mine = <T extends { symbol: string }>(rows: readonly T[]) => (only ? rows.filter((r) => r.symbol === only) : rows);
  const open = mine(book.open), pending = mine(book.pending), done = mine(closedList);
  const of = (symbol: string): Precision => digits.get(symbol) ?? { price: -1, size: -1 };
  const end = s.seal?.stopped_ns ? s.seal.stopped_ns / 1e6 : now;
  if (!open.length && !pending.length && !done.length) {
    return <p className="px-5 py-3 text-dense text-fg-faint">{s.seal ? "The run ended flat, with no trades" : `Flat, no trades yet${only ? ` on ${only}` : ""}`}</p>;
  }
  const contract = (symbol: string, strong = false): Cell | null => (only ? null : [strong ? <span className="font-medium">{symbol}</span> : symbol, "text-left"]);
  const side = (long: boolean): [ReactNode, string] => [long ? "Long" : "Short", `text-left ${long ? "text-pnl-up" : "text-pnl-down"}`];
  return (
    <table className="w-full border-collapse text-dense tabular-nums">
      <thead><tr>
        {!only && <th className={`${HEAD} text-left`}>Contract</th>}<th className={`${HEAD} text-left`}>Side</th>
        <th className={`${HEAD} text-right ${DETAIL}`}>Size</th><th className={`${HEAD} text-right`}>Entry</th><th className={`${HEAD} text-right`}>Exit</th>
        <th className={`${HEAD} text-left ${DETAIL}`}>Closed by</th><th className={`${HEAD} text-right`}>Held</th><th className={`${HEAD} text-right`}>P&amp;L</th><th className={`${HEAD} text-right`}>Closed</th>
      </tr></thead>
      <tbody>
        {open.map((o) => {
          const stop = o.orders.find((w) => w.kind === "stop"), target = o.orders.find((w) => w.kind === "target"), p = of(o.symbol);
          return <Row key={o.id} open cells={[
            contract(o.symbol, true), side(o.long), [fixed(o.quantity, p.size), DETAIL], fixed(o.average, p.price) ?? MISSING,
            [o.atStop ? <Faint>booked at end</Faint> : <><Faint>mark </Faint>{fixed(o.mark, p.price) ?? MISSING}</>, ""],
            [<>{stop && <><Faint>stop </Faint>{fixed(stop.price, p.price)}</>}{stop && target && <Faint> · </Faint>}{target && <><Faint>target </Faint>{fixed(target.price, p.price)}</>}
              {!stop && !target && <span className="text-misses">no protection</span>}</>, `text-left ${DETAIL}`],
            o.since ? span(end - o.since) : MISSING, [signed(o.pnl), pnlClass(o.pnl)], [o.atStop ? "at the stop" : "holding", "text-fg-muted"],
          ]} />;
        })}
        {pending.map((w) => (
          <Row key={w.id} open cells={[
            contract(w.symbol, true), [`${w.side === "BUY" ? "Buy" : "Sell"} ${w.type.toLowerCase()}`, "text-left text-fg-muted"], [fixed(w.quantity, of(w.symbol).size), DETAIL],
            fixed(w.price, of(w.symbol).price) ?? MISSING, "", [<Faint>working entry</Faint>, `text-left ${DETAIL}`], "", "", ["waiting", "text-fg-muted"],
          ]} />
        ))}
        {done.map((t) => {
          const p = of(t.symbol);
          return <Row key={t.id} picked={t.id === picked} cells={[
            contract(t.symbol), side(t.long), [fixed(t.quantity, p.size), DETAIL], fixed(t.entry, p.price) ?? MISSING, fixed(t.exit, p.price) ?? MISSING,
            [HOW[t.how], `text-left text-fg-muted ${DETAIL}`], t.opened ? span(t.closed - t.opened) : MISSING, [signed(t.pnl), pnlClass(t.pnl)], [WHEN.format(t.closed).replace(",", ""), "text-fg-muted"],
          ]} />;
        })}
      </tbody>
    </table>
  );
}
