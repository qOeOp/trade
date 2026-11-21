import type { ReactNode } from "react";
import { fillRole, inkRoles, type Step } from "../model/heat";
import { Icon } from "../icons/Icon";
import { v } from "../theme/roles";

// A veto year the development period cuts short: the part it took is hatched.
const HATCH = "repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in oklab, currentColor 22%, transparent) 4px 5px)";

/** One History heatmap tile: `step` the annual return's colour (null: the grey middle), `quiet` muted text for a
 *  segment with nothing to read, `short` greyed (too short to count), `meets` a small filled star in the corner, in the bright yellow the scatter marks its selected run with (no border: the colour is the annual return and a ring on top of it read as noise), `partial` hatched. With `onPick` it is a button (`label` its name) that shows its run, ringed in the focus blue
 *  while `picked`. */
export function HistoryTile({ step, quiet, short, meets, partial, children, onPick, picked = false, label }: {
  step: Step | null; quiet: boolean; short: boolean; meets: boolean; partial: boolean; children: ReactNode;
  onPick?: () => void; picked?: boolean; label?: string;
}) {
  const tile = <Tile step={step} quiet={quiet} short={short} meets={meets} partial={partial}>{children}</Tile>;
  if (!onPick) return <div>{tile}</div>;
  return (
    <button type="button" aria-pressed={picked} aria-label={label} onClick={onPick}
            className={`block w-full cursor-pointer rounded-xs ${picked ? "outline-2 outline-offset-1 outline-focus" : ""}`}>{tile}</button>
  );
}

function Tile({ step, quiet, short, meets, partial, children }: { step: Step | null; quiet: boolean; short: boolean; meets: boolean; partial: boolean; children: ReactNode }) {
  const [ink] = inkRoles(step);
  return (
    <div className={`relative grid h-7 min-w-[4.75rem] place-items-center whitespace-nowrap rounded-xs px-1.5 text-center tabular-nums ${quiet ? "italic" : ""}`}
         style={{ background: short ? v("heat-0") : v(fillRole(step)), color: quiet ? v("fg-muted") : v(ink),
                  backgroundImage: partial ? HATCH : undefined, opacity: short ? 0.6 : 1 }}>
      {children}
      {meets && <span aria-label="Meets both targets" className="absolute right-[3px] top-[3px] grid"><Icon name="star" size={12} tone="selected-mark" className="size-[9px] fill-current" /></span>}
    </div>
  );
}
