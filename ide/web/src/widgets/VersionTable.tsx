import { useMemo } from "react";
import type { TableRow, TableWidget } from "../model/types";
import { meets, ROLE, tone } from "../model/semantics";
import { pct, ratio } from "../lib/format";
import { textClass } from "../theme/roles";
import { RoleMark } from "../icons/marks";
import { PredictionMark } from "./PredictionMark";
import { requestFocus } from "../state/linking";
import { select, useSelection } from "../state/selection";
import { columns, DataTable, type Column } from "../ui/DataTable";
import { Missing } from "../ui/Missing";
import { TextButton } from "../ui/TextButton";
import { fold, unfold, useFoldable, useFolded } from "./useFolded";
import { VersionMenu } from "./runs/VersionMenu";

const col = columns<TableRow>();
type Measure = "annual_return" | "max_drawdown" | "sharpe" | "plan_win_rate";
const HEADER: Record<Measure, string> = { annual_return: "Return", max_drawdown: "Drawdown", sharpe: "Sharpe", plan_win_rate: "Plan win rate" };

function reading(key: Measure, higher: boolean, target: number | null | undefined, format: (x: number) => string): Column<TableRow> {
  return col.accessor(key, {
    header: HEADER[key], meta: { numeric: true }, sortUndefined: "last",
    cell: (c) => {
      const x = c.getValue();
      return x == null ? <Missing /> : <span className={textClass(tone(meets(x, target, higher)))}>{format(x)}</span>;
    },
  }) as Column<TableRow>;
}

// Every version the lineage shows in one sortable table, like an experiment tracker's runs table: the version
// leads, readings that miss a target are marked; clicking a row selects the version and brings it into view.
// The table follows the lineage's fold, so the unpassed versions the canvas folds are left out here too.
export function VersionTable({ widget }: { widget: TableWidget }) {
  const selected = useSelection(), folded = useFolded();
  const rows = useMemo(() => widget.rows.filter((r) => !folded.has(r.id)), [widget.rows, folded]);
  const t = widget.targets ?? {};
  // A cell's function is its component: a new one each render would rebuild every cell.
  const cols = useMemo((): Column<TableRow>[] => [
    col.accessor("id", {
      header: "Version", sortFn: "alphanumeric",
      cell: (c) => <span className="inline-flex items-center gap-1.5"><RoleMark role={c.row.original.role} size={12} />{c.getValue()}</span>,
    }) as Column<TableRow>,
    col.accessor("first_trial", { header: "First trial", meta: { numeric: true }, sortUndefined: "last", cell: (c) => c.getValue() ?? <Missing /> }) as Column<TableRow>,
    col.accessor("runs", { header: "Runs", meta: { numeric: true } }) as Column<TableRow>,
    reading("annual_return", true, t.annual_return, pct),
    reading("max_drawdown", false, t.max_drawdown, pct),
    reading("sharpe", true, null, ratio),
    reading("plan_win_rate", true, null, pct),
    col.accessor("prediction", {
      header: "Prediction", cell: (c) => c.row.original.prediction === "none" ? <Missing /> : <PredictionMark prediction={c.row.original.prediction} failed={c.row.original.failed_predictions} size={16} />,
    }) as Column<TableRow>,
    col.accessor((r) => (r.role ? ROLE[r.role].label : ""), { id: "role", header: "Role", cell: (c) => c.getValue() || <Missing /> }) as Column<TableRow>,
    col.accessor("parent", { header: "Parent", cell: (c) => c.getValue() ?? <Missing /> }) as Column<TableRow>,
  ], [widget.targets]);
  return (
    <DataTable data={rows} columns={cols} rowId={(r) => r.id} version={(r) => r.id} selected={selected}
               initialSort={[{ id: "first_trial", desc: true }]} onRow={(r) => { select(r.id); requestFocus(r.id); }}
               wrapRow={(r, tr) => <VersionMenu id={r.id}>{tr}</VersionMenu>} />
  );
}

/** The table's header: how many versions the lineage's fold leaves out, and the canvas's own fold controls. */
export function VersionTableTools() {
  const hidden = useFolded().size, foldable = useFoldable();
  if (!foldable) return null;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-small text-fg-faint">
      {hidden > 0 ? <>{hidden} hidden<TextButton size="text" onClick={unfold} title="Show every version, here and in the lineage">Expand all</TextButton></>
        : <TextButton size="text" onClick={fold} title="Fold the unpassed versions, here and in the lineage">Fold unpassed</TextButton>}
    </span>
  );
}
