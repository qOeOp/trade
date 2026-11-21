import type { ReactNode } from "react";

/** A segmented control in a form, as macOS picks one of a few: the options sit in a recessed track on the
 *  frame colour, the chosen one raised onto the island with a hairline; as wide, as tall and as round as
 *  the fields around it. Views elsewhere switch with text tabs (Tabs.tsx). */
export function Segmented<T extends string>({ items, value, onChange, label }: {
  items: readonly { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full items-center gap-0.5 rounded-control bg-frame p-0.5">
      {items.map((item) => {
        const on = item.id === value;
        return (
          <button key={item.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(item.id)}
                  className={`inline-flex h-6 min-w-0 grow items-center justify-center gap-1.5 whitespace-nowrap rounded-badge px-2 transition-colors ${on ? "bg-island text-fg shadow-raised ring-1 ring-line-strong" : "text-fg-muted hover:text-fg"}`}>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
