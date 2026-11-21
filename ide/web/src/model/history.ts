// The History page's heatmap (docs/plans/line-close-history-test-20261110.zh.md 4) from `research history` as it is:
// rows are each closed line's participants, grouped by line; columns the calendar years every line's veto
// segments fall in (shared, so lines compare), then the development period, the holdout and the forward part.
// Everything shown is read from the command; nothing is derived here but layout, order, colour and the display-only
// cause class (cause).
import type { HistoryCell, HistoryLine, HistoryRow, HistorySummary } from "../lib/historyApi";
import { rangesOf, stepOf, type Step } from "./heat";

export type Metric = "annual_return" | "mark_max_drawdown" | "sharpe_365";
export type Order = "development" | "median" | "meeting" | "holdout_return" | "holdout_sharpe" | "holdout_drawdown";
export type Cause = "sign_flip" | "positive_outside" | "other";
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

/** `holdout_prior_trials` as the API gives it: the count of counted trials in this ledger that already searched the line's
 *  holdout (its own history trials left out), or null when the API gave none (before the line's first research trial,
 *  or an older server). Zero is a count: none was counted here, which says nothing of searches outside the ledger. */
export const priorTrials = (line: HistoryLine): number | null => line.holdout_prior_trials?.trials ?? null;

/** The earlier searches by line and purpose, one phrase each ("rsi-twin, history: 2 trials"; "no line" for a trial on none). */
export const priorGroups = (line: HistoryLine): string[] =>
  (line.holdout_prior_trials?.by_line ?? []).map((g) => `${g.line ?? "no line"}, ${g.purpose}: ${g.trials} ${g.trials === 1 ? "trial" : "trials"}`);

/** A summary's `missing` in words, in the API's order: "veto 2022" is the 2022 veto year, the others the control run, a
 *  countable holdout and the line's targets; a name this page does not know is shown as it came. */
export const missingWords = (missing: readonly string[] | undefined): string[] =>
  (missing ?? []).map((m) => m.startsWith("veto ") ? `the ${m.slice(5)} veto year` : m === "control" ? "the control run"
    : m === "holdout" ? "a countable holdout" : m === "targets" ? "the line's targets" : m);
/** The veto years among `missing`, as "the 2022 veto year". */
export const missingYears = (missing: readonly string[] | undefined): string[] => missingWords((missing ?? []).filter((m) => m.startsWith("veto ")));
/** "a", "a and b", "a, b and c". */
export const listed = (items: readonly string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** The veto verdict's hover: its rule, or, when a veto year is missing (`missing`), which years and that nothing is decided. */
export function vetoTip(s: HistorySummary): string {
  const years = missingYears(s.missing);
  if (years.length) return `No verdict: no readings for ${listed(years)}, so the veto years are not judged`;
  return s.veto.whole_years ? "Every whole veto year's drawdown within the limit and their median return at least the minimum" : "No whole veto year to judge";
}

/** The combined verdict's hover: what it read, or, undecided, what it lacks (`missing`): the holdout's own verdict then
 *  does not make the row meet the targets. */
export function combinedTip(s: HistorySummary): string {
  const lacks = missingWords(s.missing);
  if (lacks.length) return `Undecided: no reading of ${listed(lacks)}. A verdict needs every reading it is defined on`;
  return s.judged_on === "holdout" ? "On the holdout alone: no whole veto year counts" : s.judged_on ? "On the veto years and the holdout" : "Nothing countable to judge";
}

const EDGES = [0.02, 0.15, 0.4] as const;
/** The colour step of an annual return: grey within ±2%, then ±1 to ±3 at 15% and 40%. */
export const returnStep = (value: number | null | undefined): Step | null => stepOf(value, EDGES);
export const RETURN_RANGES = rangesOf(EDGES, (v) => `${Math.round(v * 100)}%`);

/** A row with no edge, hidden unless asked for (3.7, P3): the combined verdict rejects it (so it lacks no reading) and
 *  neither part outside the development period made money: its whole veto years' median annual return (when the test
 *  has whole years) and its holdout's annual return are each at most 0. A row the verdict meets, leaves undecided or
 *  voids (no summary) is never hidden. */
export function noEdge(row: HistoryRow): boolean {
  const s = row.summary;
  if (s?.meets_targets !== false) return false;
  const veto = s.veto.whole_years === 0 || (s.veto.median_annual_return ?? Infinity) <= 0;
  return veto && (s.holdout.annual_return ?? Infinity) <= 0;
}

/** A row's cause class, for display only, derived from its readings: `sign_flip` when the development period made money
 *  but the whole veto years' median or the holdout lost it; `positive_outside` when the holdout and the whole veto
 *  years' median (if the test has whole years) both made money; `other` for the rest (a development period that lost,
 *  a flat or missing reading, or no summary). */
export function cause(row: HistoryRow): Cause {
  const s = row.summary;
  if (!s) return "other";
  const dev = row.development.measures?.annual_return ?? null, held = s.holdout.annual_return, years = s.veto.whole_years > 0,
        median = s.veto.median_annual_return;
  if (dev !== null && dev > 0 && ((held !== null && held < 0) || (years && median !== null && median < 0))) return "sign_flip";
  if (held !== null && held > 0 && (!years || (median !== null && median > 0))) return "positive_outside";
  return "other";
}

/** Each cause class's name and what it means. */
export const CAUSES_SAID: Record<Cause, readonly [string, string]> = {
  sign_flip: ["Sign flip", "Sign flip: the development period made money, the whole veto years' median or the holdout lost it"],
  positive_outside: ["Positive outside development", "Positive outside development: the holdout and the whole veto years' median both made money"],
  other: ["Other", "Other: neither a sign flip nor positive outside development"],
};

/** The sort key of a row and whether higher is better: the holdout's drawdown sorts lowest first, the rest highest first. */
function key(r: HistoryRow, by: Exclude<Order, "development">): number | null {
  const s = r.summary;
  if (by === "median") return s?.veto.median_annual_return ?? null;
  if (by === "meeting") return s?.veto.years_meeting_targets ?? null;
  if (by === "holdout_return") return s?.holdout.annual_return ?? null;
  if (by === "holdout_drawdown") return s?.holdout.mark_max_drawdown == null ? null : -s.holdout.mark_max_drawdown;
  return r.cells.find((c) => c.kind === "holdout")?.measures?.sharpe_365 ?? null;
}

/** The rows in the order chosen: as the command gives them (development-period Sharpe), by the median whole-year return,
 *  the years meeting targets, the holdout's annual return or Sharpe (highest first) or its max drawdown (lowest first);
 *  unknowns last, ties keep the command's order. */
export function ordered(rows: readonly HistoryRow[], by: Order): HistoryRow[] {
  if (by === "development") return [...rows];
  return rows.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => {
    const x = key(a, by), y = key(b, by);
    return x === null && y === null ? i - j : x === null ? 1 : y === null ? -1 : y - x || i - j;
  }).map(([r]) => r);
}

/** The picked replay's way on: its line, its version and whether its row's combined verdict meets the line's targets,
 *  the one case out-of-sample validation may be asked for (`research-round`'s validation reference); none with nothing
 *  picked. The row is the one holding the picked trial, else the version's first. */
export function pickedWay(lines: readonly HistoryLine[], picked: { version: string | null; trial: number | null }):
  { line: string; version: string; validate: boolean } | null {
  const { version, trial } = picked;
  if (!version || trial === null) return null;
  const holds = (r: HistoryRow) => r.development.trial_id === trial || r.cells.some((c) => c.trial_id === trial);
  const rows = lines.flatMap((l) => l.rows.filter((r) => r.candidate === version).map((r) => [l, r] as const));
  const [line, row] = rows.find(([, r]) => holds(r)) ?? rows[0] ?? [];
  return line && row ? { line: line.line, version, validate: row.summary?.meets_targets === true } : null;
}

/** What Validate… puts in the Agent's message box, for the user to send: registering a validation writes the ledger,
 *  which only the Agent does, after it has read the verdict and proposed a window rule and universe. */
export const validationAsk = (line: string, version: string): string =>
  `On the Line-close history page I picked ${version} of line ${line}: its closing history test meets the targets. ` +
  "I want to register out-of-sample validation for it. Read its verdict in `research history`, then propose a window rule and universe.";
