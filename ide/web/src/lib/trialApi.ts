// A sealed trial's report with its drill-down tables (`replay report --tables`), from the page's own
// server under /api/trial at a full ledger commit (ide/research_graph/serve.py). Only what the Runs page's
// backtest reads is typed; the product's refusal comes back as its { code, message }.

/** A measure as the report gives it: its value (a number, or a decimal or time as text) or none. */
export type Measure = { value: number | string | null } | undefined;
/** One cycle of `run_cycle`: open to close of one position, no prices or sizes stored. */
export type Cycle = {
  seq: number; instrument_id: string; side: string; ts_opened_ns: number; ts_closed_ns: number;
  realized_pnl: string; commissions: string; funding: string; price_pnl: string; closing_order_type: string | null;
};
/** One account day: its return (null when the starting balance was not recorded) and mean gross notional. */
export type DailyReturn = { ts_event_ns: number; native_return: number | null; mean_gross_notional: string | null };
export type TrialReport = {
  trial_id: number;
  trade_window: { input_start: string; trade_start: string; trade_end: string };
  runtime: { image_digest: string | null } | null;
  drawdown: Record<string, Measure> | null;
  capital: Record<string, Measure> | null;
  cost_basis: { account: { starting_balance_usdt: string | null; execution: string | null } | null } | null;
  availability: { economic_evidence_available: boolean; reasons: string[] } | null;
  tables: { positions: Cycle[] | null; daily_returns: DailyReturn[] | null } | null;
};
/** The report; the product's refusal; or no report served here (no such route, or the product did not answer). */
export type Fetched = { kind: "report"; report: TrialReport } | { kind: "refused"; code: string; message: string } | { kind: "absent"; message: string };

// The page's server's own failures, as against the product's refusals.
const SERVED = new Set(["PRODUCT_UNAVAILABLE", "PRODUCT_FAILED", "BAD_REQUEST", "NOT_FOUND"]);

export async function fetchTrial(trialId: number, at: string): Promise<Fetched> {
  try {
    const response = await fetch(`/api/trial?trial_id=${trialId}&at=${encodeURIComponent(at)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
    if (response.ok && body) return { kind: "report", report: body as TrialReport };
    if (body?.code && !SERVED.has(body.code)) return { kind: "refused", code: body.code, message: body.message ?? "" };
    return { kind: "absent", message: body?.message ?? `HTTP ${response.status}` };
  } catch (error) {
    return { kind: "absent", message: String(error) };
  }
}
