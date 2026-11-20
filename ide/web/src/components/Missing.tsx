import { MISSING } from "../lib/format";

/** A value that is not there: a plain hyphen, fainter than the values around it. */
export const Missing = () => <span className="text-fg-ghost">{MISSING}</span>;

/** A value being read: a pulsing bar on the baseline, the height of a row's digits. */
export const Skeleton = ({ className = "w-8" }: { className?: string }) => (
  <span aria-hidden="true" className={`skeleton inline-block h-2 rounded-badge ${className}`} />
);

/** A prose block being read: three pulsing lines of descending width. */
export const SkeletonLines = () => (
  <div aria-hidden="true" className="space-y-2 py-1">
    <div className="skeleton h-2 w-full rounded-badge" />
    <div className="skeleton h-2 w-11/12 rounded-badge" />
    <div className="skeleton h-2 w-3/4 rounded-badge" />
  </div>
);

const CHART_BARS = [42, 46, 44, 51, 48, 55, 52, 60, 58, 64, 61, 68, 65, 62, 70, 67, 74, 71, 78, 75, 82, 79, 85, 83];

/** A chart canvas being read: legend placeholders, price grid with right-axis ticks, pulsing series and time axis. */
export const ChartSkeleton = ({ note }: { note?: string | null }) => (
  <div role="status" aria-label={note ?? "Loading chart"} className="flex h-full min-h-0 flex-col justify-between py-2 pr-2">
    <div className="flex flex-wrap items-center gap-3 pb-2 text-small">
      <Skeleton className="w-16" /><Skeleton className="w-24" /><Skeleton className="w-20" /><Skeleton className="w-16" />
      {note && <span className="ml-auto truncate text-fg-faint">{note}</span>}
    </div>
    <div aria-hidden="true" className="relative flex min-h-0 flex-1 flex-col justify-between border-b border-line">
      {[0, 1, 2, 3].map((r) => (
        <div key={r} className="flex items-center justify-end border-t border-grid py-2 first:border-0">
          <Skeleton className="w-12" />
        </div>
      ))}
      <div className="pointer-events-none absolute inset-x-0 inset-y-4 right-16 flex items-end gap-1.5">
        {CHART_BARS.map((h, i) => (
          <span key={i} className="skeleton min-w-0 flex-1 rounded-t-badge opacity-45" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
    <div aria-hidden="true" className="flex justify-between pt-2 pr-6">
      {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="w-10" />)}
    </div>
  </div>
);

/** A table being read: `cols` columns of pulsing bars under an empty header rule, no header text (the table's own
 *  columns name themselves once it is read). */
export const TableSkeleton = ({ cols = 6, rows = 5 }: { cols?: number; rows?: number }) => (
  <table aria-hidden="true" className="w-full border-collapse text-dense">
    <tbody>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-b border-line last:border-0 first:border-t first:border-t-line-strong">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="h-(--form-h) px-3"><Skeleton className={c === 0 ? "w-16" : "w-12"} /></td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);
