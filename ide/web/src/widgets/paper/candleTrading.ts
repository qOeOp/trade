// What the candle chart (candleController.ts) draws of the run's trading over its candles: the trades as
// boxes and arrows (tradeMarks.ts), the events along the foot (candleNotes.ts), the orders and the position
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
import { arrows, tradeBoxes } from "./tradeBoxes";
import type { TradeMarks } from "./tradeMarks";

export type Trading = { fills: readonly Fill[]; orders: readonly PriceLine[]; held: Held | null; places: number; size: number; events: readonly JournalLine[]; live: boolean; restarts: readonly Restart[] };
export type Parts = CandleSeries & { marks: TradeMarks; levels: Levels; ticks: AxisTicks };
/** The chart's candles at `minutes` from `bars`, its offline stretches, its theme and its orders' lines by id. */
export type Drawn = { minutes: number; data: readonly Candle[]; bars: readonly JournalLine[]; downs: Down[]; dark: boolean; lines: Map<string, IPriceLine> };

export function drawTrading(p: Parts, notes: CandleNotes, trading: Trading, { minutes, data, bars, downs, dark, lines }: Drawn): void {
  const { fills, orders, held, places, size, events, live } = trading, c = seriesColors(dark), last = data.at(-1) ?? null, mark = last?.close ?? null;
  const boxes = tradeBoxes(fills, minutes, held, mark, last?.time ?? null, bars, trading.restarts);
  p.marks.set(boxes, arrows(fills, minutes, data), c.marks);
  notes.set({ events, fills, boxes, minutes, times: data.map((k) => k.time), downs, places, size, live, lastBar: bars.length ? Number(bars.at(-1)!.ts_event) / 1e6 : null, look: c.flags });
  const levels = chartLevels({ orders, held, mark, places, size, c });
  orderLines(p.candles, lines, levels);
  p.levels.set(levels, { island: c.island, font: c.font }, lastLevel(last, places, c, dark));
  p.ticks.writePrices();
  p.ticks.hold(`↑ ${priceFormat(Math.max(0, places)).formatter((last?.high ?? 0) * 1.1)}`);
}
