import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { fixed, precisions, signed, type Precision } from "../../lib/paperApi";
import { MISSING } from "../../lib/format";
import { observedCloses, stoppedPositions } from "../../model/stoppedPositions";
import { utcMinute } from "../../model/observation";
import { holdings, span, trades, type Closed } from "../../model/trades";
import { useNow } from "../../components/hooks/useNow";
import { useAtom } from "../../state/atom";
import { pickedTrade, type Stream } from "../../state/paperStream";
import { usePhone } from "../../state/phone";
import { pnlClass } from "../../theme/roles";

const HOW: Record<Closed["how"], string> = { stop: "Stop", target: "Target", other: "Other" };
const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
// Figures sit right, words left. Size and how a trade closed give way first when the page is narrow;
// the contract column goes when one contract shows.
const DETAIL = "@max-[1120px]/page:hidden";
const CELL = "h-(--form-h) whitespace-nowrap px-3 border-t border-line";
const HEAD = "sticky top-0 z-[1] h-(--form-h) whitespace-nowrap bg-island px-3 text-small font-normal text-fg-faint";

type Cell = ReactNode | [ReactNode, string];
/** The columns as a phone orders them, the P&L (second to last) in sight after the side (`only`: no contract column). */
const phoneOrder = <T,>(list: readonly T[], only: boolean): T[] => {
  const at = only ? 1 : 2;
  return [...list.slice(0, at), list.at(-2)!, ...list.slice(at, -2), list.at(-1)!];
};
function Row({ cells, open = false, picked = false }: { cells: (Cell | null)[]; open?: boolean; picked?: boolean }) {
  const ref = useRef<HTMLTableRowElement>(null), phone = usePhone();
  useEffect(() => { if (picked) ref.current?.scrollIntoView({ block: "nearest" }); }, [picked]);
  return (
    <tr ref={ref} data-selected={picked ? "" : undefined} className={open ? "bg-island-alt" : "transition-colors hover:bg-row-hover"}>
      {(phone ? phoneOrder(cells.filter((c) => c !== null), cells[0] === null) : cells.filter((c) => c !== null)).map((c, i) => { const [body, extra] = Array.isArray(c) ? c : [c, ""]; return <td key={i} className={`${CELL} ${extra.includes("text-left") ? "" : "text-right"} ${extra}`}>{body}</td>; })}
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
  const picked = useAtom(pickedTrade), phone = usePhone();
  const digits = useMemo(() => precisions(s.lines), [s.lines]);
  const book = useMemo(() => holdings(s.lines, s.state?.positions ?? null, s.state?.orders ?? [], !!s.seal), [s.lines, s.state, s.seal]);
  const stopped = useMemo(() => stoppedPositions(s.lines, observedCloses(s.bars, s.closes), s.seal?.stopped_ns ? s.seal.stopped_ns / 1e6 : null), [s.lines, s.bars, s.closes, s.seal]);
  const closedList = useMemo(() => trades(s.lines), [s.lines]);
  const mine = <T extends { symbol: string }>(rows: readonly T[]) => (only ? rows.filter((r) => r.symbol === only) : rows);
  const open = mine(book.open), pending = mine(book.pending), done = mine(closedList), ended = mine(stopped);
  const of = (symbol: string): Precision => digits.get(symbol) ?? { price: -1, size: -1 };
  const end = s.seal?.stopped_ns ? s.seal.stopped_ns / 1e6 : now;
  if (!open.length && !pending.length && !done.length && !ended.length) {
    if (!s.state && !s.seal) return <p className="px-3 py-3 text-dense text-fg-faint">No account snapshot yet for this run</p>;
    return <p className="px-3 py-3 text-dense text-fg-faint">{s.seal ? "The run ended flat, with no trades" : `Flat, no trades yet${only ? ` on ${only}` : ""}`}</p>;
  }
  const contract = (symbol: string, strong = false): Cell | null => (only ? null : [strong ? <span className="font-medium">{symbol}</span> : symbol, "text-left"]);
  const side = (long: boolean): [ReactNode, string] => [long ? "Long" : "Short", `text-left ${long ? "text-pnl-up" : "text-pnl-down"}`];
  const heads = [
    !only && <th key="contract" className={`${HEAD} text-left`}>Contract</th>, <th key="side" className={`${HEAD} text-left`}>Side</th>,
    <th key="size" className={`${HEAD} text-right ${DETAIL}`}>Size</th>, <th key="entry" className={`${HEAD} text-right`}>Entry</th>, <th key="exit" className={`${HEAD} text-right`}>Exit / last</th>,
    <th key="by" className={`${HEAD} text-left ${DETAIL}`}>Closed by</th>, <th key="held" className={`${HEAD} text-right`}>Held</th>, <th key="pnl" className={`${HEAD} text-right`}>P&amp;L</th>, <th key="closed" className={`${HEAD} text-right`}>Closed / stopped</th>,
  ].filter(Boolean);
  return (
    <>
    <table className="w-full border-collapse text-dense tabular-nums">
      <thead><tr>{phone ? phoneOrder(heads, !!only) : heads}</tr></thead>
      <tbody>
        {open.map((o) => {
          const stop = o.orders.find((w) => w.kind === "stop"), target = o.orders.find((w) => w.kind === "target"), p = of(o.symbol);
          return <Row key={o.id} open cells={[
            contract(o.symbol, true), side(o.long), [fixed(o.quantity, p.size), DETAIL], fixed(o.average, p.price) ?? MISSING,
            [<><Faint>mark </Faint>{fixed(o.mark, p.price) ?? MISSING}</>, ""],
            [<>{stop && <><Faint>stop </Faint>{fixed(stop.price, p.price)}</>}{stop && target && <Faint> · </Faint>}{target && <><Faint>target </Faint>{fixed(target.price, p.price)}</>}
              {!stop && !target && <span className="text-misses">no protection</span>}</>, `text-left ${DETAIL}`],
            o.since ? span(end - o.since) : MISSING, [signed(o.pnl), pnlClass(o.pnl)], ["holding", "text-fg-muted"],
          ]} />;
        })}
        {pending.map((w) => (
          <Row key={w.id} open cells={[
            contract(w.symbol, true), [`${w.side === "BUY" ? "Buy" : "Sell"} ${w.type.toLowerCase()}`, "text-left text-fg-muted"], [fixed(w.quantity, of(w.symbol).size), DETAIL],
            fixed(w.price, of(w.symbol).price) ?? MISSING, "", [<Faint>working entry</Faint>, `text-left ${DETAIL}`], "", "", ["waiting", "text-fg-muted"],
          ]} />
        ))}
        {ended.map((t) => {
          const p = of(t.symbol);
          return <Row key={`stopped:${t.id}`} cells={[
            contract(t.symbol), side(t.long), [fixed(t.quantity, p.size), DETAIL], fixed(t.entry, p.price) ?? MISSING,
            [<span title={t.observed === null ? "No price observed after entry" : utcMinute(t.observed)}><Faint>last </Faint>{fixed(t.last, p.price) ?? MISSING}</span>, ""],
            [<Faint>No closing fill</Faint>, `text-left ${DETAIL}`], t.opened ? span(t.stopped - t.opened) : MISSING,
            [signed(t.pnl), pnlClass(t.pnl)], [<span title={utcMinute(t.stopped)}>At stop · {WHEN.format(t.stopped).replace(",", "")}</span>, "text-fg-muted"],
          ]} />;
        })}
        {done.map((t) => {
          const p = of(t.symbol);
          return <Row key={t.id} picked={t.id === picked} cells={[
            contract(t.symbol), side(t.long), [fixed(t.quantity, p.size), DETAIL], fixed(t.entry, p.price) ?? MISSING, fixed(t.exit, p.price) ?? MISSING,
            [HOW[t.how], `text-left text-fg-muted ${DETAIL}`], t.opened ? span(t.closed - t.opened) : MISSING, [signed(t.pnl), pnlClass(t.pnl)], [WHEN.format(t.closed).replace(",", ""), "text-fg-muted"],
          ]} />;
        })}
      </tbody>
    </table>
    {ended.length > 0 && <p className="px-3 py-2 text-small text-fg-faint">At stop: last recorded trade price and price P&amp;L, before fees and funding. These positions were not carried forward or closed by a fill.</p>}
    </>
  );
}
