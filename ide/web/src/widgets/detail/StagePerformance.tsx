import { useMemo } from "react";
import { bridge } from "../../model/bridge";
import { backtestNote, useBacktest } from "../../state/backtest";
import { useRunData } from "../../state/runData";
import { useShown } from "../../state/shown";
import { Eased } from "../../components/Eased";
import { useHeld } from "../../components/hooks/useHeld";
import { CardGroup, Section } from "../../components/Section";
import { Typing } from "../../components/Typing";
import { Calendar } from "../paper/Calendar";
import { PnlBridge } from "../paper/Bridge";
import { Performance } from "../paper/Performance";

/** The Performance group of the selected version's detail, on either page: the stage the Runs page shows
 *  (state/shown.ts), named at the right. Its closed trades (a backtest's cycles, a paper run's trades)
 *  by side and contract, its calendar and what moved its equity. While its report is read
 *  the last stage's cards stay, unseen, so the group holds its height and what stands below it its place,
 *  and then ease to the new ones. None while the stage has nothing to show here. */
export function StagePerformance() {
  const { stage, trial, run, name } = useShown(), data = useRunData(), backtest = useBacktest();
  const tested = stage === "backtest" && backtest?.kind === "ready" ? backtest.b : null;
  const paper = stage === "paper" && data && data.run.paper_id === run?.paper_id ? data : null;
  const testedBridge = useMemo(() => (tested?.account ? bridge(tested.account, tested.cycles.map((c) => ({ symbol: c.symbol, pnl: c.pnl ?? 0, gross: c.gross }))) : null), [tested]);
  const shown = tested?.account && tested.stats ? { a: tested.account, stats: tested.stats, bridge: testedBridge, fills: null, of: "backtest" as const }
    : paper?.a && paper.stats ? { a: paper.a, stats: paper.stats, bridge: paper.bridge, fills: paper.fills, of: "paper" as const } : null;
  const reading = stage === "backtest" && backtest?.kind === "reading", cards = useHeld(shown, reading);
  if (!cards && !reading) return null;
  return (
    <CardGroup title="Performance" actions={<span className="min-w-0 truncate text-fg-faint">{name}</span>}>
      <Eased className="relative">
        {reading && <div className={cards ? "absolute inset-x-1" : "px-1"}><Typing text={backtestNote(backtest, trial?.trial_id ?? 0) ?? ""} busy className="text-fg-faint" /></div>}
        {cards && <div className={`space-y-2 ${shown ? "" : "invisible"}`}>
          <Performance a={cards.a} stats={cards.stats} />
          <Calendar a={cards.a} fills={cards.fills} stage={cards.of} />
          {cards.bridge && <Section title="Profit and loss"><PnlBridge a={cards.a} b={cards.bridge} /></Section>}
        </div>}
      </Eased>
    </CardGroup>
  );
}
