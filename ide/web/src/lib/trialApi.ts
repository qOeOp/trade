// A sealed trial's report with its drill-down tables (`replay report --tables`), from the page's own
// server under /api/trial at a full ledger commit (ide/research_graph/serve.py). Only what the Runs page's
// backtest reads is typed; the product's refusal comes back as its { code, message }.
import { getJson, type Unread } from "./transport";

/** A measure as the report gives it: its value (a number, or a decimal or time as text) or none, with
 *  any regression standard error, simple-return sum, sample size, unavailability reason or note. */
type Measure = {
  value: number | string | null; standard_error?: number | null; return_sum?: number | null;
  sample_size?: number | null; null_reason?: string | null; definition_note?: string | null;
} | undefined;
/** One development year, cut at the trade start's anniversaries (`measures.dev_years`), or the window's last
 *  part year (`partial`): its UTC dates and compound return. */
type DevYear = { start: string; end: string; return: number; partial: boolean };
/** The development years, the worst year's return and the window's annual return without the best year. */
type DevYears = { years: DevYear[]; worst_year_return: number; return_without_best_year: number } | null;
/** Closed cycles of one UTC close year, by that year (`measures.closed_by_year`): money as decimal text. */
type ClosedYear = { closed_trades: number; price_pnl_usdt: string; fill_commissions_usdt: string; reported_funding_usdt: string };
/** One cycle of `run_cycle`: open to close of one position (no close while it was still open at the
 *  window's end), no prices or sizes stored. */
type Cycle = {
  seq: number; instrument_id: string; side: string; ts_opened_ns: number; ts_closed_ns: number | null;
  realized_pnl: string | null; commissions: string; funding: string; price_pnl: string | null; closing_order_type: string | null;
};
/** One account day: its return (null when the starting balance was not recorded) and mean gross notional. */
type DailyReturn = { ts_event_ns: number; native_return: number | null; mean_gross_notional: string | null };
export type TrialReport = {
  trial_id: number;
  trade_window: { input_start: string; trade_start: string; trade_end: string };
  /** The market day the run read (YYYY-MM-DD). */
  market_day?: string | null;
  runtime: { image_digest: string | null } | null;
  drawdown: Record<string, Measure> | null;
  capital: Record<string, Measure> | null;
  dev_years?: DevYears;
  closed_by_year?: Record<string, ClosedYear> | null;
  cost_basis: { account: { starting_balance_usdt: string | null; execution: string | null } | null } | null;
  availability: { economic_evidence_available: boolean; reasons: string[] } | null;
  /** The report's single-run slices, each with its measures by name. */
  slices: { id: string; measures: Record<string, Measure | null> }[] | null;
  tables: { positions: Cycle[] | null; daily_returns: DailyReturn[] | null } | null;
};
/** The report; the product's refusal; or no report served here. */
export async function fetchTrial(trialId: number, at: string): Promise<{ kind: "report"; report: TrialReport } | Unread> {
  const read = await getJson<TrialReport>(`/api/trial?trial_id=${trialId}&at=${encodeURIComponent(at)}`);
  return read.kind === "ready" ? { kind: "report", report: read.body } : read;
}
