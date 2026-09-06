import type {
  BacktestReturnBandPoint,
  BacktestReturnValuePoint,
} from "./backtest-return-band-contract";

export type BacktestMonthLayer = Readonly<{
  key: string;
  startIndex: number;
  endIndex: number;
  mode: "stripe" | "divider";
}>;

export type BacktestBrushSegment = Readonly<{
  key: number;
  points: readonly BacktestReturnValuePoint[];
  widthFactor: number;
}>;

export type BacktestDrawdownRow = Readonly<{
  key: number;
  indices: readonly number[];
}>;

function monthKey(timestamp: string): string {
  return timestamp.slice(0, 7);
}

export function buildBacktestMonthLayers(
  points: readonly { at: string }[],
): BacktestMonthLayer[] {
  if (points.length === 0) return [];
  const first = new Date(points[0].at);
  const last = new Date(points[points.length - 1].at);
  const spanMonths = (last.getUTCFullYear() - first.getUTCFullYear()) * 12
    + last.getUTCMonth() - first.getUTCMonth();
  if (spanMonths > 18) {
    const layers: BacktestMonthLayer[] = [];
    let previousYear = first.getUTCFullYear();
    for (let index = 1; index < points.length; index += 1) {
      const year = new Date(points[index].at).getUTCFullYear();
      if (year !== previousYear) {
        layers.push({ key: String(year), startIndex: index, endIndex: index, mode: "divider" });
        previousYear = year;
      }
    }
    return layers;
  }

  const layers: BacktestMonthLayer[] = [];
  let startIndex = 0;
  let currentKey = monthKey(points[0].at);
  for (let index = 1; index <= points.length; index += 1) {
    const nextKey = index < points.length ? monthKey(points[index].at) : "";
    if (nextKey !== currentKey) {
      const month = Number(currentKey.slice(5, 7));
      if (month % 2 === 0) {
        layers.push({ key: currentKey, startIndex, endIndex: index - 1, mode: "stripe" });
      }
      startIndex = index;
      currentKey = nextKey;
    }
  }
  return layers;
}

export function buildBacktestBrushSegments(
  points: readonly BacktestReturnValuePoint[],
): BacktestBrushSegment[] {
  if (points.length < 2) return [];
  const segmentLength = points.length > 100 ? 12 : points.length > 50 ? 8 : 5;
  const segments: BacktestBrushSegment[] = [];
  for (let index = 0; index < points.length - 1; index += segmentLength) {
    const slice = points.slice(index, Math.min(index + segmentLength + 1, points.length));
    if (slice.length < 2) continue;
    const seed = ((index * 7 + 13) % 17) / 17;
    segments.push({ key: index, points: slice, widthFactor: 0.8 + seed * 0.4 });
  }
  return segments;
}

export function buildBacktestDrawdownRows(
  points: readonly BacktestReturnValuePoint[],
  valueToY: (value: number) => number,
  rowStep = 4,
): BacktestDrawdownRow[] {
  if (points.length === 0 || rowStep <= 0) return [];
  let peak = -Infinity;
  const depthPixels = points.map((point) => {
    peak = Math.max(peak, point.value);
    return Math.max(0, valueToY(point.value) - valueToY(peak));
  });
  const maximum = Math.max(...depthPixels);
  if (maximum <= 0) return [];
  const rows: BacktestDrawdownRow[] = [];
  const rowCount = Math.ceil(maximum / rowStep);
  for (let row = 0; row < rowCount; row += 1) {
    const threshold = row * rowStep;
    const indices = depthPixels.flatMap((value, index) => value > threshold ? [index] : []);
    if (indices.length > 0) rows.push({ key: row, indices });
  }
  return rows;
}

export function clampBacktestWindow(
  start: number,
  end: number,
  pointCount: number,
): { start: number; end: number } {
  if (pointCount <= 1) return { start: 0, end: Math.max(0, pointCount - 1) };
  const boundedStart = Math.max(0, Math.min(Math.floor(start), pointCount - 2));
  const boundedEnd = Math.max(boundedStart + 1, Math.min(Math.ceil(end), pointCount - 1));
  return { start: boundedStart, end: boundedEnd };
}

export function nearestBacktestPointIndex(
  clientX: number,
  left: number,
  width: number,
  pointCount: number,
): number {
  if (pointCount <= 1 || width <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, (clientX - left) / width));
  return Math.round(ratio * (pointCount - 1));
}

export function bandValues(points: readonly BacktestReturnBandPoint[]): number[] {
  return points.flatMap((point) => [point.min, point.q1, point.median, point.q3, point.max]);
}
