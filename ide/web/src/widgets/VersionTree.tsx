import { useMemo } from "react";
import type { LineageNode, LineageWidget } from "../model/types";
import { ancestors, compactLineage, descendants, lineageTree, type FoldBar } from "../model/lineageTree";
import { openSource } from "../state/editors";
import { hoverProps, toggleBranch, useExpandedBranches, useLineageMode } from "../state/linking";
import { useSelection } from "../state/selection";
import { versionTreeControl } from "../state/versionTree";
import { TreeRow } from "../components/TreeRow";
import { ROOT, useSelectionTree } from "../components/hooks/useSelectionTree";
import { VersionLine } from "../components/VersionLine";
import { VersionMenu } from "../components/VersionMenu";
import { PaperButton } from "../components/PaperButton";

type TreeEntry = { node: LineageNode | null; fold: FoldBar | null };
const EMPTY_ENTRY: TreeEntry = { node: null, fold: null };

// The versions as a tree by lineage, like IntelliJ's Project view: indent guides, a chevron per
// parent, each version's VersionLine and how many versions descend from it, with inline FoldBars for unpassed runs.
export function VersionTree({ widget: rawWidget }: { widget: LineageWidget }) {
  const mode = useLineageMode();
  const expanded = useExpandedBranches();
  const selected = useSelection();
  const { widget, foldBars } = useMemo(
    () => compactLineage(rawWidget, mode, selected, expanded),
    [rawWidget, mode, selected, expanded],
  );
  const treeKey = `${mode}:${[...expanded].join(",")}:${widget.nodes.length}`;
  return <VersionTreeBody key={treeKey} widget={widget} foldBars={foldBars} />;
}

function VersionTreeBody({ widget, foldBars }: { widget: LineageWidget; foldBars: readonly FoldBar[] }) {
  const { structure, versionStructure, entries, parents } = useMemo(() => {
    const foldEdges = foldBars.flatMap((f) => (f.parentId ? [{ from: f.parentId, to: f.id }] : []));
    const st = lineageTree({
      rows: widget.rows,
      nodes: [...widget.nodes, ...foldBars.map((f) => ({ id: f.id }))],
      edges: [...widget.edges, ...foldEdges],
    });
    const vSt = lineageTree(widget);
    const map = new Map<string, TreeEntry>([[ROOT, EMPTY_ENTRY]]);
    for (const n of widget.nodes) map.set(n.id, { node: n, fold: null });
    for (const f of foldBars) map.set(f.id, { node: null, fold: f });
    return { structure: st, versionStructure: vSt, entries: map, parents: [...st.children.keys()] };
  }, [widget, foldBars]);

  const tree = useSelectionTree<TreeEntry>({
    item: (id) => entries.get(id) ?? EMPTY_ENTRY,
    children: (id) => (id === ROOT ? structure.roots : structure.children.get(id) ?? []),
    name: (id) => id,
    folder: (id) => (structure.children.get(id)?.length ?? 0) > 0 || id === ROOT,
    selectable: (id): id is string => !!id && !!entries.get(id)?.node,
    ancestors: (id) => ancestors(structure, id),
    folders: parents,
    control: versionTreeControl,
  });

  return (
    <div {...tree.getContainerProps()} className="w-max min-w-full py-1 text-dense outline-none">
      {tree.getItems().map((item) => {
        const entry = item.getItemData(), id = item.getId(), level = item.getItemMeta().level;
        if (entry.fold) {
          const f = entry.fold;
          return (
            <TreeRow key={id} {...item.getProps()} onClick={() => toggleBranch(f.id)} className="group"
                     level={level} folder={false} expanded={false} selected={false}>
              <span className="inline-flex items-center gap-1.5 rounded-control border border-dashed border-line-strong bg-well/80 px-1.5 py-px text-small text-fg-muted group-hover:border-fg-faint group-hover:text-fg">
                <span className="text-fg">{f.expanded ? "▾" : "▸"}</span>
                <span className="font-medium text-fg">{f.expanded ? `Fold ${f.nodes.length} unpassed` : `${f.nodes.length} unpassed folded`}</span>
                <span className="font-mono text-fg-faint">· {f.rangeLabel}</span>
              </span>
            </TreeRow>
          );
        }
        const node = entry.node;
        if (!node) return null;
        const count = descendants(versionStructure, id);
        return (
          <VersionMenu key={id} id={id}>
            <TreeRow {...item.getProps()} {...hoverProps(id)} onDoubleClick={() => openSource(id)} className="group"
                     level={level} folder={item.isFolder()} expanded={item.isExpanded()} selected={item.isSelected()}>
              <VersionLine node={node} targets={widget.targets} dim={node.role === "masked"} />
              {count > 0 && <span className="ml-1 shrink-0 text-fg-faint">{count}</span>}
              <span className="row-end sticky right-0 ml-auto shrink-0 pr-1 pl-2"><PaperButton id={id} /></span>
            </TreeRow>
          </VersionMenu>
        );
      })}
    </div>
  );
}
