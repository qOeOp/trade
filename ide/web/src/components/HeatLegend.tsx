import { fillRole, legend, type Step } from "../model/heat";
import type { Color } from "../model/market";
import { v } from "../theme/roles";

const STEPS: readonly Step[] = [-3, -2, -1, 0, 1, 2, 3];

/** The heatmap's seven swatches, each edge labelled underneath (percent for either metric). */
export function HeatLegend({ color }: { color: Color }) {
  return (
    <div aria-label="Colour scale" className="relative w-56 shrink-0 pb-3.5">
      <div className="flex h-2 gap-px overflow-hidden rounded-full">
        {STEPS.map((k) => <span key={k} className="flex-1" style={{ background: v(fillRole(k)) }} />)}
      </div>
      {legend(color).map(({ label, at }) => (
        <span key={label} className="absolute top-2.5 -translate-x-1/2 text-small text-fg-faint tabular-nums" style={{ left: `${(at / 7) * 100}%` }}>{label}</span>
      ))}
    </div>
  );
}
