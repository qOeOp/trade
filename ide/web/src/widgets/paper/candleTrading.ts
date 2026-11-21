// What the candle chart (candleController.ts) draws of the run's trading over its candles: the span picked in a
// table marked (spanMark.ts), the trades as boxes and arrows (tradeMarks.ts), the events along the foot (candleNotes.ts), the orders and the position
// as levels with their dashed lines (chartLevels.ts), and the value axis's prices and room above the highs.
import type { IPriceLine } from "lightweight-charts";
import type { Candle } from "../../lib/bars";
import type { JournalLine } from "../../lib/paperApi";
import type { Fill, Held, PriceLine, Restart } from "../../model/paper";
import type { AxisTicks } from "./axisTicks";
import type { CandleNotes } from "./candleNotes";
import type { CandleSeries } from "./candleSeries";
import { chartLevels, lastLevel, orderLines } from "./chartLevels";
import { priceFormat, seriesColors } from "./chartTheme";
import type { Down } from "./downLook";
import type { Levels } from "./levels";
import { slotEdge, SpanMark } from "./spanMark";
import { arrows, tradeBoxes } from "./tradeBoxes";
import type { TradeMarks } from "./tradeMarks";

/** `boxes`: whether the fills are netted into position boxes (Paper, backtest); Live draws its fills alone. `picked`: the span (s) picked in a table. */
export type Trading = { fills: readonly Fill[]; boxes: boolean; orders: readonly PriceLine[]; held: Held | null; places: number; size: number; events: readonly JournalLine[]; live: boolean; restarts: readonly Restart[];
  picked?: { from: number; to: number } | null };
export type Parts = CandleSeries & { marks: TradeMarks; levels: Levels; ticks: AxisTicks; picked: SpanMark };
/** The chart's candles at `minutes` from `bars`, its offline stretches, its theme and its orders' lines by id. */
type Drawn = { minutes: number; data: readonly Candle[]; bars: readonly JournalLine[]; downs: Down[]; dark: boolean; lines: Map<string, IPriceLine> };

/** The mark of a span picked in a table, across the slots `times()` (s) of the chart's time scale. */
export const pickedMark = (times: () => readonly number[]) => new SpanMark(slotEdge(times));

export function drawTrading(p: Parts, notes: CandleNotes, trading: Trading, { minutes, data, bars, downs, dark, lines }: Drawn): void {
  const { fills, orders, held, places, size, events, live } = trading, c = seriesColors(dark), last = data.at(-1) ?? null, mark = last?.close ?? null;
  const boxes = trading.boxes ? tradeBoxes(fills, minutes, held, mark, last?.time ?? null, bars, trading.restarts) : [];
  p.picked.set(trading.picked ?? null, c.picked);
  p.marks.set(boxes, arrows(fills, minutes, data), c.marks);
  notes.set({ events, fills, boxes, minutes, times: data.map((k) => k.time), downs, places, size, live, lastBar: bars.length ? Number(bars.at(-1)!.ts_event) / 1e6 : null, look: c.flags });
  const levels = chartLevels({ orders, held, mark, places, size, c });
  orderLines(p.candles, lines, levels);
  p.levels.set(levels, { island: c.island, font: c.font }, lastLevel(last, places, c, dark));
  p.ticks.writePrices();
  p.ticks.hold(`↑ ${priceFormat(Math.max(0, places)).formatter((last?.high ?? 0) * 1.1)}`);
}
