import type { HTMLAttributes, ReactNode, Ref } from "react";
import { Icon } from "../icons/Icon";

export const TREE_INDENT = 20;

type Props = { level: number; folder: boolean; expanded: boolean; selected: boolean; children: ReactNode; ref?: Ref<HTMLDivElement> }
  & Omit<HTMLAttributes<HTMLDivElement>, "children">;

/** A row of a tree tool window, as IntelliJ's Project view draws one: indent guides, a chevron on a
 *  folder, then the row's content. Text in it does not select, so a double-click only opens. The rest
 *  of the props (the tree item's, a context menu trigger's) pass through. */
export function TreeRow({ level, folder, expanded, selected, children, className = "", ...rest }: Props) {
  return (
    <div {...rest} data-selected={selected ? "" : undefined}
         className={`relative flex h-(--row-h) cursor-default select-none items-center gap-1 pr-3 outline-none transition-colors hover:bg-row-hover focus-visible:ring-1 focus-visible:ring-focus focus-visible:ring-inset ${className}`}
         style={{ paddingLeft: 8 + level * TREE_INDENT }}>
      {Array.from({ length: level }, (_, l) => (
        <span key={l} className="pointer-events-none absolute inset-y-0 w-px bg-guide" style={{ left: 8 + l * TREE_INDENT + 8 }} />
      ))}
      <span className={`grid w-4 shrink-0 place-items-center text-icon transition-transform ${expanded ? "rotate-90" : ""}`}>
        {folder && <Icon name="chevron-right" />}
      </span>
      {children}
    </div>
  );
}
