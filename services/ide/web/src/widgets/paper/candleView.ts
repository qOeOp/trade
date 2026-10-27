// Where the candle chart's view goes after its candles are drawn anew: the whole run when it first shows
// (a young run's candles no wider than WIDEST, the newest at the right and the rest of the pane empty);
// after a change of period the span of time the view had, or, when that reached the newest candle, the
// same start with the space to the right of the newest kept.
import type { ITimeScaleApi, Time, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../../lib/bars";

const WIDEST = 24;  // px: a young run's candles when it first shows, at most

export function placeView(time: ITimeScaleApi<Time>, data: readonly Candle[], fit: boolean, keep: { from: number; to: number; newest: boolean } | null): void {
  const n = data.length;
  if (!n) return;
  if (fit) {
    if (time.width() / (n + time.options().rightOffset) > WIDEST) { time.applyOptions({ barSpacing: WIDEST }); time.scrollToRealTime(); }
    else time.fitContent();
  } else if (keep) {
    if (keep.newest) time.setVisibleLogicalRange({ from: Math.max(0, data.findIndex((k) => k.time >= keep.from)), to: n - 1 + time.options().rightOffset });
    else time.setVisibleRange({ from: keep.from as UTCTimestamp, to: keep.to as UTCTimestamp });
  }
}
