import { useRef, useState } from "react";
import { CoinChip, CoinMenu, type Coin, type CoinGroup } from "../../components/CoinMenu";
import { Tabs } from "../../components/Tabs";
import type { PaperRun } from "../../lib/paperApi";
import { paperTab } from "../../state/stage";
import { RunStages } from "../runs/RunStages";
import { useLandscape, usePhone } from "../../state/phone";
import { EquityReading, useEquity } from "./EquityReading";

const RULE = "mx-2 h-4 w-px shrink-0 bg-line-strong";

/** Above the chart, two switches. The shared stage selector switches Backtest, Paper and Live. The
 *  chart chooses Equity or Coins. Coins goes back to the coin last
 *  shown, or the only one; otherwise an arrow and the menu open, and closing it without a pick stays on the
 *  chart as it was. While a coin shows, Coins holds it in a small capsule, with LONG or SHORT while it
 *  holds a position (`sides`: long or not), which picks another. On the Paper stage, Equity reads the run's
 *  equity and return beside its label (a phone held upright reads them above the chart instead). `loose`: a run shown with no version drawn (a
 *  phone's Runs tab), whose Backtest opens its version's page. Both are text tabs (components/Tabs.tsx), as the
 *  Trades window's below, a rule between them. */
export function ChartSwitches({ testing, backtest, paper, view, symbols, sides, traded, loose }: {
  testing: boolean; backtest: boolean; paper: boolean; loose: PaperRun | null;
  view: string; symbols: readonly string[]; sides: ReadonlyMap<string, boolean>; traded: ReadonlySet<string>;
}) {
  const [picking, setPicking] = useState(false), last = useRef<string | null>(null);
  const equity = useEquity(), phone = usePhone(), landscape = useLandscape(), upright = phone && !landscape;
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
    // Each group leads with a rule; the row is pulled left by one rule and its margins, so a group that
    // starts a line (the row wraps when narrow) has its rule clipped and never hangs at a line's end.
    <div className="min-w-0 overflow-hidden">
      <div className="-ml-[17px] flex flex-wrap items-center gap-y-1">
        <span className="flex items-center"><span aria-hidden className={RULE} /><RunStages backtest={backtest} paper={paper} loose={loose} /></span>
        <span className="flex min-w-0 items-center"><span aria-hidden className={RULE} /><Tabs label="Chart" value={shown || picking ? "coins" : "equity"} onChange={(id) => { if (id === "coins") coins(); else { setPicking(false); paperTab.set("equity"); } }} items={[
        { id: "equity", label: !testing && equity && !upright ? <>Equity<EquityReading equity={equity} /></> : "Equity" },
        { id: "coins", label: "Coins", disabled: !symbols.length, hint: "No coins", after },
      ]} /></span>
      </div>
    </div>
  );
}
