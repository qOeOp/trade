import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

export type Domain = readonly [number, number];
type View = { x: Domain; y: Domain };
type Plot = { left: number; top: number; w: number; h: number };

// At most this much closer than the whole chart; the wheel's notches zoom by this factor per pixel.
const MAX_ZOOM = 40, RATE = 0.0015;

/** `d` inside `base`: as wide as `base` at most, shifted back in when it runs past an edge. */
function within(d: Domain, base: Domain): Domain {
  const span = d[1] - d[0], full = base[1] - base[0];
  if (span >= full) return base;
  if (d[0] < base[0]) return [base[0], base[0] + span];
  if (d[1] > base[1]) return [base[1] - span, base[1]];
  return d;
}

/** Zoom and pan of a 2-D chart whose whole extent is `base`: the wheel zooms around the pointer, a drag
 *  pans once zoomed in, a double-click (or `reset`) shows the whole chart again. `plot` is the plotting
 *  area inside `el` in pixels, y growing downward as on screen. */
export function useZoom(el: RefObject<HTMLElement | null>, base: View, plot: Plot) {
  const [view, setView] = useState<View | null>(null);
  const current = useRef({ base, plot, view });
  current.current = { base, plot, view };
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    // A native listener, since React's wheel listener is passive and cannot keep the page from scrolling.
    const wheel = (e: WheelEvent) => {
      const { base, plot, view } = current.current, d = view ?? base, r = node.getBoundingClientRect();
      const px = (e.clientX - r.left - plot.left) / plot.w, py = (e.clientY - r.top - plot.top) / plot.h;
      if (px < 0 || px > 1 || py < 0 || py > 1) return;
      e.preventDefault();
      const f = Math.exp(e.deltaY * RATE);
      // Scale `dom` by f about the point a fraction t along it, no closer than MAX_ZOOM times `whole`.
      const at = (dom: Domain, t: number, whole: Domain): Domain => {
        const span = dom[1] - dom[0], p = dom[0] + t * span, k = Math.max(f, (whole[1] - whole[0]) / MAX_ZOOM / span);
        return within([p + (dom[0] - p) * k, p + (dom[1] - p) * k], whole);
      };
      const x = at(d.x, px, base.x), y = at(d.y, 1 - py, base.y);
      setView(x === base.x && y === base.y ? null : { x, y });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [el]);
  const drag = useRef<{ x: number; y: number; from: View } | null>(null);
  return {
    x: view?.x ?? base.x, y: view?.y ?? base.y, zoomed: view != null, reset: () => setView(null),
    handlers: {
      onDoubleClick: () => setView(null),
      onPointerDown: (e: PointerEvent) => {
        if (!view || (e.target as Element).closest("[data-v], button")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, from: view };
      },
      onPointerMove: (e: PointerEvent) => {
        const g = drag.current;
        if (!g) return;
        const sx = (g.from.x[1] - g.from.x[0]) / plot.w, sy = (g.from.y[1] - g.from.y[0]) / plot.h;
        const dx = (e.clientX - g.x) * sx, dy = (e.clientY - g.y) * sy;
        setView({ x: within([g.from.x[0] - dx, g.from.x[1] - dx], base.x), y: within([g.from.y[0] + dy, g.from.y[1] + dy], base.y) });
      },
      onPointerUp: () => { drag.current = null; },
    },
  };
}
