import type { ReactNode } from "react";
import { fillRole, inkRoles, type Step } from "../model/heat";
import { Icon } from "../icons/Icon";
import { v } from "../theme/roles";

// A veto year the development period cuts short: the part it took is hatched.
const HATCH = "repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in oklab, currentColor 22%, transparent) 4px 5px)";

/** One History heatmap tile: `step` the annual return's colour (null: the grey middle), `quiet` muted text for a
 *  segment with nothing to read, `short` greyed (too short to count), `meets` a small filled star in the corner, in the bright yellow the scatter marks its selected run with (no border: the colour is the annual return and a ring on top of it read as noise), `partial` hatched. */
export function HistoryTile({ step, quiet, short, meets, partial, children }: {
  step: Step | null; quiet: boolean; short: boolean; meets: boolean; partial: boolean; children: ReactNode;
}) {
  const [ink] = inkRoles(step);
  return (
    <div className={`relative grid h-7 min-w-[4.75rem] place-items-center rounded-xs px-1.5 text-center tabular-nums ${quiet ? "italic" : ""}`}
         style={{ background: short ? v("heat-0") : v(fillRole(step)), color: quiet ? v("fg-muted") : v(ink),
                  backgroundImage: partial ? HATCH : undefined, opacity: short ? 0.6 : 1 }}>
      {children}
      {meets && <span aria-label="Meets both targets" className="absolute right-[3px] top-[3px] grid"><Icon name="star" size={12} tone="selected-mark" className="size-[9px] fill-current" /></span>}
    </div>
  );
}
