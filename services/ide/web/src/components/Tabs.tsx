import type { ReactNode } from "react";
import type { DataRole } from "../theme/roles";

const DOT: Record<DataRole, string> = { recommended: "bg-recommended", meets: "bg-meets", misses: "bg-misses", fail: "bg-fail", masked: "bg-masked" };

export type Tab<T> = { id: T; label: ReactNode; dot?: DataRole; hint?: string };

/** Editor tabs as IntelliJ draws them: text tabs on the island, the open one underlined in the focus
 *  colour; a tab's dot says something is held there. `compact` is the small segmented row of a toolbar. */
export function Tabs<T extends string | null>({ items, value, onChange, label, compact = false }: {
  items: readonly Tab<T>[]; value: T; onChange: (id: T) => void; label: string; compact?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className={`flex min-w-0 items-center ${compact ? "gap-0.5" : "gap-1 overflow-x-auto"}`}>
      {items.map((tab) => {
        const on = tab.id === value;
        return (
          <button key={String(tab.id)} type="button" role="tab" aria-selected={on} title={tab.hint} onClick={() => onChange(tab.id)}
                  className={compact
                    ? `rounded-badge px-1.5 py-0.5 text-small transition-colors hover:bg-hover ${on ? "bg-pressed text-fg" : "text-fg-faint"}`
                    : `relative flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-2 transition-colors hover:bg-hover ${on ? "text-fg after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-focus" : "text-fg-muted"}`}>
            {tab.label}
            {tab.dot && <span className={`size-1.5 rounded-full ${DOT[tab.dot]}`} />}
          </button>
        );
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
