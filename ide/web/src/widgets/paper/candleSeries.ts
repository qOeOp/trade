// The candle chart's Lightweight Charts objects (candleController.ts), made once: the chart, its volume in
// the pane's lowest fifth but the events' strip (eventFlags.ts) and its candles over it, the value axis
// fitting the candles in view with the orders' prices and the position's average price.
import { CandlestickSeries, createChart, LineStyle, type AutoscaleInfo, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { chartOptions } from "./chartTheme";
import { VolumeBars, type VolumeBar } from "./volumeBars";

export type CandleSeries = { chart: IChartApi; candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Custom", UTCTimestamp, VolumeBar> };

/** On `element`, the value axis also fitting `prices()`. */
export function candleSeries(element: HTMLElement, prices: () => readonly number[]): CandleSeries {
  const chart = createChart(element, chartOptions());
  chart.applyOptions({ handleScale: { axisPressedMouseMove: { time: true, price: false } } });
  // Added first so the candles draw over it.
  const volume = chart.addCustomSeries(new VolumeBars(), { priceScaleId: "", priceLineVisible: false, lastValueVisible: false,
    autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => { const found = base(); return found?.priceRange ? { ...found, priceRange: { ...found.priceRange, minValue: 0 } } : found; } }) as CandleSeries["volume"];
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0.045 } });
  // The last price's tag is the levels' own (levels.ts); the series' would follow the last candle in view.
  // Its line sparsely dotted, unlike the orders' dashes.
  const candles = chart.addSeries(CandlestickSeries, { borderVisible: false, lastValueVisible: false, priceLineStyle: LineStyle.SparseDotted,
    autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
      const found = base(), more = prices();
      if (!found?.priceRange || !more.length) return found;
      return { ...found, priceRange: { minValue: Math.min(found.priceRange.minValue, ...more), maxValue: Math.max(found.priceRange.maxValue, ...more) } };
    } });
  candles.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.23 }, entireTextOnly: true });  // the gaps' bands start at its top (eventFlags.ts)
  return { chart, candles, volume };
}
