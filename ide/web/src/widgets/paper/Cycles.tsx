import { dateTime } from "../../lib/time";
import { useTimeZone } from "../../state/timeZone";
import { fixed, signed } from "../../lib/paperApi";
import { duration, MISSING } from "../../lib/format";
import type { Cycle } from "../../model/backtest";
import { orderType } from "../../model/trades";
import { useAtom } from "../../state/atom";
import { pickedTrade, pickTrade } from "../../state/paperStream";
import { pnlClass } from "../../theme/roles";
import { CELL, DETAIL, HEAD, NARROW, usePickedScroll } from "./table";

// As the paper run's trades: P&L before the times, so it stays in view when the page is narrow; the opening
// time gives way there (Held and Closed give it back).
const COLUMNS: [string, string][] = [["Side", "text-left"], ["Held", "text-right"], ["P&L", "text-right"], ["Opened", `text-right ${NARROW}`],
  ["Closed", "text-right"], ["Closed by", `text-left ${DETAIL}`], ["Fees", `text-right ${DETAIL}`], ["Funding", `text-right ${DETAIL}`]];

function Row({ c, contract, picked }: { c: Cycle; contract: boolean; picked: boolean }) {
  const ref = usePickedScroll<HTMLTableRowElement>(picked), zone = useTimeZone();
  return (
    <tr ref={ref} data-selected={picked ? "" : undefined} onClick={() => pickTrade(c.id, c.opened || c.closed, c.closed)} className="cursor-pointer transition-colors hover:bg-row-hover">
      {contract && <td className={`${CELL} text-left`}>{c.symbol}</td>}
      <td className={`${CELL} text-left ${c.long ? "text-pnl-up" : "text-pnl-down"}`}>{c.long ? "Long" : "Short"}</td>
      <td className={`${CELL} text-right`}>{duration(c.closed - c.opened)}</td>
      <td className={`${CELL} text-right ${pnlClass(c.pnl)}`}>{signed(c.pnl)}</td>
      <td className={`${CELL} text-right text-fg-muted ${NARROW}`}>{dateTime(c.opened, zone)}</td>
      <td className={`${CELL} text-right text-fg-muted`}>{c.open ? "Open" : dateTime(c.closed, zone)}</td>
      <td className={`${CELL} text-left text-fg-muted ${DETAIL}`}>{c.type ? orderType(c.type) : MISSING}</td>
      <td className={`${CELL} text-right text-fg-muted ${DETAIL}`}>{fixed(c.fees, 2)}</td>
      <td className={`${CELL} text-right ${DETAIL} ${pnlClass(c.funding)}`}>{signed(c.funding)}</td>
    </tr>
  );
}

/** A backtest's cycles (of the contract the chart shows, or every one on Equity), newest first: no sizes
 *  or prices, which the ledger does not store for them; the order events come back only from a
 *  reproduction, which this page never runs. The cycle picked on the equity chart is highlighted; a click on
 *  a row picks it and shows its span on the chart, marked. */
export function Cycles({ cycles, only }: { cycles: readonly Cycle[]; only: string | null }) {
  const picked = useAtom(pickedTrade), shown = only ? cycles.filter((c) => c.symbol === only) : cycles;
  if (!shown.length) return <p className="px-3 py-3 text-dense text-fg-faint">No closed cycles{only ? ` on ${only}` : ""}</p>;
  return (
    <>
      <table className="w-full border-collapse text-dense tabular-nums">
        <thead><tr>
          {!only && <th className={`${HEAD} text-left`}>Contract</th>}
          {COLUMNS.map(([name, align]) => <th key={name} className={`${HEAD} ${align}`}>{name}</th>)}
        </tr></thead>
        <tbody>{shown.map((c) => <Row key={c.id} c={c} contract={!only} picked={c.id === picked} />)}</tbody>
      </table>
      <p className="px-3 py-3 text-small text-fg-faint">Order events of a backtest come back only from a reproduction, which this page never runs.</p>
    </>
  );
}
