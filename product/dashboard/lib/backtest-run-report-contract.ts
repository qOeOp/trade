import { isCanonicalUtc, isStrictlyOrderedUtc } from "./canonical-utc.ts";

// The single-run report contract in `docs/guide/dashboard.md`, "Bounded admission: single-run backtest
// report". Every rule below is stated there; this module enforces them and adds none of its own.

export const INVALID_BACKTEST_RUN_REPORT_PROJECTION = "INVALID_BACKTEST_RUN_REPORT_PROJECTION";
export const BACKTEST_RUN_REPORT_IDENTITY_MISMATCH = "BACKTEST_RUN_REPORT_IDENTITY_MISMATCH";
export const BACKTEST_RUN_REPORT_KEYS_MISSING = "BACKTEST_RUN_REPORT_KEYS_MISSING";

export type BacktestRunReportSide = "BUY" | "SELL";

// The three fields that locate one run: the same selector the `/backtest` result lookup holds.
export type BacktestRunReportLocator = Readonly<{
  result_identity: string;
  request_identity: string;
  attempt_identity: string;
}>;

// The run's locator, and the digest of the canonical result the Owner committed for it.
export type BacktestRunReportRun = BacktestRunReportLocator & Readonly<{
  engine_result_digest: string;
}>;

export type BacktestRunReportOutcome = Readonly<{
  position_intent_semantic_id: string;
  target_variant_semantic_id: string;
  target_position_units: number;
}>;

export const BACKTEST_RUN_REPORT_COMPARISONS = [
  "LESS",
  "LESS_OR_EQUAL",
  "EQUAL",
  "NOT_EQUAL",
  "GREATER_OR_EQUAL",
  "GREATER",
] as const;

export type BacktestRunReportComparison = typeof BACKTEST_RUN_REPORT_COMPARISONS[number];

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
  comparison: BacktestRunReportComparison;
  when_true: BacktestRunReportOutcome;
  otherwise: BacktestRunReportOutcome;
  exits?: BacktestRunReportExits;
  falsifier: string;
}>;

// How a program leaves a held position other than by its sides. Present only when it names at least
// one exit, and always judged at a bar's close and filled on the next frame, never inside a bar.
export type BacktestRunReportExits = Readonly<{
  stop_loss_fraction?: string;
  take_profit_fraction?: string;
  max_holding_bars?: number;
  judged: typeof EXITS_JUDGED_AT_CLOSE;
}>;

export const EXITS_JUDGED_AT_CLOSE = "AT_BAR_CLOSE_FILLED_NEXT_FRAME";

export type BacktestRunReportDataWindow = Readonly<{
  instrument: string;
  granularity: string;
  start: string;
  end_exclusive: string;
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
  strategy: BacktestRunReportStrategy;
  data_window: BacktestRunReportDataWindow;
  fill_count: number;
  fills: readonly BacktestRunReportFill[];
}>;

// Why an `EMPTY` run recorded no return, in the engine's own order, exactly as the Backtest Owner
// states it (`docs/owners/backtest.md`). The browser shows the code and derives no reason of its own.
export const BACKTEST_RUN_EMPTY_REASONS = [
  "MORE_THAN_ONE_EQUITY_CURRENCY",
  "ACCOUNT_WITHOUT_PRICED_SNAPSHOT",
  "FEWER_THAN_TWO_ENGINE_DAYS",
  "NO_DEFINED_DAILY_RETURN",
] as const;

export type BacktestRunEmptyReason = (typeof BACKTEST_RUN_EMPTY_REASONS)[number];

// `loading` is the browser's own state and never arrives on the wire. The other three are what the
// projection states; `empty` and `available` carry every fact, and differ only in the result.
export type BacktestRunReport =
  | Readonly<{ state: "loading" }>
  | Readonly<{ state: "unavailable"; reason: string }>
  | (BacktestRunReportFacts & Readonly<{
    state: "empty";
    empty_reason: BacktestRunEmptyReason;
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

// Each state has one exact key set, so a key that is missing or renamed is always a fault rather than
// something that could be read as a legitimately absent value. `AVAILABLE` and `EMPTY` are the Owner's
// projection as the route relayed it; `UNAVAILABLE` is the route's envelope around the Owner's reason.
const PROJECTION_KEYS = [
  "data_window",
  "empty_reason",
  "fill_count",
  "fills",
  "max_drawdown",
  "net_return",
  "run",
  "series",
  "state",
  "strategy",
];
const UNAVAILABLE_KEYS = ["reason", "state"];
const RUN_KEYS = ["attempt_identity", "engine_result_digest", "request_identity", "result_identity"];
const RUN_IDENTITY_KEYS = ["attempt_identity", "request_identity", "result_identity"] as const;
const STRATEGY_KEYS = ["channel", "comparison", "falsifier", "family", "otherwise", "threshold", "when_true"];
const STRATEGY_WITH_EXITS_KEYS = [...STRATEGY_KEYS, "exits"].sort();
const EXIT_KEYS = ["max_holding_bars", "stop_loss_fraction", "take_profit_fraction"];
// The authoring request's one spelling of a fraction strictly between 0 and 1.
const EXIT_FRACTION = /^0\.[0-9]*[1-9]$/u;
const CHANNEL_KEYS = ["field_semantic_id", "instrument", "role_semantic_id", "scale", "timeframe", "unit"];
const OUTCOME_KEYS = ["position_intent_semantic_id", "target_position_units", "target_variant_semantic_id"];
const DATA_WINDOW_KEYS = ["cut_identity", "end_exclusive", "granularity", "instrument", "snapshot_count", "start"];
const POINT_KEYS = ["at", "value"];
const FILL_KEYS = ["at", "price", "quantity", "side"];

// Plain decimal strings at the instrument's precision: a price may be negative, a quantity never
// carries a sign, and neither has an exponent or digit grouping. Shown exactly as given.
const SIGNED_DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/u;
const UNSIGNED_DECIMAL = /^[0-9]+(\.[0-9]+)?$/u;
const ENGINE_RESULT_DIGEST = /^blake3:[0-9a-f]{64}$/u;
const CUT_IDENTITY = /^(?:sha256|blake3):[0-9a-f]{64}$/u;
const MAX_SCALE = 255;
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
    && RUN_IDENTITY_KEYS.every((key) => isNonEmptyString(value[key]))
    && typeof value.engine_result_digest === "string"
    && ENGINE_RESULT_DIGEST.test(value.engine_result_digest);
}

function isOutcome(value: unknown): value is BacktestRunReportOutcome {
  return isRecord(value)
    && hasExactKeys(value, OUTCOME_KEYS)
    && isNonEmptyString(value.position_intent_semantic_id)
    && isNonEmptyString(value.target_variant_semantic_id)
    && typeof value.target_position_units === "number"
    && Number.isSafeInteger(value.target_position_units);
}

// The threshold is the authored coefficient at the channel's scale: exactly `scale` fractional
// digits, trailing zeros kept, and no decimal point at all at scale zero.
function isThresholdAtScale(value: unknown, scale: number): value is string {
  if (typeof value !== "string" || !SIGNED_DECIMAL.test(value)) return false;
  const point = value.indexOf(".");
  return scale === 0 ? point < 0 : point >= 0 && value.length - point - 1 === scale;
}

function isExits(value: unknown): value is BacktestRunReportExits {
  if (!isRecord(value) || value.judged !== EXITS_JUDGED_AT_CLOSE) return false;
  const named = Object.keys(value).filter((key) => key !== "judged");
  return named.length > 0
    && named.every((key) => EXIT_KEYS.includes(key))
    && ["stop_loss_fraction", "take_profit_fraction"]
      .every((key) => value[key] === undefined || (typeof value[key] === "string" && EXIT_FRACTION.test(value[key])))
    && (value.max_holding_bars === undefined
      || (Number.isSafeInteger(value.max_holding_bars) && (value.max_holding_bars as number) > 0));
}

function isStrategy(value: unknown): value is BacktestRunReportStrategy {
  if (!isRecord(value)) return false;
  const withExits = hasExactKeys(value, STRATEGY_WITH_EXITS_KEYS);
  if (!withExits && !hasExactKeys(value, STRATEGY_KEYS)) return false;
  if (withExits && !isExits(value.exits)) return false;
  const channel = value.channel;
  return value.family === "SINGLE_THRESHOLD_V1"
    && isRecord(channel)
    && hasExactKeys(channel, CHANNEL_KEYS)
    && ["role_semantic_id", "instrument", "field_semantic_id", "timeframe", "unit"]
      .every((key) => isNonEmptyString(channel[key]))
    && isCount(channel.scale)
    && channel.scale <= MAX_SCALE
    && isThresholdAtScale(value.threshold, channel.scale)
    && BACKTEST_RUN_REPORT_COMPARISONS.includes(value.comparison as BacktestRunReportComparison)
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
    && isCanonicalUtc(value.end_exclusive)
    && value.start < value.end_exclusive
    && isCount(value.snapshot_count)
    && value.snapshot_count >= 1
    && typeof value.cut_identity === "string"
    && CUT_IDENTITY.test(value.cut_identity);
}

// An unavailable answer carries its reason and nothing else, so no positive fact can ride along.
export function isBacktestRunReportUnavailableEnvelope(
  value: unknown,
): value is Readonly<{ state: "UNAVAILABLE"; reason: string }> {
  return isRecord(value)
    && hasExactKeys(value, UNAVAILABLE_KEYS)
    && value.state === "UNAVAILABLE"
    && isNonEmptyString(value.reason);
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

function isEmptyReason(value: unknown): value is BacktestRunEmptyReason {
  return typeof value === "string" && (BACKTEST_RUN_EMPTY_REASONS as readonly string[]).includes(value);
}

// A projection that carries no key the contract does not know, and lacks some it requires, is one
// whose statement has not been delivered yet rather than a malformed one. It is refused all the same,
// under a reason that names what is missing, so the two cannot be read as the same fault.
function missingKeysReason(value: Record<string, unknown>): string {
  const keys = Object.keys(value);
  if (keys.some((key) => !PROJECTION_KEYS.includes(key))) return INVALID_BACKTEST_RUN_REPORT_PROJECTION;
  const missing = PROJECTION_KEYS.filter((key) => !keys.includes(key));
  return `${BACKTEST_RUN_REPORT_KEYS_MISSING}: ${missing.join(", ")}`;
}

/**
 * Normalizes one Dashboard projection of a single run, or fails it closed.
 *
 * `requested` is the run the page asked for. A projection naming any other run, even one differing
 * only in its request or attempt, is refused under its own reason, so a response routed to the wrong
 * request cannot render as the right one.
 */
export function normalizeBacktestRunReport(
  value: unknown,
  requested: BacktestRunReportLocator,
): BacktestRunReport {
  if (!isRecord(value)) return unavailableBacktestRunReport();

  if (value.state === "UNAVAILABLE") {
    return isBacktestRunReportUnavailableEnvelope(value)
      ? { state: "unavailable", reason: value.reason }
      : unavailableBacktestRunReport();
  }
  if (value.state !== "AVAILABLE" && value.state !== "EMPTY") return unavailableBacktestRunReport();
  if (!hasExactKeys(value, PROJECTION_KEYS)) return unavailableBacktestRunReport(missingKeysReason(value));

  const run = value.run;
  if (!isRun(run)
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
  if (RUN_IDENTITY_KEYS.some((key) => run[key] !== requested[key])) {
    return unavailableBacktestRunReport(BACKTEST_RUN_REPORT_IDENTITY_MISMATCH);
  }

  const facts = {
    run,
    strategy: value.strategy,
    data_window: value.data_window,
    fill_count: value.fill_count,
    fills: value.fills,
  };
  // `empty` is a run that recorded no return: no points, both quantities null, and the Owner's reason.
  // Fills may still be listed, because a run can fill without the engine recording a return. `available`
  // states both quantities and no reason. `empty_reason` runs the other way round from the two
  // quantities - null only in `available` - so an `empty` without a reason, an `available` with one,
  // and a reason outside the set are all refused.
  if (value.state === "EMPTY") {
    return value.series.length === 0
      && value.net_return === null
      && value.max_drawdown === null
      && isEmptyReason(value.empty_reason)
      ? {
        ...facts,
        state: "empty",
        empty_reason: value.empty_reason,
        series: [],
        net_return: null,
        max_drawdown: null,
      }
      : unavailableBacktestRunReport();
  }
  return value.series.length > 0
    && value.empty_reason === null
    && isFiniteNumber(value.net_return)
    && isFiniteNumber(value.max_drawdown)
    ? {
      ...facts,
      state: "available",
      series: value.series,
      net_return: value.net_return,
      max_drawdown: value.max_drawdown,
    }
    : unavailableBacktestRunReport();
}
