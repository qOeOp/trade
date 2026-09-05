import * as React from "react";

import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.ComponentProps<"table">>(
  ({ className, ...props }, ref) => (
    <table ref={ref} data-slot="table" className={cn("workspace-table", className)} {...props} />
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<"thead">>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} data-slot="table-header" className={cn("workspace-table-header", className)} {...props} />
  ),
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<"tbody">>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} data-slot="table-body" className={cn("workspace-table-body", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<"tfoot">>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} data-slot="table-footer" className={cn("workspace-table-footer", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.ComponentProps<"tr">>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} data-slot="table-row" className={cn("workspace-table-row", className)} {...props} />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ComponentProps<"th">>(
  ({ className, ...props }, ref) => (
    <th ref={ref} data-slot="table-head" className={cn("workspace-table-head", className)} {...props} />
  ),
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.ComponentProps<"td">>(
  ({ className, ...props }, ref) => (
    <td ref={ref} data-slot="table-cell" className={cn("workspace-table-cell", className)} {...props} />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.ComponentProps<"caption">>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} data-slot="table-caption" className={cn("workspace-table-caption", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
