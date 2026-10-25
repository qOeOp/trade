import NumberFlow from "@number-flow/react";
import type { ComponentProps, ReactNode } from "react";
import { Missing } from "../../components/Missing";

type Format = ComponentProps<typeof NumberFlow>["format"];
export type RunMetric = { label: string; value?: number | null; format?: Format; suffix?: string; text?: ReactNode; warn?: boolean };

const TWO: Format = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
export const MONEY = TWO, SIGNED: Format = { ...TWO, signDisplay: "exceptZero" };
export const PERCENT: Format = { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 };

/** The selected run's readings as one row of equal cells, each a small label over its value (so a label
 *  never drifts from its number); a cell is never narrower than its readings, so a narrow editor wraps
 *  the cells (and the whole row under the run cards) instead of cutting them. A cell that warns
 *  (data late) takes the warning colour. Numbers animate as they change. */
export function RunMetrics({ items }: { items: readonly RunMetric[] }) {
  return (
    <div className="grid min-w-[min(100%,30rem)] flex-1 grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-x-4 gap-y-1.5">
      {items.map((m) => (
        <div key={m.label} className="min-w-0 leading-tight">
          <div className="truncate text-small text-fg-faint">{m.label}</div>
          <div className={`truncate font-mono text-dense tabular-nums ${m.warn ? "text-misses" : "text-fg"}`}>
            {m.text ?? (m.value == null ? <Missing /> : <NumberFlow value={m.value} format={m.format} locales="en-US" suffix={m.suffix} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
