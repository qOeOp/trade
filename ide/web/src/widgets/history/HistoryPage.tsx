import { useMemo, useState, type ReactNode } from "react";
import { pct, plural, ratio } from "../../lib/format";
import type { HistoryCell, HistoryLine, HistoryRow } from "../../lib/historyApi";
import { cellAt, columns, meetsBoth, noEdge, ordered, RETURN_RANGES, returnStep, type Column, type Metric, type Order } from "../../model/history";
import { useHistory } from "../../state/history";
import { Dropdown, DropdownRadio } from "../../components/Dropdown";
import { HistoryTile } from "../../components/HistoryTile";
import { Tip } from "../../components/Tip";

const METRICS = [{ value: "annual_return", label: "Annual return" }, { value: "mark_max_drawdown", label: "Max drawdown" },
                 { value: "sharpe_365", label: "Sharpe" }] as const;
const ORDERS = [{ value: "development", label: "Development Sharpe" }, { value: "median", label: "Median whole-year return" },
                { value: "meeting", label: "Years meeting targets" }] as const;
const KIND: Record<HistoryCell["kind"], string> = { veto: "Veto year", control: "Development period, replayed", holdout: "Holdout",
                                                    forward: "Forward", development: "Development period (the research run)" };

function Choice<T extends string>({ name, options, value, onChange }: { name: string; options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <Dropdown variant="compact" align="end" label={name}
              trigger={<span className="whitespace-nowrap"><span className="text-fg-faint">{name}</span> {options.find((o) => o.value === value)?.label}</span>}>
      <DropdownRadio value={value} options={options} onChange={onChange} />
    </Dropdown>
  );
}

const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="grid h-full place-items-center p-6 text-center text-dense">
    <div className="max-w-md"><p className="font-semibold text-fg">{title}</p>{children && <p className="mt-2 text-balance text-fg-muted">{children}</p>}</div>
  </div>
);

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
    </div>
  );
}

/** One heatmap cell: the chosen metric over the annual return's colour, a thick border when the segment meets both of
 *  the line's targets, grey when it is too short to count, and words when there is nothing to read. */
function Cell({ cell, row, column, line, metric, shortDays }: { cell: HistoryCell | null; row: HistoryRow; column: Column; line: HistoryLine; metric: Metric; shortDays: number }) {
  const base = "h-7 min-w-[4.75rem] px-1.5 text-center tabular-nums";
  if (!cell) return <td className={`${base} text-fg-ghost`}><Tip content={column.kind === "forward" ? "No forward part: the holdout reaches the market's end"
    : column.kind === "year" ? "No run this year: the contracts were not listed, or the year is in another segment" : "No run"}><span>–</span></Tip></td>;
  const m = cell.measures, traded = !!m && m.cycles !== 0;
  const text = !m ? (cell.status === "invalid" ? "Invalid" : "Running") : !traded ? "No trades" : shown(metric, m);
  return (
    <td className="p-0.5">
      <Tip content={tip(cell, row, column, shortDays)}>
        <div><HistoryTile step={cell.short || !traded ? null : returnStep(m!.annual_return)} quiet={cell.short || !traded} short={cell.short}
                          meets={meetsBoth(cell, line.targets)} partial={cell.kind === "veto" && !cell.whole_year && !cell.short}>{text}</HistoryTile></div>
      </Tip>
    </td>
  );
}

const Verdict = ({ ok, tip: why }: { ok: boolean | null | undefined; tip?: ReactNode }) => {
  const body = <span className={ok === true ? "text-meets-fg" : ok === false ? "text-misses-fg" : "text-fg-faint"}>{ok === true ? "Meets" : ok === false ? "Misses" : "–"}</span>;
  return why ? <Tip content={why}>{body}</Tip> : body;
};

/** A row's summary as the command gives it: the veto years' counts and readings, the two verdicts and the combined one,
 *  and, on a row meeting the targets, its holdout's Sharpe deflated at the line's participant count. */
function Summary({ row, line }: { row: HistoryRow; line: HistoryLine }) {
  const s = row.summary, td = "px-2 text-right tabular-nums whitespace-nowrap";
  if (!s) return <td colSpan={9} className="px-2 text-misses-fg">Control replay differs from the research run: no verdict</td>;
  const veto = s.veto, dsr = s.holdout.deflated_sharpe;
  return (
    <>
      <td className={td}>{veto.whole_years}</td>
      <td className={td}>{veto.profitable_years}</td>
      <td className={td}>{veto.years_meeting_targets ?? "–"}</td>
      <td className={td}>{pct(veto.median_annual_return)}</td>
      <td className={td}>{pct(veto.worst_annual_return)}</td>
      <td className={td}>{pct(veto.worst_mark_max_drawdown)}</td>
      <td className={td}><Verdict ok={veto.meets_targets} tip={veto.whole_years ? "Every whole veto year's drawdown within the limit and their median return at least the minimum" : "No whole veto year to judge"} /></td>
      <td className={td}><Verdict ok={s.holdout.meets_targets} tip={`Holdout ${pct(s.holdout.annual_return)} a year, drawdown ${pct(s.holdout.mark_max_drawdown)}`} /></td>
      <td className={`${td} font-semibold`}>
        <Verdict ok={s.meets_targets} tip={s.judged_on === "holdout" ? "On the holdout alone: no whole veto year counts" : s.judged_on ? "On the veto years and the holdout" : "Nothing countable to judge"} />
        {s.meets_targets && <Tip content={`The holdout's deflated Sharpe with ${line.participants} participants as the trials: the probability its Sharpe beats the best of that many by luck`}>
          <span className="ml-2 font-normal text-fg-muted">DSR {dsr == null ? "–" : dsr.toFixed(2)}</span></Tip>}
      </td>
    </>
  );
}

/** A line's rows under its header: the line, whether it is closed, how many candidates took part and how many research
 *  trials they came from, its targets and its development period. */
function LineRows({ line, cols, metric, order, all, shortDays }: { line: HistoryLine; cols: Column[]; metric: Metric; order: Order; all: boolean; shortDays: number }) {
  const rows = ordered(line.rows, order), shown = all ? rows : rows.filter((r) => !noEdge(r)), hidden = rows.length - shown.length;
  const t = line.targets;
  return (
    <tbody className="border-t border-line">
      <tr className="bg-island-alt">
        <th colSpan={cols.length + 10} className="sticky left-0 px-2 py-1.5 text-left font-normal">
          <span className="font-mono font-semibold">{line.line}</span>
          <span className="ml-3 text-fg-muted">{line.closed ? "Closed" : "Closing"} · {plural(line.participants, "participant")} from {plural(line.research_trials, "research trial")}
            {t && ` · drawdown ≤ ${pct(t.max_drawdown)}, annual return ≥ ${pct(t.annual_return)}`} · development {line.dev_start} to {line.dev_end}
            {hidden > 0 && ` · ${hidden} with no edge hidden`}</span>
        </th>
      </tr>
      {shown.map((row) => (
        <tr key={row.run} className="hover:bg-row-hover">
          <th className="sticky left-0 z-10 max-w-56 truncate bg-island px-2 text-left font-mono font-normal">
            <Tip content={`Research run ${row.run} · source ${row.source_sha256.slice(0, 12)}`}><span>{row.candidate ?? row.source_sha256.slice(0, 12)}</span></Tip>
          </th>
          {cols.map((c) => <Cell key={c.id} cell={cellAt(row, c)} row={row} column={c} line={line} metric={metric} shortDays={shortDays} />)}
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
  const lines = history?.lines ?? [], cols = useMemo(() => columns(lines), [lines]);
  if (!history) return error ? <Empty title="Can't read the history tests">{error}</Empty> : <Empty title="Reading the history tests…" />;
  if (!lines.length) return <Empty title="No line has a history test yet">A line's closing replays every participant over the years before its development period, its holdout and what follows; they show here as they run.</Empty>;
  const th = "px-2 py-1 font-normal text-fg-faint whitespace-nowrap";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-(--header-h) shrink-0 items-center gap-x-3 px-3 text-dense">
        <span className="font-semibold">Line-close history</span>
        <span className="text-fg-faint">{plural(lines.length, "line")} · each cell replayed from flat{reading ? " · reading…" : ""}{error ? ` · ${error}` : ""}</span>
        <span className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-fg-muted"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Rows with no edge</label>
          <Choice<Metric> name="Show" options={METRICS} value={metric} onChange={setMetric} />
          <Choice<Order> name="Order" options={ORDERS} value={order} onChange={setOrder} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-separate border-spacing-0 text-dense">
          <thead className="sticky top-0 z-20 bg-island">
            <tr>
              <th className={`${th} sticky left-0 z-30 bg-island text-left`}>Participant</th>
              {cols.map((c) => <th key={c.id} className={`${th} text-center ${c.kind === "development" ? "border-l border-line" : ""}`}>{c.label}</th>)}
              {["Whole yrs", "Profitable", "Meeting", "Median", "Worst", "Worst DD", "Veto", "Holdout", "Verdict"].map((h) =>
                <th key={h} className={`${th} text-right ${h === "Whole yrs" ? "border-l border-line" : ""}`}>{h}</th>)}
            </tr>
          </thead>
          {lines.map((l) => <LineRows key={l.line} line={l} cols={cols} metric={metric} order={order} all={all} shortDays={history.short_days} />)}
        </table>
      </div>
      <p className="shrink-0 px-3 py-1.5 text-small text-fg-faint">
        Colour: annual return ({RETURN_RANGES[0]} to {RETURN_RANGES[6]}) · thick border: the segment meets both targets · grey: under {history.short_days} days, not counted · hatched: part of a year.
        The verdict reads the veto years and the holdout apart; it tests, it does not validate, and picking by it is a choice among the participants.
      </p>
    </div>
  );
}
