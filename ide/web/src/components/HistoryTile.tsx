import type { ReactNode } from "react";
import { fillRole, inkRoles, type Step } from "../model/heat";
import { v } from "../theme/roles";

// A veto year the development period cuts short: the part it took is hatched.
const HATCH = "repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in oklab, currentColor 22%, transparent) 4px 5px)";

/** One History heatmap tile: `step` the annual return's colour (null: the grey middle), `quiet` muted text for a
 *  segment with nothing to read, `short` greyed (too short to count), `meets` a thick border, `partial` hatched. */
export function HistoryTile({ step, quiet, short, meets, partial, children }: {
  step: Step | null; quiet: boolean; short: boolean; meets: boolean; partial: boolean; children: ReactNode;
}) {
  const [ink] = inkRoles(step);
  return (
    <div className={`grid h-7 min-w-[4.75rem] place-items-center rounded-xs px-1.5 text-center tabular-nums ${meets ? "ring-2 ring-fg ring-inset" : ""} ${quiet ? "italic" : ""}`}
         style={{ background: short ? v("heat-0") : v(fillRole(step)), color: quiet ? v("fg-muted") : v(ink),
                  backgroundImage: partial ? HATCH : undefined, opacity: short ? 0.6 : 1 }}>
      {children}
    </div>
  );
}
