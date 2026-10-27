// What the candle and equity charts share for redrawing at another step: when the view has settled, and
// how to keep the same moment under the same pixel across the redraw. A chart picks its step only once a
// pan or zoom is over (a step changed mid-gesture would fight the chart's own record of where the gesture
// began), then puts the time that was under the pointer (or the pane's middle) back under it, with the
// spacing scaled by the change of step, so the span in view stays the same to the pixel. The chart's time
// scale puts index i at width − (last + offset − i + ½)·spacing − 1 (Lightweight Charts' indexToCoordinate),
// which both readings below solve.
import type { ITimeScaleApi, Logical, Time } from "lightweight-charts";

const QUIET = 180;  // ms: the view counts as settled this long after it last moved with no pointer held

/** Calls `settle` once the view has settled: QUIET ms after its last change while no pointer is held on
 *  `element` (a drag, a pinch or a press on an axis holds one), with where the pointer was in the pane
 *  (px from its left, null when it is not over the pane). Returns the unsubscribe. */
export function whenSettled(element: HTMLElement, time: ITimeScaleApi<Time>, settle: (x: number | null) => void): () => void {
  let held = false, timer = 0, x: number | null = null;
  const later = () => { window.clearTimeout(timer); if (!held) timer = window.setTimeout(() => settle(x), QUIET); };
  const down = () => { held = true; window.clearTimeout(timer); };
  const up = () => { if (held) { held = false; later(); } };
  const move = (e: PointerEvent) => { const at = e.clientX - element.getBoundingClientRect().left; x = at >= 0 && at <= time.width() ? at : null; };
  const leave = () => { x = null; };
  element.addEventListener("pointerdown", down, true);
  element.addEventListener("pointermove", move, true);
  element.addEventListener("pointerleave", leave);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", up, true);
  time.subscribeVisibleLogicalRangeChange(later);
  return () => {
    window.clearTimeout(timer);
    element.removeEventListener("pointerdown", down, true);
    element.removeEventListener("pointermove", move, true);
    element.removeEventListener("pointerleave", leave);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    time.unsubscribeVisibleLogicalRangeChange(later);
  };
}

/** The spacing between two neighbouring points, in px. */
export const spacing = (time: ITimeScaleApi<Time>) => (time.logicalToCoordinate(1 as Logical) ?? 0) - (time.logicalToCoordinate(0 as Logical) ?? 0);

/** The time (s) at pane `x`, from the times of the points drawn now, each `step` seconds long. */
export function timeAt(time: ITimeScaleApi<Time>, times: readonly number[], step: number, x: number): number | null {
  const n = times.length, w = spacing(time);
  if (!n || w <= 0) return null;
  const at = n - 1 + time.scrollPosition() + 0.5 - (time.width() - 1 - x) / w, i = Math.max(0, Math.min(n - 1, Math.floor(at)));
  return times[i]! + (at - i) * step;
}

/** After the points were drawn anew at `step` (their times `times`), the view that puts time `t` at pane
 *  `x` again with each point `w` px apart. */
export function restore(time: ITimeScaleApi<Time>, times: readonly number[], step: number, t: number, x: number, w: number): void {
  const n = times.length;
  if (!n) return;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (times[mid]! <= t) lo = mid; else hi = mid - 1; }
  // Past either end the time runs on at the step; inside a gap it stops at the next point.
  const into = (t - times[lo]!) / step, at = lo + (lo < n - 1 && into > 0 ? Math.min(1, into) : into);
  time.applyOptions({ barSpacing: w });
  const actual = spacing(time) || w;
  time.scrollToPosition((time.width() - 1 - x) / actual - 0.5 - (n - 1) + at, false);
}
