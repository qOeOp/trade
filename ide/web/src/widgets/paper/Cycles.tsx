import { useEffect, useRef } from "react";
import { fixed } from "../../lib/paperApi";
import { MISSING } from "../../lib/format";
import type { Cycle } from "../../model/backtest";
import { orderType, span } from "../../model/trades";
import { useAtom } from "../../state/atom";
import { pickedTrade } from "../../state/paperStream";
import { pnlClass } from "../../theme/roles";

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const signed = (n: number | null) => (n == null ? MISSING : `${n > 0 ? "+" : n < 0 ? "−" : ""}${fixed(Math.abs(n), 2)}`);
const when = (ms: number) => WHEN.format(ms).replace(",", "");
// As the paper run's trades (Trades.tsx): figures right, words left, the detail columns giving way first.
const DETAIL = "@max-[1120px]/page:hidden";
const CELL = "h-9 whitespace-nowrap px-3 first:pl-5 last:pr-5 border-t border-line";
const HEAD = "sticky top-0 z-[1] h-8 whitespace-nowrap bg-island px-3 text-small font-normal text-fg-faint first:pl-5 last:pr-5";
const COLUMNS: [string, string][] = [["Side", "text-left"], ["Opened", "text-right"], ["Closed", "text-right"], ["Held", "text-right"],
  ["Closed by", `text-left ${DETAIL}`], ["P&L", "text-right"], ["Fees", `text-right ${DETAIL}`], ["Funding", `text-right ${DETAIL}`]];

function Row({ c, contract, picked }: { c: Cycle; contract: boolean; picked: boolean }) {
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (picked) ref.current?.scrollIntoView({ block: "nearest" }); }, [picked]);
  return (
    <tr ref={ref} data-selected={picked ? "" : undefined} className="transition-colors hover:bg-row-hover">
      {contract && <td className={`${CELL} text-left`}>{c.symbol}</td>}
      <td className={`${CELL} text-left ${c.long ? "text-pnl-up" : "text-pnl-down"}`}>{c.long ? "Long" : "Short"}</td>
      <td className={`${CELL} text-right text-fg-muted`}>{when(c.opened)}</td>
      <td className={`${CELL} text-right text-fg-muted`}>{when(c.closed)}</td>
      <td className={`${CELL} text-right`}>{span(c.closed - c.opened)}</td>
      <td className={`${CELL} text-left text-fg-muted ${DETAIL}`}>{c.type ? orderType(c.type) : MISSING}</td>
      <td className={`${CELL} text-right ${pnlClass(c.pnl)}`}>{signed(c.pnl)}</td>
      <td className={`${CELL} text-right text-fg-muted ${DETAIL}`}>{fixed(c.fees, 2)}</td>
      <td className={`${CELL} text-right ${DETAIL} ${pnlClass(c.funding)}`}>{signed(c.funding)}</td>
    </tr>
  );
}

/** A backtest's cycles (of the contract the chart shows, or every one on Equity), newest first: no sizes
 *  or prices, which the ledger does not store for them; the order events come back only from a
 *  reproduction, which this page never runs. The cycle picked on the equity chart is highlighted. */
export function Cycles({ cycles, only }: { cycles: readonly Cycle[]; only: string | null }) {
  const picked = useAtom(pickedTrade), shown = only ? cycles.filter((c) => c.symbol === only) : cycles;
  if (!shown.length) return <p className="px-5 py-3 text-dense text-fg-faint">No closed cycles{only ? ` on ${only}` : ""}</p>;
  return (
    <>
      <table className="w-full border-collapse text-dense tabular-nums">
        <thead><tr>
          {!only && <th className={`${HEAD} text-left`}>Contract</th>}
          {COLUMNS.map(([name, align]) => <th key={name} className={`${HEAD} ${align}`}>{name}</th>)}
        </tr></thead>
        <tbody>{shown.map((c) => <Row key={c.id} c={c} contract={!only} picked={c.id === picked} />)}</tbody>
      </table>
      <p className="px-5 py-3 text-small text-fg-faint">Order events of a backtest come back only from a reproduction, which this page never runs.</p>
    </>
  );
}
