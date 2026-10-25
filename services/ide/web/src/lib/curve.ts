// A small chart's trend rather than its every tick: the path averaged into equal time buckets, those
// smoothed with a Gaussian, and drawn as a uniform cubic B-spline in Bézier segments (as d3's
// curveBasis), which bends near the points without passing through each, so noise never shows as
// kinks or spikes.
export type Point = readonly [number, number];

const BUCKETS = 48;  // a path is averaged into at most this many equal spans of time
const SIGMA = 3;     // the Gaussian's width in buckets, narrower in proportion for a shorter path

/** The trend of `points` (sorted by x): bucket means, then a Gaussian over them; its ends smoothed too. */
export function trend(points: readonly Point[]): Point[] {
  const means = bucketMeans(points), sigma = SIGMA * Math.min(1, means.length / BUCKETS);
  if (sigma < 0.5) return means;
  const r = Math.ceil(sigma * 2.5), w = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  return means.map(([x], i) => {
    let sum = 0, weight = 0;
    for (let k = -r; k <= r; k++) { const p = means[i + k]; if (p) { sum += p[1] * w[k + r]!; weight += w[k + r]!; } }
    return [x, sum / weight];
  });
}

/** Each of BUCKETS equal spans of time as the mean of its points, at their mean time. */
function bucketMeans(points: readonly Point[]): Point[] {
  if (points.length <= BUCKETS) return [...points];
  const t0 = points[0]![0], span = points[points.length - 1]![0] - t0 || 1;
  const sums = Array.from({ length: BUCKETS }, () => [0, 0, 0]);
  for (const [x, y] of points) { const s = sums[Math.min(BUCKETS - 1, Math.floor(((x - t0) / span) * BUCKETS))]!; s[0]! += x; s[1]! += y; s[2]! += 1; }
  return sums.filter(([, , n]) => n).map(([x, y, n]) => [x! / n!, y! / n!]);
}

/** The B-spline's path: "M x,y …", starting and ending on the end points; a polyline for two or fewer. */
export function basisPath(points: readonly Point[]): string {
  const f = (v: number) => v.toFixed(1);
  if (points.length < 3) return points.map(([x, y], i) => `${i ? "L" : "M"}${f(x)},${f(y)}`).join("");
  let [x0, y0] = points[0]!, [x1, y1] = points[1]!;
  let d = `M${f(x0)},${f(y0)}L${f((5 * x0 + x1) / 6)},${f((5 * y0 + y1) / 6)}`;
  const bend = (x: number, y: number) => {
    d += `C${f((2 * x0 + x1) / 3)},${f((2 * y0 + y1) / 3)} ${f((x0 + 2 * x1) / 3)},${f((y0 + 2 * y1) / 3)} ${f((x0 + 4 * x1 + x) / 6)},${f((y0 + 4 * y1 + y) / 6)}`;
  };
  for (const [x, y] of points.slice(2)) { bend(x, y); [x0, y0, x1, y1] = [x1, y1, x, y]; }
  bend(x1, y1);
  return `${d}L${f(x1)},${f(y1)}`;
}
