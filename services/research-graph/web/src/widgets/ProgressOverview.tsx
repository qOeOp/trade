import { useRef, type PointerEvent } from "react";
import type { ProgressWidget } from "../model/types";
import { v, type ColorRole } from "../theme/roles";
import { requestPan, useAxisView } from "../state/linking";
import { useSize } from "../components/hooks/useSize";

/** The strip's height: bars from a centre line, gains up and losses down. */
export const OVERVIEW_H = 22;

// Every research run of the line at once, as a minimap above the progress chart: tiny bars in the
// chart's colours on the whole trial axis, and a frame over the trials the canvas shows. Dragging the
// frame pans the canvas; pressing elsewhere centres the frame there first. `chart` is the width of the
// canvas (and the chart), which sets how many trials the frame spans.
export function Overview({ widget, chart, tone }: { widget: ProgressWidget; chart: number; tone: (r: number) => ColorRole }) {
  const [ref, { width }] = useSize();
  const { x0, unit } = useAxisView();
  const span = Math.max(1, widget.axis.max + 1), per = width / span;
  const top = Math.max(1e-9, ...widget.points.map((p) => Math.abs(p.annual_return)));
  const mid = OVERVIEW_H / 2, scale = (mid - 2) / top;
  // Positions in trials, trial t's column centred on t: the canvas shows from -x0/unit across chart/unit
  // of them, and the strip draws position c at (c + 0.5) * per.
  const first = -x0 / unit, shown = chart / unit;
  const frame = { x: Math.max(0, (first + 0.5) * per), w: Math.min(width, shown * per) };
  const drag = useRef<{ x: number; first: number } | null>(null);
  const panTo = (trial: number) => requestPan(-trial * unit);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const at = (e.clientX - e.currentTarget.getBoundingClientRect().left) / per - 0.5;
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = at >= first && at <= first + shown ? first : at - shown / 2;
    if (start !== first) panTo(start);
    drag.current = { x: e.clientX, first: start };
  };
  return (
    <div ref={ref} aria-label="全部研究运行；拖动视野框平移画布"
         className="relative cursor-grab touch-none select-none active:cursor-grabbing" style={{ height: OVERVIEW_H }}
         onPointerDown={down} onPointerUp={() => { drag.current = null; }}
         onPointerMove={(e) => { const g = drag.current; if (g) panTo(g.first + (e.clientX - g.x) / per); }}>
      {width > 0 && (
        <svg width={width} height={OVERVIEW_H} className="absolute inset-0">
          <rect width={width} height={OVERVIEW_H} rx={4} fill={v("island-alt")} />
          <line x1={0} x2={width} y1={mid} y2={mid} stroke={v("line")} />
          {widget.points.map((p) => {
            const h = Math.max(1, Math.abs(p.annual_return) * scale);
            return <rect key={p.trial_id} x={(p.trial_id + 0.5) * per - Math.max(1, per * 0.6) / 2} width={Math.max(1, per * 0.6)}
                         y={p.annual_return >= 0 ? mid - h : mid} height={h} fill={v(tone(p.annual_return))} />;
          })}
          <rect x={frame.x + 0.5} y={0.5} width={Math.max(4, frame.w - 1)} height={OVERVIEW_H - 1} rx={4}
                fill={v("selection")} fillOpacity={0.35} stroke={v("focus")} strokeOpacity={0.6} />
        </svg>
      )}
    </div>
  );
}
