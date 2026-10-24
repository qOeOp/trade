import { Icon } from "../icons/Icon";
import { Kbd } from "./Kbd";

/** The toolbar's search box, which opens the command palette. */
export function SearchTrigger({ onOpen, label }: { onOpen: () => void; label: string }) {
  return (
    <button type="button" onClick={onOpen}
            className="inline-flex h-(--frame-control) shrink-0 items-center gap-2 rounded-control border border-line-strong px-2 text-dense text-fg-faint transition-colors hover:bg-hover">
      <Icon name="search" />{label}<Kbd>⌘K</Kbd>
    </button>
  );
}
