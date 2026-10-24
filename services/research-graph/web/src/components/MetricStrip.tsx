import NumberFlow from "@number-flow/react";
import type { ComponentProps } from "react";
import { v, type ColorRole } from "../theme/roles";
import { Missing } from "./Missing";

type Format = ComponentProps<typeof NumberFlow>["format"];
export type Metric = { label: string; value: number | null | undefined; format: Format; tone?: ColorRole };

/** Readings in one row of cells sized by their content and divided by rules: label at the left in
 *  the muted colour, the number right-aligned and highlighted, at least 10px apart; one size and weight. */
export function MetricStrip({ items }: { items: readonly Metric[] }) {
  return (
    <div className="flex divide-x divide-line border-b border-line text-dense">
      {items.map((m) => (
        <div key={m.label} className="flex flex-auto items-baseline justify-between gap-2.5 whitespace-nowrap px-2.5 py-1.5 first:pl-3 last:pr-3">
          <span className="text-fg-faint">{m.label}</span>
          <span style={{ color: v(m.tone ?? "fg") }}>{m.value == null ? <Missing /> : <NumberFlow value={m.value} format={m.format} />}</span>
        </div>
      ))}
    </div>
  );
}
