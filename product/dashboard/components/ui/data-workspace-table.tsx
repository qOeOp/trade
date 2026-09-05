"use client";

import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  type ColumnDef,
  type RowData,
  useTable,
} from "@tanstack/react-table";
import {
  isValidElement,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useMemo,
} from "react";

import { Button } from "./button";
import { InterfaceIcons } from "./iconography";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

const workspaceTableFeatures = tableFeatures({
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  filterFns: {
    includesString: filterFn_includesString,
  },
});

type WorkspaceFeatures = typeof workspaceTableFeatures;

export type DataWorkspaceColumn<T extends RowData> = {
  id: string | number;
  name: ReactNode;
  selector?: (row: T, rowIndex?: number) => unknown;
  cell?: (row: T, rowIndex: number, column: DataWorkspaceColumn<T>, id: string | number) => ReactNode;
  sortable?: boolean;
  sortFunction?: (left: T, right: T) => number;
  filterable?: boolean;
  filterFunction?: (row: T, value: unknown) => boolean;
  width?: string;
  minWidth?: string;
  grow?: number;
  ignoreRowClick?: boolean;
};

export type DataWorkspaceConditionalStyle<T extends RowData> = {
  when: (row: T) => boolean;
  style?: CSSProperties;
};

export type DataWorkspaceColumnFilter = {
  id: string | number;
  value: unknown;
};

export function dataWorkspaceSelectedRowStyles<T extends RowData>(
  isSelected: (row: T) => boolean,
): DataWorkspaceConditionalStyle<T>[] {
  return [{ when: isSelected }];
}

type DataWorkspaceTableProps<T extends RowData> = {
  ariaLabel: string;
  className?: string;
  columnFilters?: readonly DataWorkspaceColumnFilter[];
  columns: DataWorkspaceColumn<T>[];
  conditionalRowStyles?: DataWorkspaceConditionalStyle<T>[];
  data: readonly T[];
  defaultSortAsc?: boolean;
  defaultSortFieldId?: string | number;
  dense?: boolean;
  keyField?: keyof T | string;
  noDataComponent?: ReactNode;
  onRowClicked?: (row: T, event: ReactMouseEvent<HTMLTableRowElement>) => void;
  pagination?: boolean;
  paginationPerPage?: number;
  paginationResetKey?: string;
  paginationRowsPerPageOptions?: number[];
  pointerOnHover?: boolean;
  viewportRef?: Ref<HTMLDivElement>;
};

function renderUnknown(value: unknown): ReactNode {
  if (value == null || typeof value === "boolean") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (isValidElement(value)) return value;
  return String(value);
}

function columnCellStyle<T extends RowData>(column: DataWorkspaceColumn<T>): CSSProperties {
  return {
    minWidth: column.minWidth,
    width: column.width,
  };
}

function minimumTableWidth<T extends RowData>(columns: DataWorkspaceColumn<T>[]): string | undefined {
  const widths = columns.map((column) => Number.parseFloat(column.minWidth ?? column.width ?? ""));
  return widths.every(Number.isFinite) ? `${widths.reduce((sum, value) => sum + value, 0)}px` : undefined;
}

export function DataWorkspaceTable<T extends RowData>({
  ariaLabel,
  className = "",
  columnFilters,
  columns,
  conditionalRowStyles = [],
  data,
  defaultSortAsc = true,
  defaultSortFieldId,
  dense = false,
  keyField,
  noDataComponent,
  onRowClicked,
  pagination = false,
  paginationPerPage = 20,
  paginationResetKey,
  paginationRowsPerPageOptions = [10, 20, 50],
  pointerOnHover = false,
  viewportRef,
}: DataWorkspaceTableProps<T>) {
  const projectColumnsById = useMemo(
    () => new Map(columns.map((column) => [String(column.id), column])),
    [columns],
  );
  const tableColumns = useMemo<ColumnDef<WorkspaceFeatures, T, unknown>[]>(
    () => columns.map((column) => ({
      id: String(column.id),
      accessorFn: (row, index) => column.selector?.(row, index),
      header: () => column.name,
      cell: ({ row }) => column.cell
        ? column.cell(row.original, row.index, column, column.id)
        : renderUnknown(column.selector?.(row.original, row.index)),
      enableColumnFilter: Boolean(column.filterable && column.selector),
      filterFn: column.filterFunction
        ? (row, _columnId, value) => column.filterFunction?.(row.original, value) ?? true
        : "includesString",
      enableSorting: Boolean(column.sortable && column.selector),
      sortFn: column.sortFunction
        ? (left, right) => column.sortFunction?.(left.original, right.original) ?? 0
        : "auto",
    })),
    [columns],
  );
  const controlledColumnFilters = useMemo(
    () => columnFilters?.map((filter) => ({ id: String(filter.id), value: filter.value })),
    [columnFilters],
  );
  const initialSorting = defaultSortFieldId === undefined
    ? []
    : [{ id: String(defaultSortFieldId), desc: !defaultSortAsc }];
  const table = useTable({
    features: workspaceTableFeatures,
    columns: tableColumns,
    data,
    getRowId: keyField
      ? (row, index) => String((row as Record<string, unknown>)[String(keyField)] ?? index)
      : undefined,
    initialState: {
      pagination: { pageIndex: 0, pageSize: pagination ? paginationPerPage : Number.POSITIVE_INFINITY },
      sorting: initialSorting,
    },
    state: controlledColumnFilters === undefined
      ? undefined
      : { columnFilters: controlledColumnFilters },
  });

  useEffect(() => {
    if (paginationResetKey !== undefined) table.firstPage();
  }, [paginationResetKey, table]);

  const rows = table.getRowModel().rows;
  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const pageSizeOptions = Array.from(new Set([...paginationRowsPerPageOptions, paginationPerPage])).sort((a, b) => a - b);
  const interactive = Boolean(onRowClicked || pointerOnHover);
  const tableMinWidth = minimumTableWidth(columns);

  return (
    <div
      ref={viewportRef}
      className={["data-workspace-table", className].filter(Boolean).join(" ")}
      data-density={dense ? "compact" : "default"}
      data-interactive={interactive || undefined}
    >
      <div className="data-workspace-viewport">
        <Table aria-label={ariaLabel} style={{ minWidth: tableMinWidth }}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const projectColumn = projectColumnsById.get(header.column.id);
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                      style={projectColumn ? columnCellStyle(projectColumn) : undefined}
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="data-workspace-sort"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {sorted === "asc" ? <InterfaceIcons.sortAscending aria-hidden="true" /> : null}
                          {sorted === "desc" ? <InterfaceIcons.sortDescending aria-hidden="true" /> : null}
                        </button>
                      ) : <table.FlexRender header={header} />}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const selected = conditionalRowStyles.some((rule) => rule.when(row.original));
              return (
                <TableRow
                  key={row.id}
                  data-selected={selected || undefined}
                  data-interactive={interactive || undefined}
                  aria-selected={conditionalRowStyles.length ? selected : undefined}
                  tabIndex={onRowClicked ? 0 : undefined}
                  onClick={onRowClicked ? (event) => {
                    if ((event.target as HTMLElement).closest("a,button,input,select,textarea,[data-table-stop-row-click]")) return;
                    onRowClicked(row.original, event);
                  } : undefined}
                  onKeyDown={onRowClicked ? (event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onRowClicked(row.original, event as unknown as ReactMouseEvent<HTMLTableRowElement>);
                  } : undefined}
                >
                  {row.getAllCells().map((cell) => {
                    const projectColumn = projectColumnsById.get(cell.column.id);
                    return (
                      <TableCell
                        key={cell.id}
                        data-table-stop-row-click={projectColumn?.ignoreRowClick || undefined}
                        style={projectColumn ? columnCellStyle(projectColumn) : undefined}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!rows.length ? noDataComponent ?? <div className="data-workspace-empty">No data</div> : null}
      </div>
      {pagination && filteredRowCount > 0 ? (
        <div className="data-workspace-pagination" aria-label={`${ariaLabel} pagination`}>
          <label>
            <span>Rows</span>
            <select value={table.state.pagination.pageSize} onChange={(event) => table.setPageSize(Number(event.target.value))}>
              {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <span>{table.state.pagination.pageIndex * table.state.pagination.pageSize + 1}-{Math.min((table.state.pagination.pageIndex + 1) * table.state.pagination.pageSize, filteredRowCount)} of {filteredRowCount}</span>
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
            <InterfaceIcons.previous aria-hidden="true" />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
            <InterfaceIcons.next aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
