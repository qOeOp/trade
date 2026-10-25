import { useEffect, useMemo, useState } from "react";
import { expandAllFeature, hotkeysCoreFeature, selectionFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import type { SourceItem, SourcesWidget } from "../../model/types";
import { Icon } from "../../icons/Icon";
import { openSourceTab } from "../../state/editors";
import { hoverProps } from "../../state/linking";
import { select, useSelection } from "../../state/selection";
import { sourceTreeControl } from "../../state/versionTree";
import { VersionMenu } from "../../components/VersionMenu";

const ROOT = "__root__";
const INDENT = 20;
const DIR = "dir:";

type Entry = { id: string; label: string; item: SourceItem | null; children: string[] };

/** One file per version, named `<version>.py`; a strategy with several revisions is a folder of them. */
function files(items: readonly SourceItem[]): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  const byStrategy = new Map<string, SourceItem[]>();
  for (const item of items) {
    const strategy = item.id.slice(0, item.id.lastIndexOf("@"));
    byStrategy.set(strategy, [...(byStrategy.get(strategy) ?? []), item]);
  }
  const revision = (i: SourceItem) => Number(i.id.slice(i.id.lastIndexOf("@") + 1));
  const file = (i: SourceItem) => { entries.set(i.id, { id: i.id, label: `${i.id}.py`, item: i, children: [] }); return i.id; };
  const top = [...byStrategy].sort(([a], [b]) => a.localeCompare(b)).map(([strategy, group]) => {
    const [only] = group;
    if (group.length === 1 && only) return file(only);
    const dir = { id: DIR + strategy, label: strategy, item: null, children: [...group].sort((a, b) => revision(a) - revision(b)).map(file) };
    entries.set(dir.id, dir);
    return dir.id;
  });
  entries.set(ROOT, { id: ROOT, label: "", item: null, children: top });
  return entries;
}

// The versions' sources as files, like IntelliJ's Project view: a click selects the version everywhere,
// a double-click or Enter opens its source in an editor tab. A version the graph holds no source for is faint.
export function SourceTree({ widget }: { widget: SourcesWidget }) {
  const entries = useMemo(() => files(widget.items), [widget]);
  const dirs = useMemo(() => [...entries.keys()].filter((id) => id.startsWith(DIR)), [entries]);
  const [expandedItems, setExpandedItems] = useState<string[]>(dirs);
  const [focusedItem, setFocusedItem] = useState<string | null>(null);
  const selected = useSelection();
  const isFile = (id: string | null): id is string => !!id && !!entries.get(id)?.item;
  const tree = useTree<Entry>({
    rootItemId: ROOT,
    getItemName: (item) => item.getItemData().label,
    isItemFolder: (item) => item.getItemData().item === null,
    dataLoader: { getItem: (id) => entries.get(id)!, getChildren: (id) => entries.get(id)?.children ?? [] },
    state: { expandedItems, selectedItems: selected ? [selected] : [], focusedItem },
    setExpandedItems,
    setFocusedItem: (next) => {
      const id = typeof next === "function" ? next(focusedItem) : next;
      setFocusedItem(id);
      if (isFile(id) && id !== selected) select(id, { reveal: true });
    },
    setSelectedItems: (next) => {
      const [id = null] = typeof next === "function" ? next(selected ? [selected] : []) : next;
      if (isFile(id)) select(id, { reveal: true });
    },
    onPrimaryAction: (item) => { if (isFile(item.getId())) select(item.getId(), { reveal: true }); },
    indent: INDENT,
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, expandAllFeature],
  });

  const reveal = (id: string | null) => {
    if (!isFile(id)) return;
    const strategy = DIR + id.slice(0, id.lastIndexOf("@"));
    if (entries.has(strategy)) setExpandedItems((open) => [...new Set([...open, strategy])]);
    requestAnimationFrame(() => { void tree.getItemInstance(id).scrollTo({ block: "nearest" }); });
  };
  useEffect(() => reveal(selected), [selected]);  // follow a selection made elsewhere
  useEffect(() => {
    sourceTreeControl.set({ expandAll: () => setExpandedItems(dirs), collapseAll: () => setExpandedItems([]), revealSelected: () => reveal(selected) });
    return () => sourceTreeControl.set(null);
  });

  return (
    <div {...tree.getContainerProps()} className="w-max min-w-full py-1 text-dense outline-none">
      {tree.getItems().map((item) => {
        const entry = item.getItemData(), id = item.getId(), level = item.getItemMeta().level;
        const folder = entry.item === null;
        const row = (
          <div {...item.getProps()} {...(folder ? {} : hoverProps(id))} data-selected={item.isSelected() ? "" : undefined}
               onDoubleClick={() => { if (!folder) openSourceTab(id); }}
               onKeyDown={(e) => { if (e.key === "Enter" && !folder) openSourceTab(id); }}
               className="relative flex h-(--row-h) cursor-default select-none items-center gap-1 pr-3 outline-none transition-colors hover:bg-row-hover focus-visible:ring-1 focus-visible:ring-focus focus-visible:ring-inset"
               style={{ paddingLeft: 8 + level * INDENT }}>
            {Array.from({ length: level }, (_, l) => (
              <span key={l} className="pointer-events-none absolute inset-y-0 w-px bg-guide" style={{ left: 8 + l * INDENT + 8 }} />
            ))}
            <span className={`grid w-4 shrink-0 place-items-center text-icon transition-transform ${item.isExpanded() ? "rotate-90" : ""}`}>
              {folder && <Icon name="chevron-right" />}
            </span>
            <span className="grid w-4 shrink-0 place-items-center text-icon">
              <Icon name={folder ? (item.isExpanded() ? "folder-open" : "folder") : "file.python"} />
            </span>
            <span className={`ml-1 font-mono ${folder || entry.item?.source != null ? "text-fg" : "text-fg-faint"}`}>{entry.label}</span>
            {folder && <span className="ml-1 text-fg-faint">{entry.children.length}</span>}
          </div>
        );
        return folder ? <div key={id}>{row}</div> : <VersionMenu key={id} id={id}>{row}</VersionMenu>;
      })}
    </div>
  );
}
