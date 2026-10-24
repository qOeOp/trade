import NumberFlow from "@number-flow/react";
import type { ComponentProps } from "react";
import { v, type ColorRole } from "../theme/roles";
import { Missing } from "./Missing";

type Format = ComponentProps<typeof NumberFlow>["format"];
export type Metric = { label: string; value: number | null | undefined; format: Format; tone?: ColorRole };

/** Readings in one row of cells sized by their content and divided by rules: label at the left in
 *  the muted colour, the number right-aligned and highlighted, at least 10px apart; one size and weight.
 *  In a wide region the cells stop growing, so a label stays near its number. */
export function MetricStrip({ items }: { items: readonly Metric[] }) {
  return (
    <div className="flex divide-x divide-line-strong border-t border-line-strong text-dense">
      {items.map((m) => (
        <div key={m.label} className="flex max-w-56 flex-auto items-baseline justify-between gap-2.5 whitespace-nowrap px-2.5 py-1.5 first:pl-0 last:pr-0">
          <span className="text-fg-faint">{m.label}</span>
          <span style={{ color: v(m.tone ?? "fg") }}>{m.value == null ? <Missing /> : <NumberFlow value={m.value} format={m.format} />}</span>
        </div>
      ))}
    </div>
  );
}
