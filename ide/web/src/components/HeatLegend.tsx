import { fillRole, ranges, type Step } from "../model/heat";
import type { Color } from "../model/market";
import { v } from "../theme/roles";
import { Tip } from "./Tip";

const STEPS: readonly Step[] = [-3, -2, -1, 0, 1, 2, 3];

/** The heatmap's seven swatches, each naming its range in a tooltip; the hover area is taller than the bar. */
export function HeatLegend({ color }: { color: Color }) {
  const names = ranges(color);
  return (
    <div aria-label="Colour scale" className="flex w-56 shrink-0 gap-px">
      {STEPS.map((k, i) => (
        <Tip key={k} content={names[i]}>
          <span aria-label={names[i]} className="group flex-1 py-1.5">
            <span className="block h-2 group-first:rounded-l-full group-last:rounded-r-full" style={{ background: v(fillRole(k)) }} />
          </span>
        </Tip>
      ))}
    </div>
  );
}
