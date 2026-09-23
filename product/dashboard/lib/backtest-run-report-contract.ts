import { isCanonicalUtc, isStrictlyOrderedUtc } from "./canonical-utc.ts";

// The single-run report contract in `docs/guide/dashboard.md`, "Bounded admission: single-run backtest
// report". Every rule below is stated there; this module enforces them and adds none of its own.

export const INVALID_BACKTEST_RUN_REPORT_PROJECTION = "INVALID_BACKTEST_RUN_REPORT_PROJECTION";
export const BACKTEST_RUN_REPORT_IDENTITY_MISMATCH = "BACKTEST_RUN_REPORT_IDENTITY_MISMATCH";

export type BacktestRunReportSide = "BUY" | "SELL";

export type BacktestRunReportRun = Readonly<{
  result_identity: string;
  request_identity: string;
  attempt_identity: string;
}>;

export type BacktestRunReportOutcome = Readonly<{
  position_intent_semantic_id: string;
  target_variant_semantic_id: string;
  target_position_units: number;
}>;

export type BacktestRunReportStrategy = Readonly<{
  family: "SINGLE_THRESHOLD_V1";
  channel: Readonly<{
    role_semantic_id: string;
    instrument: string;
    field_semantic_id: string;
    timeframe: string;
    unit: string;
    scale: number;
  }>;
  threshold: string;
  comparison: string;
  when_true: BacktestRunReportOutcome;
  otherwise: BacktestRunReportOutcome;
  falsifier: string;
}>;

export type BacktestRunReportDataWindow = Readonly<{
  instrument: string;
  granularity: string;
  start: string;
  end: string;
  snapshot_count: number;
  cut_identity: string;
}>;

export type BacktestRunReportPoint = Readonly<{ at: string; value: number }>;

export type BacktestRunReportFill = Readonly<{
  at: string;
  side: BacktestRunReportSide;
  price: string;
  quantity: string;
}>;

type BacktestRunReportFacts = Readonly<{
  run: BacktestRunReportRun;
  engine_result_digest: string;
  strategy: BacktestRunReportStrategy;
  data_window: BacktestRunReportDataWindow;
  fill_count: number;
  fills: readonly BacktestRunReportFill[];
}>;

// `loading` is the browser's own state and never arrives on the wire. The other three are what the
// projection states; `empty` and `available` carry every fact, and differ only in the result.
export type BacktestRunReport =
  | Readonly<{ state: "loading" }>
  | Readonly<{ state: "unavailable"; reason: string }>
  | (BacktestRunReportFacts & Readonly<{
    state: "empty";
    series: readonly [];
    net_return: null;
    max_drawdown: null;
  }>)
  | (BacktestRunReportFacts & Readonly<{
    state: "available";
    series: readonly BacktestRunReportPoint[];
    net_return: number;
    max_drawdown: number;
  }>);

// The key set is constant across states, so a key that is missing or renamed is always a fault rather
// than something that could be read as a legitimately absent value.
const PROJECTION_KEYS = [
  "data_window",
  "engine_result_digest",
  "fill_count",
  "fills",
  "max_drawdown",
  "net_return",
  "reason",
  "run",
  "series",
  "state",
  "strategy",
];
const RUN_KEYS = ["attempt_identity", "request_identity", "result_identity"];
const STRATEGY_KEYS = ["channel", "comparison", "falsifier", "family", "otherwise", "threshold", "when_true"];
const CHANNEL_KEYS = ["field_semantic_id", "instrument", "role_semantic_id", "scale", "timeframe", "unit"];
const OUTCOME_KEYS = ["position_intent_semantic_id", "target_position_units", "target_variant_semantic_id"];
const DATA_WINDOW_KEYS = ["cut_identity", "end", "granularity", "instrument", "snapshot_count", "start"];
const POINT_KEYS = ["at", "value"];
const FILL_KEYS = ["at", "price", "quantity", "side"];

// Plain decimal strings at the instrument's precision: a price may be negative, a quantity never
// carries a sign, and neither has an exponent or digit grouping. Shown exactly as given.
const SIGNED_DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/u;
const UNSIGNED_DECIMAL = /^[0-9]+(\.[0-9]+)?$/u;
const ENGINE_RESULT_DIGEST = /^blake3:[0-9a-f]{64}$/u;
const MAX_POINTS = 5_000;

export function unavailableBacktestRunReport(
  reason = INVALID_BACKTEST_RUN_REPORT_PROJECTION,
): BacktestRunReport {
  return { state: "unavailable", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === keys.join("|");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRun(value: unknown): value is BacktestRunReportRun {
  return isRecord(value)
    && hasExactKeys(value, RUN_KEYS)
    && RUN_KEYS.every((key) => isNonEmptyString(value[key]));
}

function isOutcome(value: unknown): value is BacktestRunReportOutcome {
  return isRecord(value)
    && hasExactKeys(value, OUTCOME_KEYS)
    && isNonEmptyString(value.position_intent_semantic_id)
    && isNonEmptyString(value.target_variant_semantic_id)
    && typeof value.target_position_units === "number"
    && Number.isSafeInteger(value.target_position_units);
}

function isStrategy(value: unknown): value is BacktestRunReportStrategy {
  if (!isRecord(value) || !hasExactKeys(value, STRATEGY_KEYS)) return false;
  const channel = value.channel;
  return value.family === "SINGLE_THRESHOLD_V1"
    && isRecord(channel)
    && hasExactKeys(channel, CHANNEL_KEYS)
    && ["role_semantic_id", "instrument", "field_semantic_id", "timeframe", "unit"]
      .every((key) => isNonEmptyString(channel[key]))
    && isCount(channel.scale)
    && typeof value.threshold === "string"
    && SIGNED_DECIMAL.test(value.threshold)
    && isNonEmptyString(value.comparison)
    && isOutcome(value.when_true)
    && isOutcome(value.otherwise)
    && isNonEmptyString(value.falsifier);
}

function isDataWindow(value: unknown): value is BacktestRunReportDataWindow {
  return isRecord(value)
    && hasExactKeys(value, DATA_WINDOW_KEYS)
    && isNonEmptyString(value.instrument)
    && isNonEmptyString(value.granularity)
    && isCanonicalUtc(value.start)
    && isCanonicalUtc(value.end)
    && value.start <= value.end
    && isCount(value.snapshot_count)
    && isNonEmptyString(value.cut_identity);
}

function isPoint(value: unknown): value is BacktestRunReportPoint {
  return isRecord(value)
    && hasExactKeys(value, POINT_KEYS)
    && isCanonicalUtc(value.at)
    && isFiniteNumber(value.value);
}

function isFill(value: unknown): value is BacktestRunReportFill {
  return isRecord(value)
    && hasExactKeys(value, FILL_KEYS)
    && isCanonicalUtc(value.at)
    && (value.side === "BUY" || value.side === "SELL")
    && typeof value.price === "string"
    && SIGNED_DECIMAL.test(value.price)
    && typeof value.quantity === "string"
    && UNSIGNED_DECIMAL.test(value.quantity);
}

function isUnavailable(candidate: Record<string, unknown>): boolean {
  return isNonEmptyString(candidate.reason)
    && candidate.run === null
    && candidate.engine_result_digest === null
    && candidate.strategy === null
    && candidate.data_window === null
    && Array.isArray(candidate.series) && candidate.series.length === 0
    && candidate.net_return === null
    && candidate.max_drawdown === null
    && candidate.fill_count === null
    && Array.isArray(candidate.fills) && candidate.fills.length === 0;
}

/**
 * Normalizes one Dashboard projection of a single run, or fails it closed.
 *
 * `requestedRunIdentity` is the run the page asked for. A projection naming any other run is refused
 * under its own reason, so a response routed to the wrong request cannot render as the right one.
 */
export function normalizeBacktestRunReport(
  value: unknown,
  requestedRunIdentity: string,
): BacktestRunReport {
  if (!isRecord(value) || !hasExactKeys(value, PROJECTION_KEYS)) return unavailableBacktestRunReport();

  if (value.state === "UNAVAILABLE") {
    return isUnavailable(value)
      ? { state: "unavailable", reason: value.reason as string }
      : unavailableBacktestRunReport();
  }
  if (value.state !== "AVAILABLE" && value.state !== "EMPTY") return unavailableBacktestRunReport();

  if (value.reason !== null
    || !isRun(value.run)
    || typeof value.engine_result_digest !== "string"
    || !ENGINE_RESULT_DIGEST.test(value.engine_result_digest)
    || !isStrategy(value.strategy)
    || !isDataWindow(value.data_window)
    || !Array.isArray(value.series)
    || value.series.length > MAX_POINTS
    || !value.series.every(isPoint)
    || !isStrictlyOrderedUtc(value.series)
    || !Array.isArray(value.fills)
    || value.fills.length > MAX_POINTS
    || !value.fills.every(isFill)
    || value.fill_count !== value.fills.length) {
    return unavailableBacktestRunReport();
  }
  if (value.run.result_identity !== requestedRunIdentity) {
    return unavailableBacktestRunReport(BACKTEST_RUN_REPORT_IDENTITY_MISMATCH);
  }

  const facts = {
    run: value.run,
    engine_result_digest: value.engine_result_digest,
    strategy: value.strategy,
    data_window: value.data_window,
    fill_count: value.fill_count,
    fills: value.fills,
  };
  // `empty` is a run that produced no points: both quantities are null, and fills may still be listed
  // because a position can open and close between two equity snapshots. `available` states both.
  if (value.state === "EMPTY") {
    return value.series.length === 0 && value.net_return === null && value.max_drawdown === null
      ? { ...facts, state: "empty", series: [], net_return: null, max_drawdown: null }
      : unavailableBacktestRunReport();
  }
  return value.series.length > 0 && isFiniteNumber(value.net_return) && isFiniteNumber(value.max_drawdown)
    ? {
      ...facts,
      state: "available",
      series: value.series,
      net_return: value.net_return,
      max_drawdown: value.max_drawdown,
    }
    : unavailableBacktestRunReport();
}
