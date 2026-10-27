// Which axis ticks a paper chart writes: none under a tag on the value axis (the levels', the last
// value's, the crosshair's), none the crosshair's time label would half cover, none so near either end
// of the time axis that the canvas would cut it, and on a crowded value axis every other one. The chart
// caches the ticks it has written, so they are written again only when the answer changes: once a pan or
// zoom has settled (`refresh`), when the tags change, and when the crosshair moves onto or off a tick
// (`cross`), never once a frame.
import type { IChartApi, ISeriesApi, SeriesType, Time, TickMarkType } from "lightweight-charts";
import { priceFormat, tick } from "./chartTheme";

type Base = ReturnType<typeof priceFormat>;
const EDGE = 32;   // px: a time label centred nearer either end than this would be cut
const CROSS = 110; // px: a time label centred this near the crosshair's would show beside it in part

export class AxisTicks {
  private x: number | null = null;
  private y: number | null = null;
  private prices: readonly number[] = [];
  private readonly seen = new Set<number>();
  private keys = { price: "", time: "" };
  private axis = 0;

  /** `series` carry the value format (the chart labels the axis with the first one's); `base` gives it;
   *  `tags` where the axis tags sit (px); a tick nearer one than `clear` px is left out; more than `most`
   *  ticks and every other one is; `shown` hears which are written. */
  constructor(private readonly chart: IChartApi, private readonly series: readonly ISeriesApi<SeriesType>[], private readonly o: {
    base: () => Base; tags: () => readonly number[]; clear: number; most?: number; shown?: (prices: readonly number[]) => void;
  }) {}

  /** Writes both axes' ticks again. */
  refresh(): void { this.writePrices(); this.writeTimes(); }

  writePrices(): void {
    const base = this.o.base(), main = this.series[0];
    if (!main) return;
    const format = { ...base, tickmarksFormatter: (prices: readonly number[]) => {
      this.prices = prices;
      const pitch = Math.abs((prices[0] ?? 0) - (prices[1] ?? 0)) || 1, shown: number[] = [];
      const out = base.tickmarksFormatter(prices).map((text, i) => {
        const price = prices[i]!, crowded = this.o.most !== undefined && prices.length > this.o.most && Math.round(price / pitch) % 2 !== 0;
        if (crowded || this.covered(main.priceToCoordinate(price))) return "";
        shown.push(price);
        return text;
      });
      this.o.shown?.(shown);
      return out;
    } };
    for (const s of this.series) s.applyOptions({ priceFormat: format });
  }

  writeTimes(): void {
    const scale = this.chart.timeScale(), plain = tick;
    this.seen.clear();
    this.chart.applyOptions({ timeScale: { tickMarkFormatter: (time: Time, type: TickMarkType) => {
      const x = scale.timeToCoordinate(time);
      if (x === null) return plain(time, type);
      this.seen.add(time as number);
      return this.cut(x, scale.width()) ? "" : plain(time, type);
    } } });
  }

  /** The crosshair at `x` px and its value-axis label at `y` px (null when it is off the chart). */
  cross(x: number | null, y: number | null): void {
    Object.assign(this, { x, y });
    const main = this.series[0], scale = this.chart.timeScale();
    const price = this.prices.filter((p) => this.near(main?.priceToCoordinate(p) ?? null, y, this.o.clear)).join();
    const time = [...this.seen].filter((t) => this.near(scale.timeToCoordinate(t as Time), x, CROSS)).join();
    if (price !== this.keys.price) { this.keys.price = price; this.writePrices(); }
    if (time !== this.keys.time) { this.keys.time = time; this.writeTimes(); }
  }

  /** The value axis at least as wide as `text` in the axis font (with the tag's padding), and never
   *  narrower than it has been, so the pane does not shift as tags and ticks come and go. */
  hold(text: string): void {
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) return;
    probe.font = `12px ${getComputedStyle(document.body).fontFamily}`;
    const w = Math.ceil(probe.measureText(text).width) + 20;
    if (w > this.axis) { this.axis = w; this.chart.applyOptions({ rightPriceScale: { minimumWidth: w } }); }
  }

  private near = (a: number | null, b: number | null, d: number) => a !== null && b !== null && Math.abs(a - b) < d;
  private covered = (y: number | null) => y !== null && (this.near(y, this.y, this.o.clear) || this.o.tags().some((t) => this.near(y, t, this.o.clear)));
  private cut = (x: number, width: number) => x < EDGE || x > width - EDGE || this.near(x, this.x, CROSS);
}
