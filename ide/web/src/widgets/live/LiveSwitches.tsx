import { useMemo } from "react";
import { CoinChip, type Coin } from "../../components/CoinMenu";
import { Tabs } from "../../components/Tabs";
import type { LiveRun } from "../../model/liveTrading";
import { useLandscape, usePhone } from "../../state/phone";
import { useTargets } from "../../state/shown";
import { EquityChart } from "../paper/EquityChart";
import { EquityReading } from "../paper/EquityReading";
import { liveLine, liveReading } from "./liveEquity";

export type LiveView = "equity" | "coins";

/** The side the run's contract holds, from its latest native position event: none once the run ended. */
function sideOf(run: LiveRun, symbol: string): Coin["side"] {
  const last = run.ended ? null : (run.positions ?? []).filter((p) => p.instrument_id === `${symbol}-PERP.BINANCE`).at(-1);
  return last && last.event_type !== "PositionClosed" && (last.side === "LONG" || last.side === "SHORT") ? last.side : null;
}

/** The live chart's switch, as the paper chart's (ChartSwitches): Equity, reading the run's account and its
 *  return on the budget beside its label (a phone held upright leaves them out), or Coins, holding the
 *  run's one contract in a capsule with the side it holds. */
export function LiveSwitches({ run, view, onView }: { run: LiveRun; view: LiveView; onView: (view: LiveView) => void }) {
  const phone = usePhone(), landscape = useLandscape(), reading = liveReading(run.equity), symbol = run.symbols?.[0] ?? null;
  return <Tabs label="Chart" value={view} onChange={onView} items={[
    { id: "equity", label: reading && !(phone && !landscape) ? <>Equity<EquityReading equity={reading} /></> : "Equity" },
    { id: "coins", label: "Coins", disabled: !symbol, hint: "No contract", after: view === "coins" && symbol ? <CoinChip coin={{ symbol, side: sideOf(run, symbol) }} /> : undefined },
  ]} />;
}

/** The run's account over its minutes (liveEquity.ts), with the line's targets; a run whose runtime records
 *  no minute results, or none known yet, says so in its place. */
export function LiveEquity({ run }: { run: LiveRun }) {
  const { annual, limit } = useTargets();
  const line = useMemo(() => (run.equity ? liveLine(run.equity, annual) : null), [run.equity, annual]);
  if (!line) return <p className="grid h-full place-items-center px-3 text-center text-dense text-fg-faint">
    {run.equity ? "No minute of this run has a known result yet" : "This run recorded no minute results: its runtime predates them"}
  </p>;
  return <EquityChart line={line} remembers={`live:${run.id}:equity`} annual={annual} limit={limit} />;
}
