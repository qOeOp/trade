import { useRef, useState } from "react";
import { CoinChip, CoinMenu, type Coin, type CoinGroup } from "../../components/CoinMenu";
import { Segmented } from "../../components/Segmented";
import { lineOf } from "../../lib/lines";
import type { PaperRun } from "../../lib/paperApi";
import { useResearchLines } from "../../state/researchLines";
import { useLandscape, usePhone } from "../../state/phone";
import { chooseStage, openBacktest, paperTab } from "../../state/stage";
import { EquityReading, useEquity } from "./EquityReading";

/** Above the chart, two switches. The stage: Backtest, Paper or Live, those the version does not have
 *  greyed (nothing runs live, so Live always is). The chart: Equity or Coins. Coins goes back to the coin last
 *  shown, or the only one; otherwise an arrow and the menu open, and closing it without a pick stays on the
 *  chart as it was. While a coin shows, Coins holds it in a small capsule, with LONG or SHORT while it
 *  holds a position (`sides`: long or not), which picks another. On the Paper stage, Equity reads the run's
 *  equity and return beside its label (a phone held upright reads them above the chart instead). `loose`: a run shown with no version drawn (a
 *  phone's Runs tab), whose Backtest opens its version's page. */
export function ChartSwitches({ testing, backtest, paper, view, symbols, sides, traded, loose }: {
  testing: boolean; backtest: boolean; paper: boolean; loose: PaperRun | null;
  view: string; symbols: readonly string[]; sides: ReadonlyMap<string, boolean>; traded: ReadonlySet<string>;
}) {
  const [picking, setPicking] = useState(false), last = useRef<string | null>(null);
  const equity = useEquity(), upright = usePhone() && !useLandscape();
  const { lines } = useResearchLines(), away = loose?.candidate ? lineOf(lines, loose.candidate) : null;
  const shown = view === "equity" ? null : view;
  if (shown) last.current = shown;
  const coinOf = (symbol: string): Coin => ({ symbol, side: !sides.has(symbol) ? null : sides.get(symbol) ? "LONG" : "SHORT" });
  const held = symbols.filter((x) => sides.has(x)), done = symbols.filter((x) => !sides.has(x) && traded.has(x)), rest = symbols.filter((x) => !sides.has(x) && !traded.has(x));
  const groups: CoinGroup[] = [{ title: "Holding", list: held }, { title: "Traded", list: done }, { title: "Not traded", list: rest }]
    .filter((g) => g.list.length).map((g) => ({ title: g.title, coins: g.list.map(coinOf) }));
  const pick = (symbol: string) => { setPicking(false); paperTab.set(symbol); };
  const coins = () => {
    if (shown) return;
    const back = symbols.length === 1 ? symbols[0]! : last.current && symbols.includes(last.current) ? last.current : null;
    if (back) pick(back); else setPicking(true);
  };
  const after = shown ? (symbols.length === 1 && symbols[0] === shown ? <CoinChip coin={coinOf(shown)} /> : <CoinMenu groups={groups} coin={coinOf(shown)} onPick={pick} />)
    : picking ? <CoinMenu groups={groups} coin={null} onPick={pick} onClose={() => setPicking(false)} /> : null;
  return (
    <>
      <Segmented label="Stage" value={testing ? "backtest" : "paper"} onChange={(stage) => {
        if (stage === "backtest" && !backtest && away && loose) openBacktest(away.bundle, loose.candidate!, loose.paper_id);
        else if (stage !== "live") chooseStage(stage);
      }} items={[
        { id: "backtest", label: "Backtest", disabled: !backtest && !away, hint: "No backtest" },
        { id: "paper", label: "Paper", disabled: !paper, hint: "No paper run" },
        { id: "live", label: "Live", disabled: true, hint: "No live run" },
      ]} />
      <Segmented label="Chart" value={shown || picking ? "coins" : "equity"} onChange={(id) => { if (id === "coins") coins(); else { setPicking(false); paperTab.set("equity"); } }} items={[
        { id: "equity", label: !testing && equity && !upright ? <>Equity<EquityReading equity={equity} /></> : "Equity" },
        { id: "coins", label: "Coins", disabled: !symbols.length, hint: "No coins", after },
      ]} />
    </>
  );
}
