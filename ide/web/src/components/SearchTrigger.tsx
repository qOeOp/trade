import { Icon } from "../icons/Icon";
import { Kbd } from "./Kbd";

/** The toolbar's search box, which opens the command palette: a field's width, giving way when the row is short. */
export function SearchTrigger({ onOpen, label }: { onOpen: () => void; label: string }) {
  return (
    <button type="button" onClick={onOpen}
            className="inline-flex h-(--frame-control) min-w-32 max-w-60 flex-1 items-center gap-2 rounded-control border border-line-strong px-2 text-dense text-fg-faint transition-colors hover:bg-hover active:bg-pressed">
      <Icon name="search" /><span className="min-w-0 flex-1 truncate text-left">{label}</span><Kbd>⌘K</Kbd>
    </button>
  );
}
