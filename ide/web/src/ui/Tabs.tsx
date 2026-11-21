import type { ReactNode } from "react";
import { dotClass, type DataRole } from "../theme/roles";
import { Tip } from "./Tip";

type Tab<T> = { id: T; label: ReactNode; dot?: DataRole; hint?: string; disabled?: boolean; after?: ReactNode };

// The chosen tab's fill, the selection colour, around its label and anything held beside it; a capsule held
// there takes the island's colour, so it stands out of the fill.
const FILL = "rounded-control bg-selection [&_[data-chip]]:bg-island";

/** Text tabs on the island, the open one filled with the selection colour, as a selected row is; a tab's
 *  dot says something is held there. A `disabled` tab keeps its place, greyed and doing nothing, its
 *  `hint` saying why; `after` sits beside the open tab's label, inside its fill, as a control of its own
 *  (not inside the tab). `compact` is the small segmented row of a toolbar. */
export function Tabs<T extends string | null>({ items, value, onChange, label, compact = false }: {
  items: readonly Tab<T>[]; value: T; onChange: (id: T) => void; label: string; compact?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} data-compact={compact ? "" : undefined} className={`flex min-w-0 items-center ${compact ? "gap-0.5" : "gap-1 overflow-x-auto"}`}>
      {items.map((tab) => {
        const on = tab.id === value, held = on && tab.after != null && !compact;
        const look = compact
          ? `rounded-badge px-1.5 py-0.5 text-small transition-colors hover:bg-hover ${on ? "bg-pressed text-fg" : "text-fg-faint"}`
          : `relative flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-2 transition-colors ${tab.disabled ? "cursor-default text-fg-ghost"
            : on ? `text-fg ${held ? "" : FILL}` : "text-fg-muted hover:bg-hover hover:text-fg"}`;
        const button = (
          <button key={String(tab.id)} type="button" role="tab" aria-selected={on} aria-disabled={tab.disabled || undefined} tabIndex={tab.disabled ? -1 : undefined}
                  onClick={tab.disabled ? undefined : () => onChange(tab.id)} className={look}>
            {tab.label}
            {tab.dot && <span className={`size-1.5 rounded-full ${dotClass(tab.dot)}`} />}
          </button>
        );
        const tipped = <Tip key={String(tab.id)} content={tab.hint}>{button}</Tip>;
        return held ? <span key={String(tab.id)} className={`relative flex h-7 shrink-0 items-center ${FILL}`}>{tipped}{tab.after}</span> : tipped;
      })}
    </div>
  );
}

/** Filter chips: each toggles one category on or off, with its count; an empty category has no chip.
 *  An off chip is dashed and faint, so on and off differ in form as well as shade. */
export function Chips<T extends string>({ items, on, onToggle }: {
  items: readonly { id: T; label: string; count: number }[]; on: ReadonlySet<T>; onToggle: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.filter((chip) => chip.count > 0).map((chip) => (
        <button key={chip.id} type="button" aria-pressed={on.has(chip.id)} onClick={() => onToggle(chip.id)}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-small transition-colors hover:bg-hover ${on.has(chip.id) ? "border-line-strong bg-pressed text-fg" : "border-dashed border-line-strong text-fg-faint"}`}>
          {chip.label}<span className="text-fg-faint">{chip.count}</span>
        </button>
      ))}
    </div>
  );
}

/** A small text action inside a panel: "3 new events", "Stopped 2". */
export function PillButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
            className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-popup px-2 py-0.5 text-small text-fg shadow-popup transition-colors hover:bg-hover">
      {children}
    </button>
  );
}
