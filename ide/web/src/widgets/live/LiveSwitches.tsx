import { useMemo } from "react";
import { CoinChip, CoinMenu, coinGroups, type Coin } from "../../components/CoinMenu";
import { Tabs } from "../../components/Tabs";
import { sideOf } from "../../model/liveChart";
import type { LiveRun } from "../../model/liveTrading";
import { useTargets } from "../../state/shown";
import { EquityChart } from "../paper/EquityChart";
import { EquityReading } from "../paper/EquityReading";
import { liveLine, liveReading } from "./liveEquity";

export type LiveView = "equity" | "coins";

/** The live chart's switch, as the paper chart's (ChartSwitches): Equity, reading the run's account and its
 *  return on the budget beside its label, or Coins, holding the
 *  contract `symbol` shown in a capsule with the side it holds; a run on several contracts picks another from
 *  its menu (holding, traded, not traded). */
export function LiveSwitches({ run, view, symbol, onView, onSymbol }: {
  run: LiveRun; view: LiveView; symbol: string | null; onView: (view: LiveView) => void; onSymbol: (symbol: string) => void;
}) {
  const reading = liveReading(run.equity), symbols = run.symbols ?? [];
  const side = (s: string) => sideOf(run, s), coinOf = (s: string): Coin => ({ symbol: s, side: side(s) });
  const traded = new Set((run.orders ?? []).filter((o) => o.event_type === "OrderFilled").map((o) => o.instrument_id));
  const groups = coinGroups(symbols, side, (s) => traded.has(`${s}-PERP.BINANCE`));
  const after = view !== "coins" || !symbol ? undefined
    : symbols.length > 1 ? <CoinMenu groups={groups} coin={coinOf(symbol)} onPick={onSymbol} /> : <CoinChip coin={coinOf(symbol)} />;
  return <Tabs label="Chart" value={view} onChange={onView} items={[
    { id: "equity", label: reading ? <>Equity<EquityReading equity={reading} /></> : "Equity" },
    { id: "coins", label: "Coins", disabled: !symbol, hint: "No coins", after },
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
