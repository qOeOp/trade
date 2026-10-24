import type { Targets, Trial } from "../../model/types";
import { meets, PURPOSE, tone } from "../../model/semantics";
import { pct, ratio } from "../../lib/format";
import { textClass } from "../../theme/roles";
import { Icon } from "../../icons/Icon";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { Missing } from "../../components/Missing";
import { Tip } from "../../components/Tip";

const col = columns<Trial>();
const value = (x: number | null | undefined, text: string, ok: boolean | null = null) =>
  x == null ? <Missing /> : <span className={textClass(tone(ok))}>{text}</span>;

/** A version's trials: purpose, readings against the targets, and whether each kept its evidence. */
export function ReplayTable({ trials, targets }: { trials: Trial[]; targets: Targets | null }) {
  const cols: Column<Trial>[] = [
    col.accessor("trial_id", { header: "Trial" }) as Column<Trial>,
    col.accessor("purpose", { header: "Use", cell: (x) => PURPOSE[x.getValue()] ?? x.getValue() }) as Column<Trial>,
    col.accessor("annual_return", { header: "Return", meta: { numeric: true }, sortUndefined: "last",
      cell: (x) => value(x.getValue(), pct(x.getValue()), meets(x.getValue(), targets?.annual_return, true)) }) as Column<Trial>,
    col.accessor("max_drawdown", { header: "Drawdown", meta: { numeric: true }, sortUndefined: "last",
      cell: (x) => value(x.getValue(), pct(x.getValue()), meets(x.getValue(), targets?.max_drawdown, false)) }) as Column<Trial>,
    col.accessor("sharpe", { header: "Sharpe", meta: { numeric: true }, sortUndefined: "last", cell: (x) => value(x.getValue(), ratio(x.getValue())) }) as Column<Trial>,
    col.accessor("eligible", { header: "Elig.", meta: { align: "right" }, cell: (x) => {
      const t = x.row.original;
      if (t.eligible === false) return <Tip content={t.ineligible_reason ?? "Ineligible"}><span className="text-fail">Lost</span></Tip>;
      return t.eligible ? <Icon name="check" tone="meets" className="align-middle" /> : <Missing />;
    } }) as Column<Trial>,
  ];
  return <div className="-mx-2"><DataTable data={trials} columns={cols} rowId={(t) => String(t.trial_id)} fixed sticky={false} /></div>;
}
