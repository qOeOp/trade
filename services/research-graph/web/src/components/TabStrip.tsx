export type TabItem = { id: string; label: string };

/** IntelliJ tool-window tabs: plain labels, the active one in the text colour with a rounded fill;
 *  labels never wrap, and a strip wider than its island scrolls. */
export function TabStrip({ items, active, onSelect }: { items: readonly TabItem[]; active: string | null; onSelect: (id: string) => void }) {
  return (
    <div role="tablist" className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
      {items.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === active} onClick={() => onSelect(t.id)}
                className={`shrink-0 whitespace-nowrap rounded-control px-2 py-0.5 text-dense transition-colors hover:bg-hover ${t.id === active ? "bg-pressed text-fg" : "text-fg-muted"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
