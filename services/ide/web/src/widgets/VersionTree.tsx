import { useEffect, useMemo, useState } from "react";
import { expandAllFeature, hotkeysCoreFeature, selectionFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import type { LineageNode, LineageWidget } from "../model/types";
import { ancestors, descendants, lineageTree } from "../model/lineageTree";
import { openSource } from "../state/editors";
import { hoverProps } from "../state/linking";
import { select, useSelection } from "../state/selection";
import { versionTreeControl } from "../state/versionTree";
import { TREE_INDENT, TreeRow } from "../components/TreeRow";
import { VersionLine } from "../components/VersionLine";
import { VersionMenu } from "../components/VersionMenu";
import { PaperButton, RunningDot } from "../components/PaperButton";

const ROOT = "__root__";

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
    indent: TREE_INDENT,
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
          <TreeRow {...item.getProps()} {...hoverProps(id)} onDoubleClick={() => openSource(id)} className="group"
                   level={level} folder={item.isFolder()} expanded={item.isExpanded()} selected={item.isSelected()}>
            <span className="relative inline-flex"><RunningDot id={id} /><VersionLine node={node} targets={widget.targets} dim={node.role === "masked"} /></span>
            {count > 0 && <span className="ml-1 text-fg-faint">{count}</span>}
            <span className="ml-auto pl-2"><PaperButton id={id} /></span>
          </TreeRow>
          </VersionMenu>
        );
      })}
    </div>
  );
}
