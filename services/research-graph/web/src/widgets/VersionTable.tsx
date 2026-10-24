import type { TableRow, TableWidget } from "../model/types";
import { meets, ROLE, tone } from "../model/semantics";
import { pct, ratio } from "../lib/format";
import { textClass } from "../theme/roles";
import { PredictionMark, RoleMark } from "../icons/marks";
import { requestFocus } from "../state/linking";
import { select, useSelection } from "../state/selection";
import { columns, DataTable, type Column } from "../components/DataTable";
import { Missing } from "../components/Missing";

const col = columns<TableRow>();
type Measure = "annual_return" | "max_drawdown" | "sharpe" | "win_rate";
const HEADER: Record<Measure, string> = { annual_return: "年化", max_drawdown: "回撤", sharpe: "夏普", win_rate: "胜率" };

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
      header: "版本", sortFn: "alphanumeric",
      cell: (c) => <span className="inline-flex items-center gap-1.5"><RoleMark role={c.row.original.role} size={12} />{c.getValue()}</span>,
    }) as Column<TableRow>,
    col.accessor("first_trial", { header: "首次试验", meta: { numeric: true }, sortUndefined: "last", cell: (c) => c.getValue() ?? <Missing /> }) as Column<TableRow>,
    col.accessor("runs", { header: "研究运行", meta: { numeric: true } }) as Column<TableRow>,
    reading("annual_return", true, t.annual_return, pct),
    reading("max_drawdown", false, t.max_drawdown, pct),
    reading("sharpe", true, null, ratio),
    reading("win_rate", true, null, pct),
    col.accessor("prediction", {
      header: "预测", cell: (c) => c.row.original.prediction === "none" ? <Missing /> : <PredictionMark prediction={c.row.original.prediction} size={16} />,
    }) as Column<TableRow>,
    col.accessor((r) => (r.role ? ROLE[r.role].label : ""), { id: "role", header: "角色", cell: (c) => c.getValue() || <Missing /> }) as Column<TableRow>,
    col.accessor("parent", { header: "父版本", cell: (c) => c.getValue() ?? <Missing /> }) as Column<TableRow>,
  ];
  return (
    <DataTable data={widget.rows} columns={cols} rowId={(r) => r.id} version={(r) => r.id} selected={selected}
               initialSort={[{ id: "first_trial", desc: true }]} onRow={(r) => { select(r.id); requestFocus(r.id); }} />
  );
}
