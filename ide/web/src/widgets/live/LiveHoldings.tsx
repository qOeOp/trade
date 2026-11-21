import { InfoTip } from "../../ui/InfoTip";
import { Side } from "../../ui/PhoneParts";
import { MISSING } from "../../lib/format";
import { fixed, signed } from "../../lib/paperApi";
import { heldGap } from "../../model/liveHeld";
import type { LiveRun } from "../../model/liveTrading";
import { liveHeld, liveWorking, marked, protects, stopFor } from "../../model/phoneRuns";
import { useSnapshot } from "../../state/market";
import { pnlClass, textClass } from "../../theme/roles";

const NOTE = "As the run's native events last say (the phone's run page reads the same). P&L is estimated at the "
  + "overview's Binance price. Binance is the account of record.";

/** What a live run holds and its working orders, one readout line each, as the identity line above them: each
 *  position with its protective stop (No stop while it runs without one, in the failure hue once the latest check of
 *  the stops at Binance found none) and an estimated P&L, then each other working order. */
export function LiveHoldings({ run }: { run: LiveRun }) {
  const held = marked(liveHeld(run), useSnapshot()?.coins), working = liveWorking(run);
  // A protective stop is shown on its position; the rest are the orders still working.
  const orders = working.filter((o) => !protects(o, held));
  return <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-1 gap-y-1 text-small">
    <dt className="text-fg-faint">Positions</dt>
    <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {held.length ? held.map((h) => {
        // A running position without a stop is flagged always; in the failure hue once the check of the stops at
        // Binance found it without one.
        const stop = stopFor(h, working)?.trigger ?? null, gap = run.running && heldGap(run.heldAlert, h.symbol, h.long);
        return <span key={h.key} className="whitespace-nowrap tabular-nums">
          {h.symbol} <Side long={h.long} /> {fixed(h.qty)} @ {fixed(h.entry) ?? MISSING}
          <span className="text-fg-faint"> · SL </span>{stop !== null ? fixed(stop) : run.running ? <span className={textClass(gap ? "fail" : "misses")}>No stop</span> : <span className="text-fg-faint">{MISSING}</span>}
          <span className="text-fg-faint"> · P&L ≈ </span><span className={pnlClass(h.pnl)}>{signed(h.pnl)}</span>
        </span>;
      }) : <span className="text-fg-faint">None open</span>}
      <InfoTip text={NOTE} label="Where these come from" />
    </dd>
    <dt className="text-fg-faint">Open orders</dt>
    <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
      {orders.length ? orders.map((o) => <span key={o.key} className="whitespace-nowrap tabular-nums">
        {o.symbol} {o.type} <Side long={o.buy} word={o.buy === null ? undefined : o.buy ? "Buy" : "Sell"} /> {fixed(o.qty) ?? MISSING} @ {fixed(o.trigger ?? o.price) ?? MISSING}
      </span>) : <span className="text-fg-faint">None</span>}
    </dd>
  </dl>;
}
