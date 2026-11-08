import type { ReactNode } from "react";
import type { DataRole } from "../theme/roles";
import { Tip } from "./Tip";

const DOT: Record<DataRole, string> = { recommended: "bg-recommended", meets: "bg-meets", misses: "bg-misses", fail: "bg-fail", masked: "bg-masked" };

export type Tab<T> = { id: T; label: ReactNode; dot?: DataRole; hint?: string; disabled?: boolean; after?: ReactNode };

// The chosen tab's underline, in the focus colour, under its label and anything held beside it.
const UNDER = "after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-focus";

/** Editor tabs as IntelliJ draws them: text tabs on the island, the open one underlined in the focus
 *  colour; a tab's dot says something is held there. A `disabled` tab keeps its place, greyed and doing
 *  nothing, its `hint` saying why; `after` sits beside the open tab's label, above its underline, as a
 *  control of its own (not inside the tab). `compact` is the small segmented row of a toolbar. */
export function Tabs<T extends string | null>({ items, value, onChange, label, compact = false }: {
  items: readonly Tab<T>[]; value: T; onChange: (id: T) => void; label: string; compact?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} data-compact={compact ? "" : undefined} className={`flex min-w-0 items-center ${compact ? "gap-0.5" : "gap-1 overflow-x-auto"}`}>
      {items.map((tab) => {
        const on = tab.id === value, held = on && tab.after != null && !compact;
        const look = compact
          ? `rounded-badge px-1.5 py-0.5 text-small transition-colors hover:bg-hover ${on ? "bg-pressed text-fg" : "text-fg-faint"}`
          : `relative flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-2 transition-colors ${tab.disabled ? "cursor-default text-fg-ghost"
            : `hover:bg-hover ${on ? `text-fg ${held ? "" : UNDER}` : "text-fg-muted"}`}`;
        const button = (
          <button key={String(tab.id)} type="button" role="tab" aria-selected={on} aria-disabled={tab.disabled || undefined} tabIndex={tab.disabled ? -1 : undefined}
                  onClick={tab.disabled ? undefined : () => onChange(tab.id)} className={look}>
            {tab.label}
            {tab.dot && <span className={`size-1.5 rounded-full ${DOT[tab.dot]}`} />}
          </button>
        );
        const tipped = <Tip key={String(tab.id)} content={tab.hint}>{button}</Tip>;
        return held ? <span key={String(tab.id)} className={`relative flex h-8 shrink-0 items-center ${UNDER}`}>{tipped}{tab.after}</span> : tipped;
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
            className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-popup px-2.5 py-0.5 text-small text-fg shadow-popup transition-colors hover:bg-hover">
      {children}
    </button>
  );
}
