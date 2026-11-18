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
