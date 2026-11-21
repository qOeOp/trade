import { DAY_S, dateTime, dayStart } from "../../lib/time";
import { useTimeZone } from "../../state/timeZone";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { JournalLine } from "../../lib/paperApi";
import { type Fill, type Held, type PriceLine, type Restart } from "../../model/paper";
import { useAtom } from "../../state/atom";
import { chartFocus, pickedDay } from "../../state/paperStream";
import { useResolvedTheme } from "../../state/theme";
import type { Lead } from "./backtestCandles";
import { CandleController } from "./candleController";
import type { CandleSpan } from "./candleStretches";
import { CandleLegend } from "./CandleLegend";
import { ChartTip } from "./ChartTip";
import { stretchKey } from "./stretchKeys";

/** A contract's candles (candleController.ts): their period picked for the span in view, so the user
 *  never picks one, the whole run in view when it first shows; its volume beneath them; the run's
 *  trades as boxes and arrows, its orders and position as levels, its events as flags along the foot
 *  with tooltips on them and on the arrows (candleNotes.ts). The component only hands the chart
 *  what changes: the bars, the trading, the theme, and where to look (a change of `fit` brings the
 *  position's whole stretch into view; an event picked elsewhere, a trade picked in a table, which it
 *  also marks, or a calendar day). `remembers` names the
 *  version and contract: the view the chart had when it last showed them comes back with them. The bars are
 *  the version's stretches' one after another (`stretches`, candleStretches.ts), each named at its first
 *  candle (a lone one's at the legend's head); a click on a name shows that stretch, and the keys are stretchKeys'. Before them may come the
 *  backtest's (`lead`, backtestCandles.ts); the legend ends in `note`. */
export function CandleChart({ remembers, symbol, bars, lead, note, stretches, places, size, fills, boxes = true, orders, held, events, live, restarts, openFrom, started, warmup = null, fit }: {
  remembers: string; symbol: string; bars: readonly JournalLine[]; lead: Lead | null; note: string | null; stretches: readonly CandleSpan[]; places: number; size: number; fills: readonly Fill[]; boxes?: boolean; orders: readonly PriceLine[];
  held: Held | null; events: readonly JournalLine[]; live: boolean; restarts: readonly Restart[]; openFrom: number | null; started: number | null; warmup?: number | null; fit: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [chart] = useState(() => new CandleController());
  const dark = useResolvedTheme() === "dark", zone = useTimeZone();
  const focus = useAtom(chartFocus);
  const day = useAtom(pickedDay);
  const shown = useAtom(chart.period) > 0;

  useEffect(() => { chart.mount(host.current!, remembers); return () => chart.destroy(); }, [chart]);
  useEffect(() => { chart.setTimeZone(zone); }, [chart, zone]);
  useEffect(() => { chart.setTheme(dark); }, [chart, dark]);
  // A span picked in a table (a trade) marked, and shown with as much again either side, twenty candles at least.
  const picked = useMemo(() => (focus?.mark ? { from: Math.floor(focus.from / 1000), to: Math.floor(focus.to / 1000) } : null), [focus]);
  useEffect(() => { chart.setTrading({ fills, boxes, orders, held, places, size, events, live, restarts, picked }); }, [chart, fills, boxes, orders, held, places, size, events, live, restarts, picked]);
  useEffect(() => { chart.setStretches(stretches); }, [chart, stretches]);
  useEffect(() => { chart.setBars(bars, lead); }, [chart, bars, lead]);
  useEffect(() => { if (fit && openFrom !== null) chart.showPosition(openFrom); }, [chart, fit]);
  // A moment picked (an event) shown around it; a span picked (a trade) shown and marked, once the candles have a period.
  useEffect(() => {
    const step = chart.period.get() * 60, pad = picked && Math.max(picked.to - picked.from, step * 20);
    if (picked && step) chart.show(picked.from - pad!, picked.to + pad! + step); else if (focus && !focus.mark) chart.showAround(focus.from);
  }, [chart, focus, shown]);
  useEffect(() => {
    if (!day || !shown) return;
    chart.show(dayStart(day), dayStart(day) + DAY_S);
  }, [chart, day, shown]);

  const onKey = (e: KeyboardEvent) => { if (stretchKey(e.key, stretches, chart.stretches.shown, (k) => chart.fitStretch(k), () => chart.whole())) e.preventDefault(); };
  return (
    <div className="relative h-full min-h-0 w-full outline-none @max-md/page:pt-(--header-h)" tabIndex={0} onKeyDown={onKey}>
      <div ref={host} className="h-full w-full" />
      <CandleLegend chart={chart} places={places} name={stretches.length === 1 ? stretches[0]!.label : null} note={note} />
      <ChartTip tip={chart.notes.tip} />
      {/* Over the chart's own layers (z-index 1), taking the pointer so an empty chart draws no crosshair. */}
      {!bars.length && !lead && (
        <p className="absolute inset-0 z-10 grid place-items-center text-dense text-fg-faint">
          Waiting for the first {symbol} bar{warmup !== null ? ` · the run starts at ${dateTime(warmup, zone, "minute")}, after its warm-up` : started ? ` · started ${dateTime(started, zone, "minute")}` : ""}
        </p>
      )}
    </div>
  );
}
