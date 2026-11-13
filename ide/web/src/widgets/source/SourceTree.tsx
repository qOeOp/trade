import { useMemo } from "react";
import type { SourceItem, SourcesWidget } from "../../model/types";
import { Icon } from "../../icons/Icon";
import { openSource } from "../../state/editors";
import { hoverProps } from "../../state/linking";
import { sourceTreeControl } from "../../state/versionTree";
import { TreeRow } from "../../components/TreeRow";
import { ROOT, useSelectionTree } from "../../components/hooks/useSelectionTree";
import { VersionMenu } from "../../components/VersionMenu";

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
  const tree = useSelectionTree<Entry>({
    item: (id) => entries.get(id)!,
    children: (id) => entries.get(id)?.children ?? [],
    name: (id) => entries.get(id)?.label ?? id,
    folder: (id) => entries.get(id)?.item === null,
    selectable: (id): id is string => !!id && !!entries.get(id)?.item,
    ancestors: (id) => [DIR + id.slice(0, id.lastIndexOf("@"))].filter((dir) => entries.has(dir)),
    folders: dirs, control: sourceTreeControl,
  });

  return (
    <div {...tree.getContainerProps()} className="w-max min-w-full py-1 text-dense outline-none">
      {tree.getItems().map((item) => {
        const entry = item.getItemData(), id = item.getId(), level = item.getItemMeta().level;
        const folder = entry.item === null;
        const row = (key?: string) => (
          <TreeRow key={key} {...item.getProps()} {...(folder ? {} : hoverProps(id))}
                   onDoubleClick={() => { if (!folder) openSource(id); }}
                   onKeyDown={(e) => { if (e.key === "Enter" && !folder) openSource(id); }}
                   level={level} folder={folder} expanded={item.isExpanded()} selected={item.isSelected()}>
            <span className="grid w-4 shrink-0 place-items-center text-icon">
              <Icon name={folder ? (item.isExpanded() ? "folder-open" : "folder") : "file.python"} />
            </span>
            <span className={`ml-1 font-mono ${folder || entry.item?.source != null ? "text-fg" : "text-fg-faint"}`}>{entry.label}</span>
            {folder && <span className="ml-1 text-fg-faint">{entry.children.length}</span>}
          </TreeRow>
        );
        return folder ? row(id) : <VersionMenu key={id} id={id}>{row()}</VersionMenu>;
      })}
    </div>
  );
}
