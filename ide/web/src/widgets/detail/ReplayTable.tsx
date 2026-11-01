import { drawable } from "../../model/stage";
import type { Targets, Trial } from "../../model/types";
import { useOnRunsPage } from "../../state/shell";
import { useShown } from "../../state/shown";
import { chooseTrial } from "../../state/stage";
import { meets, PURPOSE, tone } from "../../model/semantics";
import type { ReactElement } from "react";
import { pct, ratio } from "../../lib/format";
import { textClass } from "../../theme/roles";
import { Icon } from "../../icons/Icon";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { Missing } from "../../components/Missing";
import { Tip } from "../../components/Tip";

const col = columns<Trial>();
const value = (x: number | null | undefined, text: string, ok: boolean | null = null) =>
  x == null ? <Missing /> : <span className={textClass(tone(ok))}>{text}</span>;

/** A version's trials: purpose, readings against the targets, and whether each kept its evidence. On the
 *  Runs page the research replay its backtest draws is selected and another one with evidence picks it;
 *  the out-of-sample replays say why they cannot be. The trial number and every reading align right, the
 *  purpose left. Trial and Elig are as wide as their
 *  headers, so Trial starts under the section title and Elig sits a column gap after Sharpe. */
const FIT = { trial: "w-[calc(5ch+1rem)]", elig: "w-[calc(4ch+1rem)]" };
export function ReplayTable({ trials, targets }: { trials: Trial[]; targets: Targets | null }) {
  const cols: Column<Trial>[] = [
    col.accessor("trial_id", { header: "Trial", meta: { numeric: true, width: FIT.trial } }) as Column<Trial>,
    col.accessor("purpose", { header: "Use", cell: (x) => PURPOSE[x.getValue()] ?? x.getValue() }) as Column<Trial>,
    col.accessor("annual_return", { header: "Return", meta: { numeric: true }, sortUndefined: "last",
      cell: (x) => value(x.getValue(), pct(x.getValue()), meets(x.getValue(), targets?.annual_return, true)) }) as Column<Trial>,
    col.accessor("max_drawdown", { header: "Drawdown", meta: { numeric: true }, sortUndefined: "last",
      cell: (x) => value(x.getValue(), pct(x.getValue()), meets(x.getValue(), targets?.max_drawdown, false)) }) as Column<Trial>,
    col.accessor("sharpe", { header: "Sharpe", meta: { numeric: true }, sortUndefined: "last", cell: (x) => value(x.getValue(), ratio(x.getValue())) }) as Column<Trial>,
    col.accessor("eligible", { header: "Elig", meta: { align: "right", width: FIT.elig }, cell: (x) => {
      const t = x.row.original;
      if (t.eligible === false) return <Tip content={t.ineligible_reason ?? "Ineligible"}><span className="text-fail">Lost</span></Tip>;
      // The check's ink stops 1px inside its box; the margin puts it flush with the header's right edge.
      return t.eligible ? <Icon name="check" tone="meets" className="-mr-px align-middle" /> : <Missing />;
    } }) as Column<Trial>,
  ];
  const runsPage = useOnRunsPage(), { stage, trial } = useShown();
  const picks = runsPage ? { onRow: (t: Trial) => { if (drawable(t)) chooseTrial(t.trial_id); }, selected: stage === "backtest" && trial ? String(trial.trial_id) : null,
    wrapRow: (t: Trial, tr: ReactElement) => (t.purpose === "research" ? tr : <Tip content="Out-of-sample replay: not on this line's window">{tr}</Tip>) } : {};
  return <div className="-mx-2"><DataTable data={trials} columns={cols} rowId={(t) => String(t.trial_id)} fixed sticky={false} {...picks} /></div>;
}
