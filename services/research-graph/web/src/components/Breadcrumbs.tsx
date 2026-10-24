import { Icon } from "../icons/Icon";
import { Dropdown, DropdownItem } from "./Dropdown";

export type Crumb = { id: string; label: string; onSelect?: () => void };

// Steps shown in full at each end; the middle of a longer path folds into one "…" step whose menu
// lists it, as IntelliJ's navigation bar does, so the steps that are shown stay readable. Earlier
// steps are capped in width, so the last one (where you are) keeps most of the room.
const HEAD = 1, TAIL = 2;

function Step({ crumb, last }: { crumb: Crumb; last: boolean }) {
  return crumb.onSelect
    ? <button type="button" onClick={crumb.onSelect} className={`truncate rounded-control px-2 transition-colors hover:bg-hover hover:text-fg ${last ? "text-fg-muted" : "max-w-40"}`}>{crumb.label}</button>
    : <span className="truncate px-2">{crumb.label}</span>;
}

const Chevron = () => <span className="shrink-0 text-fg-ghost"><Icon name="chevron-right" size={12} /></span>;

/** A path of clickable steps separated by chevrons; the last step is where you are. */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  const folded = items.length > HEAD + TAIL + 1 ? items.slice(HEAD, items.length - TAIL) : [];
  const shown = folded.length ? [...items.slice(0, HEAD), null, ...items.slice(items.length - TAIL)] : items;
  return (
    <nav aria-label="路径" className="flex min-w-0 items-center overflow-hidden">
      {shown.map((c, i) => (
        <span key={c?.id ?? "…"} className={`flex min-w-0 items-center ${c == null ? "shrink-0" : ""}`}>
          {i > 0 && <Chevron />}
          {c == null
            ? <Dropdown variant="inline" label={`另外 ${folded.length} 级`} trigger={<span className="hover:text-fg">…</span>}>
                {folded.map((f) => <DropdownItem key={f.id} onSelect={() => f.onSelect?.()}>{f.label}</DropdownItem>)}
              </Dropdown>
            : <Step crumb={c} last={i === shown.length - 1} />}
        </span>
      ))}
    </nav>
  );
}
