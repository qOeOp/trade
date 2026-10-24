import { v } from "../theme/roles";

// A chart's readout of the value under the pointer, as TradingView labels its crosshair on an axis: a
// muted-ink pill with 11px figures, 4px by 2px padding and 4px corners. Its width follows the text (tabular
// figures, so an estimate per character holds); `min` and `max` keep it inside the chart.
export const PILL_H = 16;
const CHAR = 6.4, PAD = 4;

export const pillWidth = (text: string) => text.length * CHAR + 2 * PAD;

/** The pill with its top at `y`, centred on `x` or (`anchor="end"`) ending at it. */
export function ChartPill({ x, y, text, anchor = "middle", min = -Infinity, max = Infinity }: {
  x: number; y: number; text: string; anchor?: "middle" | "end"; min?: number; max?: number;
}) {
  const w = pillWidth(text);
  const left = Math.min(Math.max(min, anchor === "end" ? x - w : x - w / 2), max - w);
  return (
    <g pointerEvents="none">
      <rect x={left} y={y} width={w} height={PILL_H} rx={4} fill={v("fg-muted")} />
      <text x={left + w / 2} y={y + 11.5} textAnchor="middle" fontSize={11} fill={v("island")}>{text}</text>
    </g>
  );
}
