// A contract's volume as a custom series beneath its candles in the same pane, as TradingView draws it:
// each bar exactly as wide as its candle's body and on the same device pixels (Lightweight Charts'
// optimalCandlestickWidth and its odd-or-even rule against the wick), so bars and bodies line up and
// keep a gap between them, which the chart's own histogram (a candle's full spacing wide) does not.
// Each bar takes its colour from its datum (`color`, which the chart hands the renderer as `barColor`).
import { customSeriesDefaultOptions, type CustomData, type CustomSeriesOptions, type CustomSeriesWhitespaceData, type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView, type PaneRendererCustomData, type PriceToCoordinateConverter, type Time } from "lightweight-charts";

export type VolumeBar = CustomData<Time> & { value: number; color: string };
type Target = Parameters<ICustomSeriesPaneRenderer["draw"]>[0];

/** A candle body's width in device pixels at `spacing` px (Lightweight Charts' own rule). */
export function bodyWidth(spacing: number, ratio: number): number {
  const coeff = 1 - 0.2 * Math.atan(Math.max(4, spacing) - 4) / (Math.PI / 2);
  let w = spacing >= 2.5 && spacing <= 4 ? Math.floor(3 * ratio) : Math.max(Math.floor(ratio), Math.min(Math.floor(spacing * coeff * ratio), Math.floor(spacing * ratio)));
  if (w >= 2 && Math.floor(ratio) % 2 !== w % 2) w--;
  return w;
}

class Renderer implements ICustomSeriesPaneRenderer {
  data: PaneRendererCustomData<Time, VolumeBar> | null = null;

  draw(target: Target, y: PriceToCoordinateConverter): void {
    const d = this.data;
    if (!d?.visibleRange) return;
    target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const w = bodyWidth(d.barSpacing, hr), base = Math.round((y(0) ?? 0) * vr);
      for (let i = d.visibleRange!.from; i < d.visibleRange!.to; i++) {
        const bar = d.bars[i]!, top = y(bar.originalData.value);
        if (top === null) continue;
        c.fillStyle = bar.barColor;
        c.fillRect(Math.round(bar.x * hr) - Math.floor(w / 2), Math.round(top * vr), w, base - Math.round(top * vr));
      }
    });
  }
}

export class VolumeBars implements ICustomSeriesPaneView<Time, VolumeBar> {
  private readonly view = new Renderer();
  renderer(): ICustomSeriesPaneRenderer { return this.view; }
  update(data: PaneRendererCustomData<Time, VolumeBar>): void { this.view.data = data; }
  priceValueBuilder(bar: VolumeBar): number[] { return [0, bar.value, bar.value]; }
  isWhitespace(bar: VolumeBar | CustomSeriesWhitespaceData<Time>): bar is CustomSeriesWhitespaceData<Time> { return (bar as Partial<VolumeBar>).value === undefined; }
  defaultOptions(): CustomSeriesOptions { return customSeriesDefaultOptions; }
}
