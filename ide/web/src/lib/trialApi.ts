// A sealed trial's report with its drill-down tables (`replay report --tables`), from the page's own
// server under /api/trial at a full ledger commit (ide/research_graph/serve.py). Only what the Runs page's
// backtest reads is typed; the product's refusal comes back as its { code, message }.
import { getJson, type Unread } from "./transport";

/** A measure as the report gives it: its value (a number, or a decimal or time as text) or none, with
 *  any regression standard error, simple-return sum, sample size, unavailability reason or note. */
type Measure = {
  value: number | string | null; standard_error?: number | null; return_sum?: number | null;
  sample_size?: number | null; null_reason?: string | null; definition_note?: string | null;
  /** `top_exit_share` alone: each closing order type's closed-cycle net. */
  exit_net?: Record<string, string>;
  /** `net_without_top_instrument` alone: the contract left out. */
  instrument?: string | null;
  /** `sharpe_lo` alone: the daily autocorrelations it counts. */
  lags?: number;
} | undefined;
/** One development year, cut at the trade start's anniversaries (`dev_years`), or the window's last
 *  part year (`partial`): its UTC dates, compound return and sealed bar-close MARK drawdown (null when the reading has none). */
type DevYear = { start: string; end: string; return: number; mark_max_drawdown?: number | null; partial: boolean };
/** The development years, the worst year's return and the window's annual return without the best year. */
type DevYears = { years: DevYear[]; worst_year_return: number; return_without_best_year: number } | null;
/** The quarters of a window under two years (`dev_quarters`), a last part quarter `partial`: each one's compound return, the
 *  worst whole quarter's and the window's annual return without the best one. */
type DevQuarters = {
  quarters: { start: string; end: string; return: number; partial: boolean }[]; worst_quarter_return: number; return_without_best_quarter: number;
} | null;
/** Closed cycles of one UTC close year, by that year (`splits.closed_by_year`): money as decimal text. */
type ClosedYear = { closed_trades: number; price_pnl_usdt: string; fill_commissions_usdt: string; reported_funding_usdt: string };
/** One cycle of `run_cycle`: open to close of one position (no close while it was still open at the
 *  window's end), no prices or sizes stored. */
type Cycle = {
  seq: number; instrument_id: string; side: string; ts_opened_ns: number; ts_closed_ns: number | null;
  realized_pnl: string | null; commissions: string; funding: string; price_pnl: string | null; closing_order_type: string | null;
};
/** One account day: its return (null when the starting balance was not recorded) and mean gross notional. */
type DailyReturn = { ts_event_ns: number; native_return: number | null; mean_gross_notional: string | null };
/** The capital block's `participation` (ledger/metrics.py): each fill's share of its minute's LAST volume, the largest
 *  share one contract's fills of one minute make together, and the fills counted apart. */
type Participation = {
  execution: string | null; fills: number; median: number | null; p95: number | null; p99: number | null; max: number | null;
  minute_max: number | null; no_bar: number; zero_volume: number; above_volume: number; engine_fills: number;
};
export type TrialReport = {
  trial_id: number;
  trade_window: { input_start: string; trade_start: string; trade_end: string };
  /** The market day the run read (YYYY-MM-DD). */
  market_day?: string | null;
  runtime: { image_digest: string | null } | null;
  drawdown: Record<string, Measure> | null;
  capital: { time_in_market?: Measure; participation?: { value: Participation | null } } | null;
  /** The annual return's block-bootstrap interval in the registered comparison design; null without one. */
  annual_return_interval?: { interval: [number, number]; coverage: number; days: number; block_days: number } | null;
  dev_years?: DevYears;
  dev_quarters?: DevQuarters;
  closed_by_year?: Record<string, ClosedYear> | null;
  cost_basis: { account: { starting_balance_usdt: string | null; execution: string | null } | null } | null;
  availability: { economic_evidence_available: boolean; reasons: string[] } | null;
  /** The report's single-run slices, each with its measures by name. */
  slices: { id: string; measures: Record<string, Measure | null> }[] | null;
  tables: { positions: Cycle[] | null; daily_returns: DailyReturn[] | null } | null;
  /** The equal-weight basket's daily returns on the run's days (UTC dates), read from its market as the report is read:
   *  none with the reason when a day lacks it; what the basket is in `definition_note`. */
  basket?: { days: string[]; returns: number[] | null; null_reason: string | null; definition_note: string | null } | null;
};
/** The report; the product's refusal; or why there is none. */
export async function fetchTrial(trialId: number, at: string): Promise<{ kind: "report"; report: TrialReport } | Unread> {
  const read = await getJson<TrialReport>(`/api/trial?trial_id=${trialId}&at=${encodeURIComponent(at)}`);
  return read.kind === "ready" ? { kind: "report", report: read.body } : read;
}
