import type { ReactNode } from "react";
import { Tip } from "./Tip";

export type Segment<T> = { id: T; label: ReactNode; hint?: string; disabled?: boolean };

/** A segmented control, as macOS and trading dashboards switch a card's view: the options sit in a
 *  recessed track on the frame colour, the chosen one raised onto the island with a hairline. `quiet`
 *  is the lighter row of a card's secondary choice (a chart's period): no track, the chosen one
 *  pressed. A disabled option says why in its hint. */
export function Segmented<T extends string>({ items, value, onChange, label, quiet = false }: {
  items: readonly Segment<T>[]; value: T; onChange: (id: T) => void; label: string; quiet?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className={`inline-flex shrink-0 items-center gap-0.5 ${quiet ? "" : "rounded-popup bg-frame p-0.5"}`}>
      {items.map((item) => {
        const on = item.id === value;
        const look = quiet
          ? `h-6.5 min-w-8 justify-center rounded-control px-1.5 text-dense ${on ? "bg-pressed text-fg" : "text-fg-faint hover:bg-hover hover:text-fg-muted"} disabled:text-fg-ghost disabled:hover:bg-transparent`
          : `h-7 rounded-card px-3 text-dense ${on ? "bg-island text-fg shadow-raised ring-1 ring-line" : "text-fg-muted hover:text-fg"}`;
        return (
          <Tip key={item.id} content={item.hint}>
            <button type="button" role="tab" aria-selected={on} disabled={item.disabled} onClick={() => onChange(item.id)}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${look}`}>
              {item.label}
            </button>
          </Tip>
        );
      })}
    </div>
  );
}
