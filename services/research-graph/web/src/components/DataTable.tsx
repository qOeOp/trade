import { useState, type ReactElement } from "react";
import {
  createColumnHelper, createSortedRowModel, flexRender, rowSortingFeature, sortFn_alphanumeric, sortFn_basic, tableFeatures,
  useTable, type ColumnDef, type RowData, type SortingState,
} from "@tanstack/react-table";
import { Icon } from "../icons/Icon";
import { hoverProps } from "../state/linking";

const features = tableFeatures({
  rowSortingFeature, sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});
// TanStack's column value type varies per column, so the column helper's value type is `any`.
export type Column<T extends RowData> = ColumnDef<typeof features, T, any>;
export const columns = <T extends RowData>() => createColumnHelper<typeof features, T>();

/** Column meta: `numeric` or `align: "right"` right-aligns a column, header included; `width` is a width
 *  class for its header (with `fixed`, the columns without one share what is left equally). */
type Meta = { numeric?: boolean; align?: "right"; width?: string } | undefined;
const right = (meta: unknown) => !!((meta as Meta)?.numeric || (meta as Meta)?.align === "right");

/** A dense, sortable table in one face, size and weight: 24px rows split by hairlines and spacing only
 *  (no column rules), muted headers aligned with their values, values in the text colour,
 *  a sticky header (unless `sticky` is false, e.g. inside a card), rows linked to a version on hover.
 *  With `fixed`, the layout is fixed: columns take their `width`, the rest share equally. */
export function DataTable<T extends RowData>({ data, columns: cols, rowId, version, onRow, selected, initialSort = [], fixed, sticky = true, wrapRow }: {
  data: T[]; columns: Column<T>[]; rowId: (row: T) => string; version?: (row: T) => string | null;
  onRow?: (row: T) => void; selected?: string | null; initialSort?: SortingState; fixed?: boolean; sticky?: boolean;
  wrapRow?: (row: T, tr: ReactElement) => ReactElement;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const table = useTable({ features, columns: cols, data, getRowId: rowId, state: { sorting }, onSortingChange: setSorting });
  return (
    <table className={`w-full border-separate border-spacing-0 text-dense ${fixed ? "table-fixed" : ""}`}>
      <thead className={sticky ? "sticky top-0 z-10 bg-island" : undefined}>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => {
              const dir = header.column.getIsSorted();
              const numeric = right(header.column.columnDef.meta);
              return (
                <th key={header.id} onClick={header.column.getToggleSortingHandler()}
                    className={`cursor-pointer select-none whitespace-nowrap border-b border-line-strong px-2 py-1 font-normal text-fg-faint ${numeric ? "text-right" : "text-left"} ${(header.column.columnDef.meta as Meta)?.width ?? ""}`}>
                  {/* the sort arrow sits outside the label, so headers line up with their column's values */}
                  <span className="relative">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    {dir && (
                      <span className={`absolute top-0.5 text-fg-ghost ${numeric ? "right-full mr-0.5" : "left-full ml-0.5"}`}>
                        <Icon name={dir === "asc" ? "arrow-up" : "arrow-down"} size={12} />
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => {
          const id = version?.(row.original) ?? null;
          const tr = (
            <tr key={row.id} {...hoverProps(id)} onClick={() => onRow?.(row.original)} data-selected={id && id === selected ? "" : undefined}
                className={onRow ? "cursor-pointer transition-colors hover:bg-row-hover active:bg-hover" : undefined}>
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className={`h-6 whitespace-nowrap border-b border-line px-2 py-0 ${right(cell.column.columnDef.meta) ? "text-right" : ""}`}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          );
          return wrapRow ? <WrapKey key={row.id}>{wrapRow(row.original, tr)}</WrapKey> : tr;
        })}
      </tbody>
    </table>
  );
}

const WrapKey = ({ children }: { children: ReactElement }) => children;
