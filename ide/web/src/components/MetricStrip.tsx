import NumberFlow from "@number-flow/react";
import type { ComponentProps } from "react";
import { v, type ColorRole } from "../theme/roles";
import { Missing } from "./Missing";
import { Tip } from "./Tip";

type Format = ComponentProps<typeof NumberFlow>["format"];
/** `note` stands in the place of a value there is none of, saying why; on a line of its own when the cell is too narrow.
 *  `tip` says over the label what the reading is measured on. */
export type Metric = { label: string; value: number | null | undefined; format: Format; tone?: ColorRole; note?: string; tip?: string };

/** Readings in cells divided by rules: label at the left in the muted colour, the number right-aligned
 *  and highlighted, at least 10px apart; one size and weight. Four cells in a row where the region (an
 *  `@container`) is wide, two by two narrower, one per row narrowest, never three and one; cells stop
 *  growing at 14rem, so a label stays near its number. Every cell has the rule on its left; the strip is
 *  pulled out by a cell's padding and the rule and clipped, so each row's first cell starts at the edge. */
export function MetricStrip({ items }: { items: readonly Metric[] }) {
  return (
    <div className="overflow-hidden border-t border-line-strong text-dense">
      <div className="-mr-2.5 ml-[calc(-0.625rem-1px)] grid grid-cols-[minmax(0,14rem)] @2xs:grid-cols-[repeat(2,minmax(0,14rem))] @xl:grid-cols-[repeat(4,minmax(0,14rem))]">
      {items.map((m) => (
        <div key={m.label} className="flex flex-wrap items-baseline justify-between gap-x-2.5 whitespace-nowrap border-l border-line-strong px-2.5 py-1.5">
          <Tip content={m.tip}><span className="shrink-0 text-fg-faint">{m.label}</span></Tip>
          <span className="ml-auto" style={{ color: v(m.tone ?? "fg") }}>{m.value == null ? (m.note ? <span className="text-small text-fg-faint">{m.note}</span> : <Missing />) : <NumberFlow value={m.value} format={m.format} locales="en-US" />}</span>
        </div>
      ))}
      </div>
    </div>
  );
}
