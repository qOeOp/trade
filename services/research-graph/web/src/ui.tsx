import { useState, type ReactElement, type ReactNode } from "react";
import { Collapsible, Tooltip } from "radix-ui";
import { ChevronRight } from "lucide-react";
import {
  createColumnHelper, createSortedRowModel, flexRender, rowSortingFeature, sortFn_alphanumeric, sortFn_basic, tableFeatures,
  useTable, type ColumnDef, type RowData, type SortingState,
} from "@tanstack/react-table";
import type { Role } from "./types";
import { ROLE } from "./format";
import { hoverProps } from "./store";

// Shared building blocks: tooltip, role mark, collapsible section, key-value grid and a dense table.

/** A tooltip on any element: 500ms before the first, instant for its neighbours (Provider in App). */
export function Tip({ content, children, side = "top" }: { content: ReactNode; children: ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  if (content == null || content === "") return children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} collisionPadding={8} className="float tip z-50">{content}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** A version's role by shape: filled = recommended, ring = kept reference, small grey = superseded,
 *  struck ring = masked, dashed ring = unrun, cross = failed review. */
export function RoleMark({ role, size = 14 }: { role: Role | null | undefined; size?: number }) {
  const c = size / 2;
  const shape = (() => {
    switch (role) {
      case "recommended": return <>
        <circle cx={c} cy={c} r={c - 1} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        <circle cx={c} cy={c} r={c - 4} fill="var(--accent)" />
      </>;
      case "kept_reference": return <circle cx={c} cy={c} r={c - 3} fill="var(--raised)" stroke="var(--ink-1)" strokeWidth={1.75} />;
      case "masked": return <>
        <circle cx={c} cy={c} r={c - 3} fill="none" stroke="var(--ink-3)" strokeWidth={1.25} />
        <line x1={3} y1={size - 3} x2={size - 3} y2={3} stroke="var(--ink-3)" strokeWidth={1.25} />
      </>;
      case "precheck_failed": return <path d={`M4 4 L${size - 4} ${size - 4} M${size - 4} 4 L4 ${size - 4}`} stroke="var(--fail)" strokeWidth={1.75} strokeLinecap="round" />;
      case "unrun": return <circle cx={c} cy={c} r={c - 3} fill="none" stroke="var(--ink-3)" strokeWidth={1.25} strokeDasharray="2 2" />;
      default: return <circle cx={c} cy={c} r={c - 4.5} fill="var(--ink-3)" />;
    }
  })();
  return <svg width={size} height={size} className="shrink-0" aria-label={role ? ROLE[role].label : undefined}>{shape}</svg>;
}

/** A section of the inspector, open by default: its title on the content's left edge, the chevron at the right. */
export function Section({ title, aside, children, open: initial = true }: {
  title: string; aside?: ReactNode; children: ReactNode; open?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-b" style={{ borderColor: "var(--rule)" }}>
      <Collapsible.Trigger className="press flex w-full items-center gap-2 !rounded-none px-3 py-1.5 text-left">
        <span className="label">{title}</span>
        {aside != null && <span className="ml-auto text-[11px] faint">{aside}</span>}
        <ChevronRight size={12} className={`faint transition-transform duration-150 ${aside == null ? "ml-auto" : ""}`}
                      style={{ transform: open ? "rotate(90deg)" : undefined }} />
      </Collapsible.Trigger>
      <Collapsible.Content className="px-3 pb-2.5 pt-0.5">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

/** Label/value pairs in two aligned columns. */
export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-[12px]">
      {items.map(([k, v]) => <div key={k} className="contents"><dt className="faint">{k}</dt><dd className="min-w-0">{v ?? "-"}</dd></div>)}
    </dl>
  );
}

const features = tableFeatures({
  rowSortingFeature, sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});
export type Column<T extends RowData> = ColumnDef<typeof features, T, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any
export const columns = <T extends RowData>() => createColumnHelper<typeof features, T>();

/** A dense, sortable table: sticky header, tabular numbers, rows that link to a version on hover. */
/** Column meta: `numeric` and `align: "right"` right-align a column (header included). One font,
 *  size and weight throughout; headers are muted and values carry the ink. With `fixed`, columns
 *  share the width equally. */
type Meta = { numeric?: boolean; align?: "right" } | undefined;
const right = (meta: unknown) => !!((meta as Meta)?.numeric || (meta as Meta)?.align === "right");

export function DataTable<T extends RowData>({ data, columns: cols, rowId, version, onRow, selected, initialSort = [], fixed }: {
  data: T[]; columns: Column<T>[]; rowId: (row: T) => string; version?: (row: T) => string | null;
  onRow?: (row: T) => void; selected?: string | null; initialSort?: SortingState; fixed?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const table = useTable({ features, columns: cols, data, getRowId: rowId, state: { sorting }, onSortingChange: setSorting });
  return (
    <table className={`w-full border-separate border-spacing-0 text-[12px] ${fixed ? "table-fixed" : ""}`}>
      <thead className="sticky top-0 z-10" style={{ background: "var(--panel)" }}>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => {
              const dir = header.column.getIsSorted();
              const numeric = right(header.column.columnDef.meta);
              return (
                <th key={header.id} onClick={header.column.getToggleSortingHandler()}
                    className={`cursor-pointer select-none whitespace-nowrap border-b px-2 py-1 font-normal faint ${numeric ? "text-right" : "text-left"}`}
                    style={{ borderColor: "var(--rule-2)" }}>
                  {/* the sort arrow sits outside the label, so headers line up with their column's values */}
                  <span className="relative">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    {dir && <span className={`absolute top-0 ghost ${numeric ? "right-full mr-0.5" : "left-full ml-0.5"}`}>{dir === "asc" ? "↑" : "↓"}</span>}
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
          return (
            <tr key={row.id} {...hoverProps(id)} onClick={() => onRow?.(row.original)}
                className={onRow ? "cursor-pointer transition-colors duration-100 hover:bg-[var(--hover)]" : undefined}
                style={id && id === selected ? { background: "var(--accent-wash)" } : undefined}>
              {row.getAllCells().map((cell) => {
                return (
                  <td key={cell.id} className={`whitespace-nowrap border-b px-2 py-1 ${right(cell.column.columnDef.meta) ? "text-right" : ""}`}
                      style={{ borderColor: "var(--rule)" }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
