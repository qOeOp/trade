import { useMemo } from "react";
import type { LineageNode, LineageWidget } from "../model/types";
import { ancestors, descendants, lineageTree } from "../model/lineageTree";
import { openSource } from "../state/editors";
import { hoverProps } from "../state/linking";
import { versionTreeControl } from "../state/versionTree";
import { TreeRow } from "../components/TreeRow";
import { ROOT, useSelectionTree } from "../components/hooks/useSelectionTree";
import { VersionLine } from "../components/VersionLine";
import { VersionMenu } from "../components/VersionMenu";
import { PaperButton } from "../components/PaperButton";

// The versions as a tree by lineage, like IntelliJ's Project view: indent guides, a chevron per
// parent, each version's VersionLine and how many versions descend from it. Selecting a row (by click
// or by moving with arrows, Home/End) selects the version everywhere and brings it into view on the canvas.
export function VersionTree({ widget }: { widget: LineageWidget }) {
  const structure = useMemo(() => lineageTree(widget), [widget]);
  const byId = useMemo(() => new Map(widget.nodes.map((n) => [n.id, n])), [widget]);
  const parents = useMemo(() => [...structure.children.keys()], [structure]);
  const tree = useSelectionTree<LineageNode | null>({
    item: (id) => byId.get(id) ?? null,
    children: (id) => (id === ROOT ? structure.roots : structure.children.get(id) ?? []),
    name: (id) => id,
    folder: (id) => (structure.children.get(id)?.length ?? 0) > 0 || id === ROOT,
    selectable: (id): id is string => !!id && byId.has(id),
    ancestors: (id) => ancestors(structure, id),
    folders: parents, control: versionTreeControl,
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
            <VersionLine node={node} targets={widget.targets} dim={node.role === "masked"} />
            {count > 0 && <span className="ml-1 text-fg-faint">{count}</span>}
            <span className="row-end sticky right-0 ml-auto pr-1 pl-2"><PaperButton id={id} /></span>
          </TreeRow>
          </VersionMenu>
        );
      })}
    </div>
  );
}
