import type { TableRow, TableWidget } from "../types";
import { meets, pct, PREDICTION, ratio, readingColor, ROLE } from "../format";
import { columns, DataTable, RoleMark, type Column } from "../ui";
import { Icon } from "../icons";
import { requestFocus } from "../store";

const col = columns<TableRow>();

// Every version in one sortable table, like an experiment tracker's runs table: the version column
// leads, readings that miss a target are marked, and the best value of each reading is bold.
export function VersionTable({ widget, selected, onSelect }: { widget: TableWidget; selected: string | null; onSelect: (id: string) => void }) {
  const t = widget.targets ?? {};
  const best = (key: "annual_return" | "max_drawdown" | "sharpe" | "win_rate", higher: boolean) => {
    const values = widget.rows.map((r) => r[key]).filter((v): v is number => v != null);
    return values.length ? (higher ? Math.max(...values) : Math.min(...values)) : null;
  };
  const reading = (key: "annual_return" | "max_drawdown" | "sharpe" | "win_rate", higher: boolean, target?: number | null, format = pct) => {
    const top = best(key, higher);
    return col.accessor(key, {
      header: { annual_return: "年化", max_drawdown: "回撤", sharpe: "夏普", win_rate: "胜率" }[key], meta: { numeric: true },
      sortUndefined: "last",
      cell: (c) => {
        const v = c.getValue() as number | null | undefined;
        return <span style={{ color: readingColor(meets(v, target, higher)), fontWeight: v != null && v === top ? 650 : undefined }}>{format(v)}</span>;
      },
    }) as Column<TableRow>;
  };
  const cols: Column<TableRow>[] = [
    col.accessor("id", {
      header: "版本", sortFn: "alphanumeric",
      cell: (c) => (
        <span className="inline-flex items-center gap-1.5"><RoleMark role={c.row.original.role} size={12} />
          <span className="mono">{c.getValue()}</span></span>
      ),
    }) as Column<TableRow>,
    col.accessor("first_trial", { header: "首次试验", meta: { numeric: true }, sortUndefined: "last", cell: (c) => c.getValue() ?? "-" }) as Column<TableRow>,
    col.accessor("runs", { header: "研究运行", meta: { numeric: true } }) as Column<TableRow>,
    reading("annual_return", true, t.annual_return),
    reading("max_drawdown", false, t.max_drawdown),
    reading("sharpe", true, null, ratio),
    reading("win_rate", true, null),
    col.accessor("prediction", {
      header: "预测", cell: (c) => {
        const p = PREDICTION[c.row.original.prediction];
        return p.glyph ? <Icon name={p.glyph} color={p.color} size={14} className="align-[-3px]" /> : <span className="ghost">-</span>;
      },
    }) as Column<TableRow>,
    col.accessor((r) => (r.role ? ROLE[r.role].label : "-"), { id: "role", header: "角色", cell: (c) => <span className="muted">{c.getValue()}</span> }) as Column<TableRow>,
    col.accessor("parent", { header: "父版本", cell: (c) => <span className="mono faint">{c.getValue() ?? "-"}</span> }) as Column<TableRow>,
  ];
  return (
    <DataTable data={widget.rows} columns={cols} rowId={(r) => r.id} version={(r) => r.id} selected={selected}
               initialSort={[{ id: "first_trial", desc: true }]}
               onRow={(r) => { onSelect(r.id); requestFocus(r.id); }} />
  );
}
