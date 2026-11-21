import { useMemo } from "react";
import { dateTime } from "../../lib/time";
import { useTimeZone } from "../../state/timeZone";
import { precisions, type Precision } from "../../lib/paperApi";
import { MISSING } from "../../lib/format";
import { orders, priceText, quantityText, type Order } from "../../model/events";
import { useAtom } from "../../state/atom";
import { highlighted, showTime, type Stream } from "../../state/paperStream";
import { paperTab } from "../../state/stage";
import { Chip } from "./Events";
import { CELL, DETAIL, HEAD, usePickedScroll } from "./table";

const SHOWN = 2000;  // the latest orders listed; older ones stay in Events
const NONE: Precision = { price: -1, size: -1 };

/** The run's orders of the contract `only` (every contract when null), newest placed first. */
export function useOrders(s: Stream, only: string | null): Order[] {
  const all = useMemo(() => orders(s.lines), [s.lines]);
  return useMemo(() => (only ? all.filter((o) => o.symbol === only) : all), [all, only]);
}

function Row({ o, d, contract, picked, stopped }: { o: Order; d: Precision; contract: boolean; picked: boolean; stopped: boolean }) {
  const ref = usePickedScroll<HTMLTableRowElement>(picked), zone = useTimeZone();
  // A click shows the order on its contract's chart and marks its first event in Events.
  const pick = () => { paperTab.set(o.symbol); highlighted.set(o.line); showTime(o.placed); };
  const state = !o.done && stopped ? "Open at stop" : o.state;
  return (
    <tr ref={ref} data-selected={picked ? "" : undefined} onClick={pick} className="cursor-pointer transition-colors hover:bg-row-hover">
      <td className={`${CELL} text-right text-fg-muted`}>{dateTime(o.placed, zone)}</td>
      {contract && <td className={`${CELL} text-left`}>{o.symbol}</td>}
      <td className={`${CELL} text-left ${o.buy === null ? "text-fg-faint" : o.buy ? "text-pnl-up" : "text-pnl-down"}`}>{o.buy === null ? MISSING : o.buy ? "Buy" : "Sell"}</td>
      <td className={`${CELL} text-left text-fg-muted`}>{o.type || MISSING}{o.reduceOnly && <span className="text-fg-faint"> · reduce only</span>}</td>
      <td className={`${CELL} text-right`}>{priceText(o, d) ?? MISSING}</td>
      <td className={`${CELL} text-right ${DETAIL}`}>{quantityText(o, d)}</td>
      <td className={`${CELL} text-left`} title={o.reason ?? undefined}>
        <span className="flex min-w-0 items-center gap-2">
          <Chip status={{ text: state, failed: o.failed }} />
          {o.reason && <span className="min-w-0 truncate text-small text-fg-faint">{o.reason}</span>}
        </span>
      </td>
      <td className={`${CELL} text-right text-fg-muted`}>{dateTime(o.at, zone)}</td>
    </tr>
  );
}

/** Every order the run placed, of the contract `only` (every contract when null), newest first, filled or not:
 *  when it was placed, its side, type, price and quantity, its state now and when that state came. One still
 *  working when the run stopped says so. A click shows it on its contract's chart and marks it in Events. */
export function Orders({ s, only }: { s: Stream; only: string | null }) {
  const list = useOrders(s, only), picked = useAtom(highlighted);
  const digits = useMemo(() => precisions(s.lines), [s.lines]);
  if (!list.length) return <p className="px-3 py-3 text-dense text-fg-faint">No orders{only ? ` on ${only}` : ""}{s.seal ? "" : " yet"}</p>;
  return (
    <>
      <table className="w-full border-collapse text-dense tabular-nums">
        <thead><tr>
          <th className={`${HEAD} text-right`}>Placed</th>
          {!only && <th className={`${HEAD} text-left`}>Contract</th>}
          <th className={`${HEAD} text-left`}>Side</th><th className={`${HEAD} text-left`}>Type</th><th className={`${HEAD} text-right`}>Price</th>
          <th className={`${HEAD} text-right ${DETAIL}`}>Quantity</th><th className={`${HEAD} text-left`}>State</th><th className={`${HEAD} text-right`}>Since</th>
        </tr></thead>
        <tbody>{list.slice(0, SHOWN).map((o) => (
          <Row key={o.id} o={o} d={digits.get(o.symbol) ?? NONE} contract={!only} picked={picked === o.line} stopped={!!s.seal} />
        ))}</tbody>
      </table>
      {list.length > SHOWN && <p className="px-3 py-2 text-small text-fg-faint">The latest {SHOWN} of {list.length} orders; the rest are in Events.</p>}
    </>
  );
}
