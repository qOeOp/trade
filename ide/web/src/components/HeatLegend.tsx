import { fillRole, ranges, type Step } from "../model/heat";
import type { Color } from "../model/market";
import { v } from "../theme/roles";
import { Tip } from "./Tip";

const STEPS: readonly Step[] = [-3, -2, -1, 0, 1, 2, 3];

/** The heatmap's seven swatches, each naming its range in a tooltip below it on hover or focus. Each hover
 *  area reaches its neighbour's, so moving along the bar keeps one tooltip open. */
export function HeatLegend({ color }: { color: Color }) {
  const names = ranges(color);
  return (
    <div aria-label="Colour scale" className="flex w-56 shrink-0">
      {STEPS.map((k, i) => (
        <Tip key={k} content={names[i]} side="bottom">
          <span role="img" tabIndex={0} aria-label={names[i]} className="group flex-1 pt-1.5 pb-0.5 pr-px last:pr-0">
            <span className="block h-2 group-first:rounded-l-full group-last:rounded-r-full" style={{ background: v(fillRole(k)) }} />
          </span>
        </Tip>
      ))}
    </div>
  );
}
