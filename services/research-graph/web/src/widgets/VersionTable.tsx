import type { TableRow, TableWidget } from "../model/types";
import { meets, ROLE, tone } from "../model/semantics";
import { pct, ratio } from "../lib/format";
import { textClass } from "../theme/roles";
import { PredictionMark, RoleMark } from "../icons/marks";
import { requestFocus } from "../state/linking";
import { select, useSelection } from "../state/selection";
import { columns, DataTable, type Column } from "../components/DataTable";
import { Missing } from "../components/Missing";
import { VersionMenu } from "../components/VersionMenu";

const col = columns<TableRow>();
type Measure = "annual_return" | "max_drawdown" | "sharpe" | "win_rate";
const HEADER: Record<Measure, string> = { annual_return: "Return", max_drawdown: "Drawdown", sharpe: "Sharpe", win_rate: "Win rate" };

function reading(key: Measure, higher: boolean, target: number | null | undefined, format: (x: number) => string): Column<TableRow> {
  return col.accessor(key, {
    header: HEADER[key], meta: { numeric: true }, sortUndefined: "last",
    cell: (c) => {
      const x = c.getValue();
      return x == null ? <Missing /> : <span className={textClass(tone(meets(x, target, higher)))}>{format(x)}</span>;
    },
  }) as Column<TableRow>;
}

// Every version in one sortable table, like an experiment tracker's runs table: the version leads,
// readings that miss a target are marked; clicking a row selects the version and brings it into view.
export function VersionTable({ widget }: { widget: TableWidget }) {
  const selected = useSelection();
  const t = widget.targets ?? {};
  const cols: Column<TableRow>[] = [
    col.accessor("id", {
      header: "Version", sortFn: "alphanumeric",
      cell: (c) => <span className="inline-flex items-center gap-1.5"><RoleMark role={c.row.original.role} size={12} />{c.getValue()}</span>,
    }) as Column<TableRow>,
    col.accessor("first_trial", { header: "First trial", meta: { numeric: true }, sortUndefined: "last", cell: (c) => c.getValue() ?? <Missing /> }) as Column<TableRow>,
    col.accessor("runs", { header: "Runs", meta: { numeric: true } }) as Column<TableRow>,
    reading("annual_return", true, t.annual_return, pct),
    reading("max_drawdown", false, t.max_drawdown, pct),
    reading("sharpe", true, null, ratio),
    reading("win_rate", true, null, pct),
    col.accessor("prediction", {
      header: "Prediction", cell: (c) => c.row.original.prediction === "none" ? <Missing /> : <PredictionMark prediction={c.row.original.prediction} size={16} />,
    }) as Column<TableRow>,
    col.accessor((r) => (r.role ? ROLE[r.role].label : ""), { id: "role", header: "Role", cell: (c) => c.getValue() || <Missing /> }) as Column<TableRow>,
    col.accessor("parent", { header: "Parent", cell: (c) => c.getValue() ?? <Missing /> }) as Column<TableRow>,
  ];
  return (
    <DataTable data={widget.rows} columns={cols} rowId={(r) => r.id} version={(r) => r.id} selected={selected}
               initialSort={[{ id: "first_trial", desc: true }]} onRow={(r) => { select(r.id); requestFocus(r.id); }}
               wrapRow={(r, tr) => <VersionMenu id={r.id}>{tr}</VersionMenu>} />
  );
}
