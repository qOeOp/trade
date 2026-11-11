// Every closed or closing line's history test (`research history`), from the page's own server under /api/history at
// the head or a full ledger commit (ide/research_graph/serve.py). Shapes as report/history.py writes them.

export type HistoryMeasures = {
  annual_return: number | null; mark_max_drawdown: number | null; sharpe_365: number | null; cycles: number | null; plan_win_rate: number | null;
};
/** One history run (a veto year, the control, the holdout or the forward part) or the research run itself
 *  (`development`); measures only for a passed run. */
export type HistoryCell = {
  trial_id: number; kind: "veto" | "control" | "holdout" | "forward" | "development"; label: string;
  trade_start: string; trade_end: string; status: "passed" | "invalid" | null; whole_year: boolean; short: boolean;
  measures?: HistoryMeasures;
};
export type HistorySummary = {
  veto: { whole_years: number; profitable_years: number; median_annual_return: number | null; worst_annual_return: number | null;
          worst_mark_max_drawdown: number | null; years_meeting_targets: number | null; meets_targets: boolean | null };
  holdout: { annual_return: number | null; mark_max_drawdown: number | null; meets_targets: boolean | null; deflated_sharpe?: number | null };
  meets_targets: boolean | null; judged_on: "veto and holdout" | "holdout" | null;
};
export type HistoryRow = {
  source_sha256: string; candidate: string | null; run: number; development: HistoryCell; cells: HistoryCell[];
  control_reproduces: boolean | null; summary: HistorySummary | null;
};
export type HistoryLine = {
  line: string; closed: boolean; dev_start: string; dev_end: string;
  targets: { max_drawdown: number | null; annual_return: number | null } | null;
  participants: number; research_trials: number;
  discount?: { trials: number; holdouts_with_returns: number; daily_sharpe_variance: number | null };
  rows: HistoryRow[];
};
export type History = { ledger_commit: string; short_days: number; lines: HistoryLine[] };

export async function fetchHistory(at: string | null): Promise<{ kind: "ready"; history: History } | { kind: "failed"; message: string }> {
  try {
    const response = await fetch(`/api/history${at ? `?at=${encodeURIComponent(at)}` : ""}`, { cache: "no-store" });
    const body = await response.json().catch(() => null) as (History & { message?: string }) | null;
    if (response.ok && body) return { kind: "ready", history: body };
    return { kind: "failed", message: body?.message ?? `HTTP ${response.status}` };
  } catch (error) {
    return { kind: "failed", message: String(error) };
  }
}
