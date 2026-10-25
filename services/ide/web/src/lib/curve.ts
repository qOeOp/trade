// A smooth SVG path through points that never overshoots them (monotone cubic interpolation along x,
// Fritsch–Carlson), so a small chart's curve reads as smooth yet each peak and trough stays where the
// data puts it.
export type Point = readonly [number, number];

/** The path through `points` (sorted by x): "M x,y C …", or a straight line for two or fewer. */
export function monotonePath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return "";
  const f = (v: number) => v.toFixed(1);
  if (n < 3) return points.map(([x, y], i) => `${i ? "L" : "M"}${f(x)},${f(y)}`).join("");
  const dx: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1]![0] - points[i]![0]);
    slope.push(dx[i]! ? (points[i + 1]![1] - points[i]![1]) / dx[i]! : 0);
  }
  // Tangents: the mean of the neighbouring slopes, zero at a turn, then limited so no segment overshoots.
  const m = points.map((_, i) => (i === 0 ? slope[0]! : i === n - 1 ? slope[n - 2]! : slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (!slope[i]) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i]! / slope[i]!, b = m[i + 1]! / slope[i]!, h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * slope[i]!; m[i + 1] = t * b * slope[i]!; }
  }
  let d = `M${f(points[0]![0])},${f(points[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!, [x1, y1] = points[i + 1]!, h = dx[i]! / 3;
    d += `C${f(x0 + h)},${f(y0 + m[i]! * h)} ${f(x1 - h)},${f(y1 - m[i + 1]! * h)} ${f(x1)},${f(y1)}`;
  }
  return d;
}

/** At most `most` points of a path, evenly spaced, keeping its last; the lowest and highest stay in. */
export function thin<T extends Point>(points: readonly T[], most: number): T[] {
  if (points.length <= most) return [...points];
  const step = (points.length - 1) / (most - 1);
  const keep = new Set(Array.from({ length: most }, (_, i) => Math.round(i * step)));
  let lo = 0, hi = 0;
  points.forEach(([, y], i) => { if (y < points[lo]![1]) lo = i; if (y > points[hi]![1]) hi = i; });
  keep.add(lo).add(hi);
  return [...keep].sort((a, b) => a - b).map((i) => points[i]!);
}
