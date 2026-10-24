import { useEffect, useMemo, useState } from "react";
import { expandAllFeature, hotkeysCoreFeature, selectionFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import type { LineageNode, LineageWidget } from "../model/types";
import { ancestors, descendants, lineageTree } from "../model/lineageTree";
import { Icon } from "../icons/Icon";
import { openVersionTab } from "../state/editors";
import { hoverProps } from "../state/linking";
import { select, useSelection } from "../state/selection";
import { versionTreeControl } from "../state/versionTree";
import { VersionLine } from "../components/VersionLine";
import { VersionMenu } from "../components/VersionMenu";

const ROOT = "__root__";
const INDENT = 20;

// The versions as a tree by lineage, like IntelliJ's Project view: indent guides, a chevron per
// parent, each version's VersionLine and how many versions descend from it. Selecting a row (by click
// or by moving with arrows, Home/End) selects the version everywhere and brings it into view on the canvas.
export function VersionTree({ widget }: { widget: LineageWidget }) {
  const structure = useMemo(() => lineageTree(widget), [widget]);
  const byId = useMemo(() => new Map(widget.nodes.map((n) => [n.id, n])), [widget]);
  const parents = useMemo(() => [...structure.children.keys()], [structure]);
  const [expandedItems, setExpandedItems] = useState<string[]>(parents);
  const [focusedItem, setFocusedItem] = useState<string | null>(null);
  const selected = useSelection();
  const tree = useTree<LineageNode | null>({
    rootItemId: ROOT,
    getItemName: (item) => item.getId(),
    isItemFolder: (item) => (structure.children.get(item.getId())?.length ?? 0) > 0 || item.getId() === ROOT,
    dataLoader: {
      getItem: (id) => byId.get(id) ?? null,
      getChildren: (id) => (id === ROOT ? structure.roots : structure.children.get(id) ?? []),
    },
    state: { expandedItems, selectedItems: selected ? [selected] : [], focusedItem },
    setExpandedItems,
    // As IntelliJ's project tree, the selection follows the keyboard focus.
    setFocusedItem: (next) => {
      const id = typeof next === "function" ? next(focusedItem) : next;
      setFocusedItem(id);
      if (id && id !== selected && byId.has(id)) select(id, { reveal: true });
    },
    setSelectedItems: (next) => { const ids = typeof next === "function" ? next(selected ? [selected] : []) : next; if (ids[0]) select(ids[0], { reveal: true }); },
    onPrimaryAction: (item) => select(item.getId(), { reveal: true }),
    indent: INDENT,
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, expandAllFeature],
  });

  const reveal = (id: string | null) => {
    if (!id || !byId.has(id)) return;
    setExpandedItems((open) => [...new Set([...open, ...ancestors(structure, id)])]);
    requestAnimationFrame(() => { void tree.getItemInstance(id).scrollTo({ block: "nearest" }); });
  };
  useEffect(() => reveal(selected), [selected]);  // follow a selection made elsewhere
  useEffect(() => {
    versionTreeControl.set({ expandAll: () => setExpandedItems(parents), collapseAll: () => setExpandedItems([]), revealSelected: () => reveal(selected) });
    return () => versionTreeControl.set(null);
  });

  return (
    <div {...tree.getContainerProps()} className="w-max min-w-full py-1 text-dense outline-none">
      {tree.getItems().map((item) => {
        const node = item.getItemData();
        if (!node) return null;
        const level = item.getItemMeta().level, id = item.getId(), count = descendants(structure, id);
        return (
          <VersionMenu key={id} id={id}>
          <div {...item.getProps()} {...hoverProps(id)} onDoubleClick={() => openVersionTab(id)} data-selected={item.isSelected() ? "" : undefined}
               className={`relative flex h-(--row-h) cursor-default items-center gap-1 pr-3 outline-none transition-colors hover:bg-row-hover ${item.isFocused() ? "ring-1 ring-line-strong ring-inset" : ""}`}
               style={{ paddingLeft: 8 + level * INDENT }}>
            {Array.from({ length: level }, (_, l) => (
              <span key={l} className="pointer-events-none absolute inset-y-0 w-px bg-guide" style={{ left: 8 + l * INDENT + 8 }} />
            ))}
            <span className={`grid w-4 shrink-0 place-items-center text-icon transition-transform ${item.isExpanded() ? "rotate-90" : ""}`}>
              {item.isFolder() && <Icon name="chevron-right" />}
            </span>
            <VersionLine node={node} targets={widget.targets} dim={node.role === "masked"} />
            {count > 0 && <span className="ml-1 text-fg-faint">{count}</span>}
          </div>
          </VersionMenu>
        );
      })}
    </div>
  );
}
