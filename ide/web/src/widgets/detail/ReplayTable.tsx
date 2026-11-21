import { drawable, RUN_PURPOSES } from "../../model/stage";
import type { Targets, Trial } from "../../model/types";
import { useOnRunsPage } from "../../state/shell";
import { useShown } from "../../state/shown";
import { chooseTrial } from "../../state/stage";
import { meets, PURPOSE, tone } from "../../model/semantics";
import { reasonLabels } from "../../model/measures";
import { useMemo, type ReactElement } from "react";
import { pct, ratio } from "../../lib/format";
import { textClass } from "../../theme/roles";
import { Icon } from "../../icons/Icon";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { Missing, Skeleton } from "../../components/Missing";
import { Tip } from "../../components/Tip";

const col = columns<Trial>();
const value = (x: number | null | undefined, text: string, ok: boolean | null = null, loading = false) =>
  loading ? <Skeleton className="w-10" /> : x == null ? <Missing /> : <span className={textClass(tone(ok))}>{text}</span>;
const PLACEHOLDERS: Trial[] = [{ trial_id: 1, purpose: "research" }, { trial_id: 2, purpose: "research" }];

/** A version's trials: purpose, readings against the targets, and whether each kept its evidence. On the
 *  Runs page the replay its backtest draws is selected and another sealed run with evidence (research,
 *  validation or history) picks it; a precheck or explore replay says why it cannot be. The trial number and every reading align right, the
 *  purpose left. Trial and Elig are as wide as their
 *  headers, so Trial starts under the section title and Elig sits a column gap after Sharpe. */
const FIT = { trial: "w-[calc(5ch+1rem)]", elig: "w-[calc(4ch+1rem)]" };
export function ReplayTable({ trials, targets, loading = false }: { trials: Trial[]; targets: Targets | null; loading?: boolean }) {
  // A cell's function is its component: a new one each render would rebuild every cell.
  const cols = useMemo((): Column<Trial>[] => [
    col.accessor("trial_id", { header: "Trial", meta: { numeric: true, width: FIT.trial },
      cell: (x) => (loading ? <Skeleton className="w-6" /> : x.getValue()) }) as Column<Trial>,
    col.accessor("purpose", { header: "Use",
      cell: (x) => (loading ? <Skeleton className="w-12" /> : PURPOSE[x.getValue()] ?? x.getValue()) }) as Column<Trial>,
    col.accessor("annual_return", { header: "Return", meta: { numeric: true }, sortUndefined: "last",
      cell: (x) => value(x.getValue(), pct(x.getValue()), meets(x.getValue(), targets?.annual_return, true), loading) }) as Column<Trial>,
    col.accessor("max_drawdown", { header: "Drawdown", meta: { numeric: true }, sortUndefined: "last",
      cell: (x) => value(x.getValue(), pct(x.getValue()), meets(x.getValue(), targets?.max_drawdown, false), loading) }) as Column<Trial>,
    col.accessor("sharpe", { header: "Sharpe", meta: { numeric: true }, sortUndefined: "last",
      cell: (x) => value(x.getValue(), ratio(x.getValue()), null, loading) }) as Column<Trial>,
    col.accessor("eligible", { header: "Elig", meta: { align: "right", width: FIT.elig }, cell: (x) => {
      if (loading) return <Skeleton className="w-4" />;
      const t = x.row.original;
      if (t.eligible === false) return <span className="text-fail-fg">Lost</span>;
      // The check's ink stops 1px inside its box; the margin puts it flush with the header's right edge.
      return t.eligible ? <Icon name="check" tone="meets" className="-mr-px align-middle" /> : <Missing />;
    } }) as Column<Trial>,
  ], [targets, loading]);
  const runsPage = useOnRunsPage(), { stage, trial } = useShown();
  const picks = runsPage && !loading ? { onRow: (t: Trial) => { if (drawable(t)) chooseTrial(t.trial_id); }, selected: stage === "backtest" && trial ? String(trial.trial_id) : null,
    wrapRow: (t: Trial, tr: ReactElement) => (RUN_PURPOSES.has(t.purpose) ? tr : <Tip content="Seals no run: nothing to draw">{tr}</Tip>) } : {};
  const rows = loading && !trials.length ? PLACEHOLDERS : trials;
  const lost = loading ? [] : trials.filter((t) => t.eligible === false);
  return (
    <>
      <div className="-mx-2"><DataTable data={rows} columns={cols} rowId={(t) => String(t.trial_id)} fixed sticky={false} {...picks} /></div>
      {/* Why each run lost its evidence, in words, the record's detail after it. */}
      {lost.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {lost.map((t) => (
            <li key={t.trial_id} className="flex min-w-0 gap-2">
              <span className="shrink-0 tabular-nums text-fg-faint">Trial {t.trial_id}</span>
              <span className="min-w-0 truncate" title={t.ineligible_reason ?? undefined}>
                {t.ineligible_reason ? reasonLabels(t.ineligible_reason).map((r, i) => (
                  <span key={i}>{i > 0 && "; "}<span className="text-fail-fg">{r.label}</span>{r.detail && <span className="text-fg-faint"> {r.detail}</span>}</span>
                )) : <span className="text-fail-fg">Ineligible</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
