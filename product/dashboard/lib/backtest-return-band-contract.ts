export type BacktestReturnBandAvailability = "loading" | "available" | "unavailable";

export type BacktestReturnBandPoint = Readonly<{
  at: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}>;

export type BacktestReturnValuePoint = Readonly<{
  at: string;
  value: number;
}>;

export type BacktestReturnSeries = Readonly<{
  id: string;
  label: string;
  points: readonly BacktestReturnValuePoint[];
}>;

export type BacktestReturnBandProjection = Readonly<{
  availability: BacktestReturnBandAvailability;
  resultIdentity: string | null;
  observedAt: string | null;
  points: readonly BacktestReturnBandPoint[];
  strategy: BacktestReturnSeries | null;
  benchmark: BacktestReturnSeries | null;
  reason: string | null;
}>;

const PROJECTION_KEYS = [
  "availability",
  "benchmark",
  "observedAt",
  "points",
  "reason",
  "resultIdentity",
  "strategy",
];
const BAND_POINT_KEYS = ["at", "max", "median", "min", "q1", "q3"];
const SERIES_KEYS = ["id", "label", "points"];
const VALUE_POINT_KEYS = ["at", "value"];
const MAX_POINTS = 5_000;

export function unavailableBacktestReturnBand(
  reason = "INVALID_BACKTEST_RETURN_BAND_PROJECTION",
): BacktestReturnBandProjection {
  return {
    availability: "unavailable",
    resultIdentity: null,
    observedAt: null,
    points: [],
    strategy: null,
    benchmark: null,
    reason,
  };
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === keys.join("|");
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBandPoint(value: unknown): value is BacktestReturnBandPoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  if (!hasExactKeys(point, BAND_POINT_KEYS) || !isCanonicalTimestamp(point.at)) return false;
  if (![point.min, point.q1, point.median, point.q3, point.max].every(isFiniteNumber)) return false;
  const min = point.min as number;
  const q1 = point.q1 as number;
  const median = point.median as number;
  const q3 = point.q3 as number;
  const max = point.max as number;
  return min <= q1 && q1 <= median && median <= q3 && q3 <= max;
}

function isValuePoint(value: unknown): value is BacktestReturnValuePoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return hasExactKeys(point, VALUE_POINT_KEYS)
    && isCanonicalTimestamp(point.at)
    && isFiniteNumber(point.value);
}

function isStrictlyOrdered(points: readonly { at: string }[]): boolean {
  let previous = -Infinity;
  for (const point of points) {
    const current = Date.parse(point.at);
    if (current <= previous) return false;
    previous = current;
  }
  return true;
}

function isSeries(
  value: unknown,
  allowedTimestamps: ReadonlySet<string>,
): value is BacktestReturnSeries {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const series = value as Record<string, unknown>;
  if (!hasExactKeys(series, SERIES_KEYS)
    || typeof series.id !== "string"
    || series.id.length === 0
    || typeof series.label !== "string"
    || series.label.trim().length === 0
    || !Array.isArray(series.points)
    || series.points.length > MAX_POINTS
    || !series.points.every(isValuePoint)
    || !isStrictlyOrdered(series.points)) {
    return false;
  }
  return series.points.every((point) => allowedTimestamps.has(point.at));
}

export function normalizeBacktestReturnBandProjection(
  value: unknown,
): BacktestReturnBandProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return unavailableBacktestReturnBand();
  }
  const candidate = value as Record<string, unknown>;
  if (!hasExactKeys(candidate, PROJECTION_KEYS)) return unavailableBacktestReturnBand();

  const availability = candidate.availability;
  if (availability !== "loading" && availability !== "available" && availability !== "unavailable") {
    return unavailableBacktestReturnBand();
  }
  if (!Array.isArray(candidate.points) || candidate.points.length > MAX_POINTS) {
    return unavailableBacktestReturnBand();
  }

  if (availability !== "available") {
    const validUnavailable = candidate.resultIdentity === null
      && candidate.observedAt === null
      && candidate.points.length === 0
      && candidate.strategy === null
      && candidate.benchmark === null
      && (availability === "loading"
        ? candidate.reason === null
        : typeof candidate.reason === "string" && candidate.reason.trim().length > 0);
    return validUnavailable
      ? candidate as unknown as BacktestReturnBandProjection
      : unavailableBacktestReturnBand();
  }

  if (typeof candidate.resultIdentity !== "string"
    || candidate.resultIdentity.length === 0
    || !isCanonicalTimestamp(candidate.observedAt)
    || candidate.reason !== null
    || !candidate.points.every(isBandPoint)
    || !isStrictlyOrdered(candidate.points)) {
    return unavailableBacktestReturnBand();
  }

  const timestamps = new Set(candidate.points.map((point) => point.at));
  if ((candidate.strategy !== null && !isSeries(candidate.strategy, timestamps))
    || (candidate.benchmark !== null && !isSeries(candidate.benchmark, timestamps))) {
    return unavailableBacktestReturnBand();
  }
  const strategy = candidate.strategy as BacktestReturnSeries | null;
  const benchmark = candidate.benchmark as BacktestReturnSeries | null;
  if ((candidate.points.length === 0 && (strategy !== null || benchmark !== null))
    || (strategy !== null && benchmark !== null && strategy.id === benchmark.id)) {
    return unavailableBacktestReturnBand();
  }
  return candidate as unknown as BacktestReturnBandProjection;
}

export function formatBacktestReturn(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(value).concat("%");
}
