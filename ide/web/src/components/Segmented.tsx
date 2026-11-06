import type { ReactNode } from "react";
import { Tip } from "./Tip";

/** A segment: `disabled` keeps its place, greyed and doing nothing, with `hint` saying why; `after` sits
 *  inside the segment beside its label while it is chosen, as a control of its own (not inside its radio). */
export type Segment<T> = { id: T; label: ReactNode; disabled?: boolean; hint?: string; after?: ReactNode };

/** A segmented control, as macOS and trading dashboards switch a view: the options sit in a recessed
 *  track on the frame colour, the chosen one raised onto the island with a hairline. `fill` fits it to
 *  a form: as wide, as tall and as round as the fields around it. */
export function Segmented<T extends string>({ items, value, onChange, label, fill = false }: {
  items: readonly Segment<T>[]; value: T; onChange: (id: T) => void; label: string; fill?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`items-center gap-0.5 bg-frame p-0.5 ${fill ? "flex w-full rounded-control" : "inline-flex shrink-0 rounded-popup"}`}>
      {items.map((item) => {
        const on = item.id === value;
        const radio = (shape: string, look: string) => (
          <button type="button" role="radio" aria-checked={on} aria-disabled={item.disabled || undefined} tabIndex={item.disabled ? -1 : undefined} onClick={item.disabled ? undefined : () => onChange(item.id)}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${shape} ${look}`}>
            {item.label}
          </button>
        );
        if (on && item.after) return (
          <span key={item.id} className="inline-flex items-center rounded-card bg-island text-dense text-fg shadow-raised ring-1 ring-line">
            {radio("h-7 rounded-card pl-3 pr-2", "")}{item.after}
          </span>
        );
        const look = item.disabled ? "cursor-default text-fg-ghost" : on ? `bg-island text-fg shadow-raised ring-1 ${fill ? "ring-line-strong" : "ring-line"}` : "text-fg-muted hover:text-fg";
        return <Tip key={item.id} content={item.disabled ? item.hint : null}>{radio(fill ? "h-6 min-w-0 grow justify-center rounded-badge px-2" : "h-7 rounded-card px-3 text-dense", look)}</Tip>;
      })}
    </div>
  );
}
