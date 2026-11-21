import { useMemo, useState, type ReactNode } from "react";
import { MISSING, pct, plural, ratio } from "../../lib/format";
import type { HistoryCell, HistoryLine, HistoryRow } from "../../lib/historyApi";
import { cause, CAUSES_SAID, cellAt, columns, meetsBoth, noEdge, combinedTip, ordered, RETURN_RANGES, returnStep, vetoTip, type Cause, type Column, type Metric, type Order } from "../../model/history";
import { useHistory } from "../../state/history";
import { useResearchLines } from "../../state/researchLines";
import { showToolWindow } from "../../state/shell";
import { openTrial } from "../../state/stage";
import { DropdownChoice } from "../../ui/Dropdown";
import { HistoryTile } from "../../ui/HistoryTile";
import { Skeleton } from "../../ui/Missing";
import { LineHeader, PriorTip } from "./LineHeader";
import { LineSummary, PickedBar, usePicked, type Picked } from "./LinePanels";
import { Tip } from "../../ui/Tip";
import { Empty } from "../../ui/Waiting";

const SUMMARY_COLS = ["Whole yrs", "Profitable", "Meeting", "Median", "Worst", "Worst DD", "Veto", "Holdout", "Verdict", "DSR"] as const;

const METRICS = [{ value: "annual_return", label: "Annual return" }, { value: "mark_max_drawdown", label: "Max drawdown" },
                 { value: "sharpe_365", label: "Sharpe" }] as const;
const ORDERS = [{ value: "development", label: "Development Sharpe" }, { value: "median", label: "Median whole-year return" },
                { value: "meeting", label: "Years meeting targets" }, { value: "holdout_return", label: "Holdout annual return" },
                { value: "holdout_sharpe", label: "Holdout Sharpe" }, { value: "holdout_drawdown", label: "Holdout max drawdown" }] as const;
type Causes = Cause | "all";
const CAUSES = [{ value: "all", label: "All" }, ...(Object.keys(CAUSES_SAID) as Cause[]).map((value) => ({ value, label: CAUSES_SAID[value][0] }))] as const;
const KIND: Record<HistoryCell["kind"], string> = { veto: "Veto year", control: "Development period, replayed", holdout: "Holdout",
                                                    forward: "Forward", development: "Development period (the research run)" };

const day = (iso: string) => iso.slice(0, 10);
const shown = (metric: Metric, m: NonNullable<HistoryCell["measures"]>) => (metric === "sharpe_365" ? ratio(m[metric]) : pct(m[metric]));

/** What a cell's hover says: its segment and dates, and for a passed run its trades, win rate and readings. */
function tip(cell: HistoryCell, row: HistoryRow, column: Column, shortDays: number): ReactNode {
  const m = cell.measures;
  return (
    <div className="space-y-0.5">
      <p className="font-semibold">{KIND[cell.kind]}{column.kind === "year" ? ` ${column.label}` : ""} · trial {cell.trial_id}</p>
      <p>{day(cell.trade_start)} to {day(cell.trade_end)} UTC{cell.short ? ` · under ${shortDays} days, counted in no summary` : ""}</p>
      {cell.kind === "veto" && !cell.whole_year && !cell.short && <p>Part of the year: the rest is before the market or in the development period</p>}
      {m ? <>
        <p>Annual return {pct(m.annual_return)} · max drawdown {pct(m.mark_max_drawdown)} · Sharpe {ratio(m.sharpe_365)}</p>
        <p>{m.cycles == null ? "Trades unknown" : plural(m.cycles, "trade")} · win rate {pct(m.plan_win_rate)}</p>
      </> : <p>{cell.status === "invalid" ? "The run is invalid: no readings" : "No run yet"}</p>}
      {cell.kind === "development" && row.control_reproduces !== null &&
        <p>{row.control_reproduces ? "Its replay at closing reproduced it exactly" : "Its replay at closing differs: the row has no verdict"}</p>}
      {row.candidate && <p className="text-fg-faint">Click to show it in Details</p>}
    </div>
  );
}

/** One heatmap cell: the chosen metric over the annual return's colour, a star when the segment meets both of
 *  the line's targets, grey when it is too short to count, and words when there is nothing to read. */
function Cell({ cell, row, column, line, metric, shortDays, picked }: { cell: HistoryCell | null; row: HistoryRow; column: Column; line: HistoryLine; metric: Metric; shortDays: number; picked: Picked }) {
  const base = "h-7 min-w-[4.75rem] px-1.5 text-center tabular-nums";
  if (!cell) return <td className={`${base} text-fg-ghost`}><Tip content={column.kind === "forward" ? "No forward part: the holdout reaches the market's end"
    : column.kind === "year" ? "No run this year: the contracts were not listed, or the year is in another segment" : "No run"}><span>{MISSING}</span></Tip></td>;
  const m = cell.measures, traded = !!m && m.cycles !== 0;
  const text = !m ? (cell.status === "invalid" ? "Invalid" : "Running") : !traded ? "No trades" : shown(metric, m);
  const version = row.candidate;
  return (
    <td className="p-0.5">
      <Tip content={tip(cell, row, column, shortDays)}>
        <HistoryTile step={cell.short || !traded ? null : returnStep(m!.annual_return)} quiet={cell.short || !traded} short={cell.short}
                     meets={meetsBoth(cell, line.targets)} partial={cell.kind === "veto" && !cell.whole_year && !cell.short}
                     picked={version !== null && picked.version === version && picked.trial === cell.trial_id} label={`Show trial ${cell.trial_id} in Details`}
                     onPick={version === null ? undefined : () => { openTrial(line.line, version, cell.trial_id); showToolWindow("inspector", "right"); }}>{text}</HistoryTile>
      </Tip>
    </td>
  );
}

const Verdict = ({ ok, tip: why }: { ok: boolean | null | undefined; tip?: ReactNode }) => {
  const body = <span className={ok === true ? "text-meets-fg" : ok === false ? "text-misses-fg" : "text-fg-faint"}>{ok === true ? "Meets" : ok === false ? "Misses" : MISSING}</span>;
  return why ? <Tip content={why}>{body}</Tip> : body;
};

/** A row's summary as the command gives it: the veto years' counts and readings, the two verdicts and the combined one,
 *  and, on a row meeting the targets (the candidates "picked by this reading", line-close-history-test-20261110.zh.md 3.7),
 *  its holdout's Sharpe deflated at the line's participant count. */
function Summary({ row, line }: { row: HistoryRow; line: HistoryLine }) {
  const s = row.summary, td = "px-2 text-right tabular-nums whitespace-nowrap";
  if (!s) return <td colSpan={10} className="px-2 text-misses-fg">Control replay differs from the research run: no verdict</td>;
  const veto = s.veto, dsr = s.holdout.deflated_sharpe;
  return (
    <>
      <td className={td}>{veto.whole_years}</td>
      <td className={td}>{veto.profitable_years}</td>
      <td className={td}>{veto.years_meeting_targets ?? MISSING}</td>
      <td className={td}>{pct(veto.median_annual_return)}</td>
      <td className={td}>{pct(veto.worst_annual_return)}</td>
      <td className={td}>{pct(veto.worst_mark_max_drawdown)}</td>
      <td className={td}><Verdict ok={veto.meets_targets} tip={vetoTip(s)} /></td>
      <td className={td}><Verdict ok={s.holdout.meets_targets} tip={<PriorTip line={line} lead={`Holdout ${pct(s.holdout.annual_return)} a year, drawdown ${pct(s.holdout.mark_max_drawdown)}`} />} /></td>
      <td className={`${td} font-semibold`}><Verdict ok={s.meets_targets} tip={combinedTip(s)} /></td>
      <td className={`${td} text-fg-muted`}>
        {!s.meets_targets && <span className="text-fg-faint">{MISSING}</span>}
        {s.meets_targets && <Tip content={<PriorTip line={line} lead={`The holdout's deflated Sharpe with ${line.participants} participants as the trials: the probability its Sharpe beats the best of that many by luck`} />}>
          <span>{dsr == null ? MISSING : dsr.toFixed(2)}</span></Tip>}
      </td>
    </>
  );
}

/** The column header row (`Participant`, the shared segment columns and the summary columns): once in the table's
 *  sticky `<thead>`, which stays at the top while scrolling, and again, not sticky, under each line's header strip so
 *  that line's rows read under their own labels. A sticky table cell is bounded by the whole table, not its `<tbody>`,
 *  so only the `<thead>` row may stick or every line's copy would pile up at the top. */
function ColumnHeads({ cols, pinned }: { cols: readonly Column[]; pinned: boolean }) {
  const th = "bg-island px-2 py-1 font-normal text-fg-faint whitespace-nowrap";
  return (
    <tr>
      <th scope="col" className={`${th} sticky left-0 ${pinned ? "z-30" : "z-10"} text-left`}>Participant</th>
      {cols.map((c) => <th scope="col" key={c.id} className={`${th} text-center ${c.kind === "development" ? "border-l border-line" : ""}`}>{c.label}</th>)}
      {SUMMARY_COLS.map((h) =>
        <th scope="col" key={h} className={`${th} text-right ${h === "Whole yrs" ? "border-l border-line" : ""}`}>{h}</th>)}
    </tr>
  );
}

/** A line's rows under its header: the line, whether it is closed, how many candidates took part and how many research
 *  trials they came from, the earlier searches of its holdout, its targets and its development period, then the column
 *  labels over the line's participant rows (the first line reads under the sticky table header). */
function LineRows({ line, first, cols, metric, order, all, only, shortDays, summary, picked }: {
  line: HistoryLine; first: boolean; cols: Column[]; metric: Metric; order: Order; all: boolean; only: Causes; shortDays: number;
  summary: string | null | undefined; picked: Picked;
}) {
  // A Cause shows its rows whatever their edge, so the no-edge filter applies only to All.
  const rows = ordered(line.rows, order), edgeless = (r: HistoryRow) => !all && only === "all" && noEdge(r), other = (r: HistoryRow) => only !== "all" && cause(r) !== only;
  const shown = rows.filter((r) => !edgeless(r) && !other(r)), hidden = { edge: rows.filter(edgeless).length, cause: rows.filter(other).length };
  return (
    <tbody className="border-t border-line">
      <LineHeader line={line} colSpan={cols.length + 11} hidden={hidden} />
      {summary && <LineSummary text={summary} colSpan={cols.length + 11} />}
      {!first && <ColumnHeads cols={cols} pinned={false} />}
      {shown.map((row) => (
        <tr key={row.run} className="hover:bg-row-hover">
          <th className="sticky left-0 z-10 max-w-56 truncate bg-island px-2 text-left font-mono font-normal">
            <Tip content={<div className="space-y-0.5"><p>Research run {row.run} · source {row.source_sha256.slice(0, 12)}</p><p>{CAUSES_SAID[cause(row)][1]}</p></div>}>
              <span>{row.candidate ?? row.source_sha256.slice(0, 12)}</span></Tip>
          </th>
          {cols.map((c) => <Cell key={c.id} cell={cellAt(row, c)} row={row} column={c} line={line} metric={metric} shortDays={shortDays} picked={picked} />)}
          <Summary row={row} line={line} />
        </tr>
      ))}
    </tbody>
  );
}

/** The line-close history heatmap (docs/plans/line-close-history-test-20261110.zh.md 4): every closed or closing line's
 *  participants against shared calendar-year columns, the development period, the holdout and the forward part,
 *  each cell a separate replay from flat; the verdicts and the participant-deflated Sharpe as `research history`
 *  gives them. A falsification test, not out-of-sample validation. */
export function HistoryPage() {
  const { history, reading, error } = useHistory();
  const [metric, setMetric] = useState<Metric>("annual_return"), [order, setOrder] = useState<Order>("development"), [all, setAll] = useState(false);
  const [only, setOnly] = useState<Causes>("all");
  const lines = history?.lines ?? [], cols = useMemo(() => columns(lines), [lines]);
  const summaries = useResearchLines().lines, picked = usePicked(lines);
  if (!history && error) return <Empty title="Can't read the history tests">{error}</Empty>;
  if (history && !lines.length) return <Empty title="No line has a history test yet">A line's closing replays every participant over the years before its development period, its holdout and what follows; they show here as they run.</Empty>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-(--header-h) shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 text-dense">
        <span className="whitespace-nowrap font-semibold">Line-close history</span>
        <span className="whitespace-normal text-fg-faint">{history ? <>{plural(lines.length, "line")} · each cell replayed from flat{reading ? " · reading…" : ""}{error ? ` · ${error}` : ""}</> : <Skeleton className="w-40" />}</span>
        <PickedBar lines={lines} picked={picked} />
        <span className="ml-auto flex shrink-0 items-center gap-3">
          <DropdownChoice<Causes> name="Cause" label="Cause" options={CAUSES} value={only} onChange={setOnly} />
          <Tip content={only === "all" ? null : "A Cause shows its rows whatever their edge"}>
            <label className={`flex items-center gap-1.5 whitespace-nowrap ${only === "all" ? "text-fg-muted" : "text-fg-ghost"}`}>
              <input type="checkbox" checked={all} disabled={only !== "all"} onChange={(e) => setAll(e.target.checked)} />Rows with no edge</label></Tip>
          <DropdownChoice<Metric> name="Show" label="Show" options={METRICS} value={metric} onChange={setMetric} />
          <DropdownChoice<Order> name="Order" label="Order" options={ORDERS} value={order} onChange={setOrder} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-separate border-spacing-0 text-dense">
          <thead className="sticky top-0 z-20 bg-island"><ColumnHeads cols={cols} pinned /></thead>
          {history ? lines.map((l, i) => <LineRows key={l.line} line={l} first={i === 0} cols={cols} metric={metric} order={order} all={all} only={only}
                                                          shortDays={history.short_days} summary={summaries.find((s) => s.name === l.line)?.summary} picked={picked} />) : (
            <tbody className="border-t border-line">
              {[0, 1, 2, 3, 4].map((r) => (
                <tr key={r}>
                  <th className="sticky left-0 z-10 bg-island px-2 py-1 text-left font-normal"><Skeleton className="w-32" /></th>
                  {cols.map((c) => <td key={c.id} className="p-0.5"><div className="skeleton h-7 min-w-[4.75rem] rounded-badge opacity-45" /></td>)}
                  {SUMMARY_COLS.map((h) => <td key={h} className="px-2 text-right"><Skeleton className="w-8" /></td>)}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      <p className="shrink-0 px-3 py-1.5 text-small text-fg-faint">
        Colour: annual return ({RETURN_RANGES[0]} to {RETURN_RANGES[6]}) · star: the segment meets both targets{history && <> · grey: under {history.short_days} days, not counted</>} · hatched: part of a year.
        The verdict reads the veto years and the holdout apart; it tests, it does not validate, and picking by it is a choice among the participants.
      </p>
    </div>
  );
}
