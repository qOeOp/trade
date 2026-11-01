import { useMemo } from "react";
import { flows } from "../../model/flows";
import { useBacktest } from "../../state/backtest";
import { useRunData } from "../../state/runData";
import { useShown } from "../../state/shown";
import { CardGroup, Section } from "../../components/Section";
import { Calendar } from "../paper/Calendar";
import { PnlFlow } from "../paper/Flow";
import { Performance } from "../paper/Performance";

/** The Performance group of the selected version's detail, on either page: the stage the Runs page shows
 *  (state/shown.ts), named at the right. Its closed trades (a backtest's cycles, a paper run's trades)
 *  and what they say, its calendar and what moved its equity (folded at first). None while the stage has
 *  nothing to show here. */
export function StagePerformance({ className }: { className?: string }) {
  const { stage, run, name } = useShown(), data = useRunData(), backtest = useBacktest();
  const tested = stage === "backtest" && backtest?.kind === "ready" ? backtest.b : null;
  const paper = stage === "paper" && data && data.run.paper_id === run?.paper_id ? data : null;
  const testedFlows = useMemo(() => (tested?.account ? flows(tested.account, tested.cycles.map((c) => ({ symbol: c.symbol, pnl: c.pnl ?? 0, gross: c.gross })), 2) : null), [tested]);
  const shown = tested?.account && tested.stats ? { a: tested.account, stats: tested.stats, flows: testedFlows, fills: null }
    : paper?.a && paper.stats ? { a: paper.a, stats: paper.stats, flows: paper.flows, fills: paper.fills } : null;
  if (!shown) return null;
  return (
    <CardGroup title="Performance" actions={<span className="min-w-0 truncate text-fg-faint">{name}</span>} className={className}>
      <Performance a={shown.a} stats={shown.stats} />
      <Calendar a={shown.a} fills={shown.fills} stage={tested ? "backtest" : "paper"} />
      {shown.flows && <Section title="Profit and loss" open={false}><PnlFlow a={shown.a} f={shown.flows} /></Section>}
    </CardGroup>
  );
}
