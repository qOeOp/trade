// A step line (the drawdown floor, equityNotes.ts) drawn so it reads at any zoom: steps nearer than `merge`
// to the one before them run together into one slope, from the first's foot to the last's top, and every
// corner is rounded by at most `radius`, so a step a few pixels high reads as a bend, not a notch.

type Point = readonly [number, number];

/** The vertices of the step line through `points` (x, y; each y held until the next point's x), oldest
 *  first, steps nearer than `merge` (in x) to the one before them run together into one slope. A step up
 *  or down from `off` (a level held off the drawing, if any) stays square, the slope after it starting
 *  from its top, so the line comes into view straight. */
export function stepVertices(points: readonly Point[], merge: number, off: number | null = null): [number, number][] {
  if (!points.length) return [];
  const out: [number, number][] = [[points[0]![0], points[0]![1]]];
  let level = points[0]![1], last = Number.NEGATIVE_INFINITY, square = false;  // the level, where it last stepped, whether from `off`
  for (const [x, y] of points.slice(1)) {
    if (y === level) continue;
    if (level === off || x - last >= merge) out.push([x, level], [x, y]);
    else if (square) out.push([x, y]);  // the slope starts from the square step's top
    else out[out.length - 1] = [x, y];  // the slope's top moves on to this step
    square = level === off; level = y; last = x;
  }
  const end = points.at(-1)![0];
  if (end > out.at(-1)![0]) out.push([end, level]);
  return out;
}

/** `vertices` added to `path`, each corner rounded by at most `radius` and half its shorter side. */
export function roundedPath(path: CanvasPath, vertices: readonly Point[], radius: number): void {
  if (!vertices.length) return;
  const gap = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  path.moveTo(vertices[0]![0], vertices[0]![1]);
  for (let k = 1; k < vertices.length - 1; k++) {
    const [a, b, c] = [vertices[k - 1]!, vertices[k]!, vertices[k + 1]!];
    path.arcTo(b[0], b[1], c[0], c[1], Math.min(radius, gap(a, b) / 2, gap(b, c) / 2));
  }
  path.lineTo(vertices.at(-1)![0], vertices.at(-1)![1]);
}
