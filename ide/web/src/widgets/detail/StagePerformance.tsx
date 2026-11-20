import { Fragment, useMemo } from "react";
import { bridge } from "../../model/bridge";
import { useBacktest } from "../../state/backtest";
import { useRunData } from "../../state/runData";
import { useShown } from "../../state/shown";
import { useStageReading } from "../../state/stageReading";
import { Eased } from "../../components/Eased";
import { Skeleton } from "../../components/Missing";
import { CardGroup, Section } from "../../components/Section";
import { Calendar } from "../paper/Calendar";
import { PnlBridge } from "../paper/Bridge";
import { MarketExposure, PeriodsAndRegimes } from "../paper/MarketExposure";
import { Performance } from "../paper/Performance";

const BARS = [35, -25, 60, 20, -45, 80, -15, 40, -55, 30, 70, -30, 25, -40, 50, 15, -65, 45, -20, 55, 30, -35, 65, -25];

function PerformanceSkeleton() {
  return (
    <div className="space-y-2">
      <Section title="Trades">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 text-small">
              <Skeleton className="w-14" /><Skeleton className="w-28" />
            </div>
            <div aria-hidden="true" className="flex h-28 items-center gap-1 py-2">
              {BARS.map((h, i) => (
                <span key={i} className="relative h-full min-w-0 flex-1">
                  <i className="skeleton absolute left-1/2 w-1.5 -translate-x-1/2 rounded-badge"
                     style={h >= 0 ? { bottom: "50%", height: `${h / 2}%` } : { top: "50%", height: `${-h / 2}%` }} />
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3 text-small">
              <span className="mr-auto text-fg-muted">Exits</span>
              {["Target", "Stop", "Other"].map((name) => <span key={name} className="inline-flex items-center gap-1.5 text-fg-muted">{name} <Skeleton className="w-4" /></span>)}
            </div>
            <div className="skeleton h-1 rounded-full" />
          </div>
        </div>
      </Section>
      <Section title="Long and short" aside="closed trades, after fees">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-small text-fg-muted">
              <span>Long <Skeleton className="w-6" /></span><span>Short <Skeleton className="w-6" /></span>
            </div>
            <div className="skeleton h-1 rounded-full" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,auto)] gap-x-4 gap-y-1 text-dense">
            <span /><span className="text-right text-small text-fg-faint">Trades</span>
            <span className="text-right text-small text-fg-faint">Win rate</span><span className="text-right text-small text-fg-faint">P&L</span>
            {["Long", "Short"].map((side) => (
              <Fragment key={side}>
                <span className="text-fg-muted">{side}</span>
                <span className="text-right"><Skeleton className="w-6" /></span>
                <span className="text-right"><Skeleton className="w-10" /></span>
                <span className="text-right"><Skeleton className="w-12" /></span>
              </Fragment>
            ))}
          </div>
        </div>
      </Section>
      <Section title="Calendar">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="w-20" /><Skeleton className="w-10" />
          </div>
          <div className="grid grid-cols-7 gap-0.5">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <span key={w} className="text-center text-small text-fg-faint">{w}</span>)}</div>
          <div className="grid grid-cols-7 gap-0.5 auto-rows-9">
            {Array.from({ length: 28 }, (_, i) => <span key={i} className="skeleton rounded-card opacity-45" />)}
          </div>
        </div>
      </Section>
      <Section title="Profit and loss">
        <div className="flex flex-col gap-1 text-dense">
          {["Gross", "Fees", "Funding", "Net"].map((row) => (
            <div key={row} className="grid grid-cols-[64px_minmax(0,1fr)_84px] items-center gap-2 py-0.5">
              <span className={row === "Net" ? "font-semibold text-fg" : "text-fg-muted"}>{row}</span>
              <span className="skeleton h-1 rounded-full" />
              <span className="text-right"><Skeleton className="w-12" /></span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** The Performance group of the selected version's detail, on either page: the stage the Runs page shows
 *  (state/shown.ts), named at the right. Its closed trades (a backtest's cycles, a paper run's trades)
 *  by side and contract, its calendar and what moved its equity. While its report or stream is read
 *  a skeleton of the group's cards stands in their place. None while the stage has nothing to show here. */
export function StagePerformance() {
  const { stage, run, name } = useShown(), data = useRunData(), backtest = useBacktest(), reading = useStageReading();
  const tested = stage === "backtest" && backtest?.kind === "ready" ? backtest.b : null;
  const paper = stage === "paper" && data && data.run.paper_id === run?.paper_id ? data : null;
  const testedBridge = useMemo(() => (tested?.account ? bridge(tested.account, tested.cycles.map((c) => ({ symbol: c.symbol, pnl: c.pnl ?? 0, gross: c.gross }))) : null), [tested]);
  const shown = tested?.account && tested.stats ? { a: tested.account, stats: tested.stats, bridge: testedBridge, exposures: tested.exposures, periods: tested.periods, fills: null, of: "backtest" as const }
    : paper?.a && paper.stats ? { a: paper.a, stats: paper.stats, bridge: paper.bridge, exposures: [], periods: null, fills: paper.fills, of: "paper" as const } : null;
  if (!shown && !reading) return null;
  return (
    <CardGroup title="Performance" actions={<span className="min-w-0 truncate text-fg-faint">{name ?? (reading ? <Skeleton className="w-24" /> : null)}</span>}>
      <Eased>
        {shown ? (
          <div className="space-y-2">
            <Performance a={shown.a} stats={shown.stats} />
            <MarketExposure rows={shown.exposures} />
            {shown.periods && <PeriodsAndRegimes p={shown.periods} />}
            <Calendar a={shown.a} fills={shown.fills} stage={shown.of} />
            {shown.bridge && <Section title="Profit and loss"><PnlBridge a={shown.a} b={shown.bridge} /></Section>}
          </div>
        ) : <PerformanceSkeleton />}
      </Eased>
    </CardGroup>
  );
}
