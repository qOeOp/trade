import { useEffect, useRef, useState } from "react";
import type { JournalLine } from "../../lib/paperApi";
import { utc, type Fill, type Held, type PriceLine } from "../../model/paper";
import { useAtom } from "../../state/atom";
import { chartTime, pickedDay } from "../../state/paperStream";
import { useResolvedTheme } from "../../state/theme";
import { CandleController } from "./candleController";
import { CandleLegend } from "./CandleLegend";
import { ChartTip } from "./ChartTip";

/** A contract's candles (candleController.ts): their period picked for the span in view, so the user
 *  never picks one, the whole run in view when it first shows; its volume beneath them; the run's
 *  trades as boxes and arrows, its orders and position as levels, its events as flags along the foot
 *  with tooltips on them and on the arrows (candleNotes.ts). The component only hands the chart
 *  what changes: the bars, the trading, the theme, and where to look (a change of `fit` brings the
 *  position's whole stretch into view; an event picked elsewhere, or a calendar day). */
export function CandleChart({ symbol, bars, places, size, fills, orders, held, events, live, openFrom, started, fit }: {
  symbol: string; bars: readonly JournalLine[]; places: number; size: number; fills: readonly Fill[]; orders: readonly PriceLine[];
  held: Held | null; events: readonly JournalLine[]; live: boolean; openFrom: number | null; started: number | null; fit: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [chart] = useState(() => new CandleController());
  const dark = useResolvedTheme() === "dark";
  const focus = useAtom(chartTime);
  const day = useAtom(pickedDay);
  const shown = useAtom(chart.period) > 0;

  useEffect(() => { chart.mount(host.current!); return () => chart.destroy(); }, [chart]);
  useEffect(() => { chart.setTheme(dark); }, [chart, dark]);
  useEffect(() => { chart.setTrading({ fills, orders, held, places, size, events, live }); }, [chart, fills, orders, held, places, size, events, live]);
  useEffect(() => { chart.setBars(bars); }, [chart, bars]);
  useEffect(() => { if (fit && openFrom !== null) chart.showPosition(openFrom); }, [chart, fit]);
  useEffect(() => { if (focus) chart.showAround(focus.ms); }, [chart, focus]);
  useEffect(() => {
    if (!day || !shown) return;
    const start = Date.parse(`${day}T00:00:00Z`) / 1000;
    chart.show(start, start + 86_400);
  }, [chart, day, shown]);

  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={host} className="h-full w-full" />
      <CandleLegend chart={chart} places={places} />
      <ChartTip tip={chart.notes.tip} />
      {!bars.length && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-dense text-fg-faint">
          Waiting for the first {symbol} bar{started ? ` · started ${utc(started).slice(11)} UTC` : ""}
        </p>
      )}
    </div>
  );
}
