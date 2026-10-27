// A chart's jump to another span of time (a day picked, a reset) eased over a third of a second, as
// vibe-trading's band chart zooms (ease-out cubic, 350 ms); a drag never glides, it follows the pointer.
// In time, not in points, so it holds while the equity chart redraws at another step on the way. A new
// glide on the same time scale replaces the one under way.
import type { ITimeScaleApi, Time } from "lightweight-charts";

const MS = 350;
const ease = (t: number) => 1 - (1 - t) ** 3;
const running = new WeakMap<object, number>();

/** Glides to `to` (seconds). */
export function glide(time: ITimeScaleApi<Time>, to: { from: number; to: number }): void {
  const from = time.getVisibleRange();
  cancelAnimationFrame(running.get(time) ?? 0);
  const show = (a: number, b: number) => time.setVisibleRange({ from: a as Time, to: b as Time });
  if (!from || matchMedia("(prefers-reduced-motion: reduce)").matches) { show(to.from, to.to); return; }
  const a0 = from.from as number, b0 = from.to as number, start = performance.now();
  const step = (now: number) => {
    const k = ease(Math.min(1, (now - start) / MS));
    show(a0 + (to.from - a0) * k, b0 + (to.to - b0) * k);
    if (k < 1) running.set(time, requestAnimationFrame(step));
  };
  running.set(time, requestAnimationFrame(step));
}
