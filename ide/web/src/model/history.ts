// The History page's heatmap (docs/plans/line-close-history-test-20261110.zh.md 4) from `research history` as it is:
// rows are each closed line's participants, grouped by line; columns the calendar years every line's veto
// segments fall in (shared, so lines compare), then the development period, the holdout and the forward part.
// Everything shown is read from the command; nothing is derived here but layout, order and colour.
import type { HistoryCell, HistoryLine, HistoryRow } from "../lib/historyApi";
import type { Step } from "./heat";

export type Metric = "annual_return" | "mark_max_drawdown" | "sharpe_365";
export type Order = "development" | "median" | "meeting";
export type Column = { id: string; label: string; kind: "year" | "development" | "holdout" | "forward" };

/** The shared columns: every veto year of every line, oldest first, then the three segments after them. */
export function columns(lines: readonly HistoryLine[]): Column[] {
  const years = [...new Set(lines.flatMap((l) => l.rows.flatMap((r) => r.cells.filter((c) => c.kind === "veto").map((c) => c.label))))].sort();
  return [...years.map((y): Column => ({ id: y, label: y, kind: "year" })),
          { id: "development", label: "Development", kind: "development" }, { id: "holdout", label: "Holdout", kind: "holdout" },
          { id: "forward", label: "Forward", kind: "forward" }];
}

/** A row's cell in a column: its veto run of that year, its research run (development), its holdout or forward run. */
export function cellAt(row: HistoryRow, column: Column): HistoryCell | null {
  if (column.kind === "development") return row.development;
  if (column.kind === "year") return row.cells.find((c) => c.kind === "veto" && c.label === column.id) ?? null;
  return row.cells.find((c) => c.kind === column.kind) ?? null;
}

/** Whether a cell reaches both of its line's targets: drawdown at most the limit and annual return at least the minimum. */
export function meetsBoth(cell: HistoryCell | null, targets: HistoryLine["targets"]): boolean {
  const m = cell?.measures;
  if (!m || cell!.short || !targets || targets.annual_return == null || targets.max_drawdown == null) return false;
  return m.annual_return != null && m.mark_max_drawdown != null && m.annual_return >= targets.annual_return && m.mark_max_drawdown <= targets.max_drawdown;
}

const EDGES = [0.02, 0.15, 0.4] as const;
/** The colour step of an annual return: grey within ±2%, then ±1 to ±3 at 15% and 40%. */
export function returnStep(value: number | null | undefined): Step | null {
  if (value == null) return null;
  const size = Math.abs(value), k = size < EDGES[0] ? 0 : size < EDGES[1] ? 1 : size < EDGES[2] ? 2 : 3;
  return (value < 0 && k ? -k : k) as Step;
}
export const RETURN_RANGES = ["below −40%", "−40% to −15%", "−15% to −2%", "−2% to +2%", "+2% to +15%", "+15% to +40%", "above +40%"] as const;

/** A row with no edge, hidden unless asked for (3.7, P3): its whole veto years' median annual return is at most 0. */
export const noEdge = (row: HistoryRow) => (row.summary?.veto.median_annual_return ?? Infinity) <= 0;

/** The rows in the order chosen: as the command gives them (development-period Sharpe), by the median whole-year return
 *  or by the years meeting targets, highest first and unknowns last; ties keep the command's order. */
export function ordered(rows: readonly HistoryRow[], by: Order): HistoryRow[] {
  if (by === "development") return [...rows];
  const key = (r: HistoryRow) => (by === "median" ? r.summary?.veto.median_annual_return : r.summary?.veto.years_meeting_targets) ?? null;
  return rows.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => {
    const x = key(a), y = key(b);
    return x === null && y === null ? i - j : x === null ? 1 : y === null ? -1 : y - x || i - j;
  }).map(([r]) => r);
}
