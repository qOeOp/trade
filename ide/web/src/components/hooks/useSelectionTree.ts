import { useEffect, useState } from "react";
import { expandAllFeature, hotkeysCoreFeature, selectionFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import type { Atom } from "../../state/atom";
import { select, useSelection } from "../../state/selection";
import type { TreeControl } from "../../state/versionTree";
import { TREE_INDENT } from "../TreeRow";

/** The id of a tree's hidden root, whose children are its top rows. */
export const ROOT = "__root__";

/** A headless tree whose selection is the page's selected version, as IntelliJ's project tree: moving the focus
 *  or clicking a `selectable` row selects it everywhere, and a selection made elsewhere opens its `ancestors` and
 *  scrolls it into view. `folders` start open and are what Expand all opens; the tree's header reaches expand,
 *  collapse and reveal through `control` while the tree is mounted. */
export function useSelectionTree<T>({ item, children, name, folder, selectable, ancestors, folders, control }: {
  item: (id: string) => T; children: (id: string) => string[]; name: (id: string) => string; folder: (id: string) => boolean;
  selectable: (id: string | null) => id is string; ancestors: (id: string) => string[]; folders: string[]; control: Atom<TreeControl | null>;
}) {
  const [expandedItems, setExpandedItems] = useState<string[]>(folders);
  const [focusedItem, setFocusedItem] = useState<string | null>(null);
  const selected = useSelection();
  const pick = (id: string | null) => { if (selectable(id)) select(id, { reveal: true }); };
  const tree = useTree<T>({
    rootItemId: ROOT,
    getItemName: (i) => name(i.getId()),
    isItemFolder: (i) => folder(i.getId()),
    dataLoader: { getItem: item, getChildren: children },
    state: { expandedItems, selectedItems: selected ? [selected] : [], focusedItem },
    setExpandedItems,
    setFocusedItem: (next) => {
      const id = typeof next === "function" ? next(focusedItem) : next;
      setFocusedItem(id);
      if (id !== selected) pick(id);
    },
    setSelectedItems: (next) => { const [id = null] = typeof next === "function" ? next(selected ? [selected] : []) : next; pick(id); },
    onPrimaryAction: (i) => pick(i.getId()),
    indent: TREE_INDENT,
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, expandAllFeature],
  });

  const reveal = (id: string | null) => {
    if (!selectable(id)) return;
    setExpandedItems((open) => [...new Set([...open, ...ancestors(id)])]);
    requestAnimationFrame(() => { void tree.getItemInstance(id).scrollTo({ block: "nearest" }); });
  };
  useEffect(() => reveal(selected), [selected]);  // follow a selection made elsewhere
  useEffect(() => {
    control.set({ expandAll: () => setExpandedItems(folders), collapseAll: () => setExpandedItems([]), revealSelected: () => reveal(selected) });
    return () => control.set(null);
  });
  return tree;
}
