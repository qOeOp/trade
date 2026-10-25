import { useId } from "react";
import { monotonePath, thin, type Point } from "../../lib/curve";
import { useSize } from "../../components/hooks/useSize";
import { v, type ColorRole } from "../../theme/roles";

const POINTS = 32;  // a tile's curve is drawn through at most this many points
const SPAN = 0.002;  // the scale spans at least ±0.2% of the start, so cents of noise stay flat
type Props = { path: readonly [number, number][]; starting: number; tone: ColorRole; live: boolean; large?: boolean };

/** A run's equity: a smooth curve through the path in its return's colour over a wash of the same
 *  that fades to nothing at the foot, the starting balance as a faint dashed line, and while it runs a
 *  dot at the latest value. 80 × 32 in the runs' list; `large` fills the box it is given (the card in
 *  front). */
export function Sparkline(props: Props) {
  const [box, { width, height }] = useSize<HTMLSpanElement>();
  return (
    <span ref={box} className={`block ${props.large ? "h-full w-full" : "h-8 w-20"}`}>
      {width > 0 && props.path.length > 1 && <Curve {...props} width={width} height={height} />}
    </span>
  );
}

function Curve({ path, starting, tone, live, large, width, height }: Props & { width: number; height: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const shown = thin(path, POINTS), values = shown.map(([, value]) => value);
  const lo = Math.min(starting * (1 - SPAN), ...values), hi = Math.max(starting * (1 + SPAN), ...values);
  const t0 = shown[0]![0], t1 = shown[shown.length - 1]![0];
  const x = (t: number) => 1 + ((t - t0) / (t1 - t0 || 1)) * (width - 4);
  const y = (value: number) => 3 + (height - 6) * (1 - (value - lo) / (hi - lo));
  const points: Point[] = shown.map(([t, value]) => [x(t), y(value)]);
  const line = monotonePath(points), end = points[points.length - 1]!, base = y(starting);
  const area = `${line}L${end[0].toFixed(1)},${height}L${points[0]![0].toFixed(1)},${height}Z`;
  const color = v(tone);
  return (
    <svg aria-hidden width={width} height={height} className="block overflow-visible">
      <defs>
        <linearGradient id={`${id}-wash`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={large ? 0.16 : 0.2} />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={width} y1={base} y2={base} stroke={v("fg-ghost")} strokeDasharray="2 2" />
      <path d={area} fill={`url(#${id}-wash)`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {live && <circle cx={end[0]} cy={end[1]} r={large ? 2.5 : 2} fill={color} />}
    </svg>
  );
}
