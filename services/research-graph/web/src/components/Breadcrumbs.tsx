import { Icon } from "../icons/Icon";

export type Crumb = { id: string; label: string; onSelect?: () => void };

/** A path of clickable steps separated by chevrons; the last step is where you are. */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="路径" className="flex min-w-0 items-center overflow-hidden">
      {items.map((c, i) => (
        <span key={c.id} className="flex min-w-0 items-center">
          {i > 0 && <span className="shrink-0 text-fg-ghost"><Icon name="chevron-right" size={12} /></span>}
          {c.onSelect
            ? <button type="button" onClick={c.onSelect} className={`truncate rounded-control px-1 transition-colors hover:bg-hover hover:text-fg ${i === items.length - 1 ? "text-fg-muted" : ""}`}>{c.label}</button>
            : <span className="truncate px-1">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
