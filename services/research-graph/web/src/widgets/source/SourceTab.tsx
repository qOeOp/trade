import type { SourceItem, SourcesWidget } from "../../model/types";
import { Icon } from "../../icons/Icon";
import { openDiffTab, openSourceTab, showLineage } from "../../state/editors";
import { requestFocus } from "../../state/linking";
import { select } from "../../state/selection";
import { CodeView } from "../../components/CodeView";
import { TextButton } from "../../components/TextButton";

type Opened = { item: SourceItem | undefined; parent: SourceItem | undefined };

export function opened(widget: SourcesWidget | undefined, id: string): Opened {
  const item = widget?.items.find((i) => i.id === id);
  return { item, parent: item?.parent ? widget?.items.find((i) => i.id === item.parent) : undefined };
}

/** The bar under the tabs of a source or diff tab, as IntelliJ's breadcrumbs and diff toolbar: the file
 *  (and in a diff the parent it is compared with), then the way to the other view and to the graph. */
export function SourceBar({ id, diff, widget }: { id: string; diff: boolean; widget: SourcesWidget | undefined }) {
  const { item, parent } = opened(widget, id);
  const comparable = item?.source != null && parent?.source != null;
  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap border-b border-line px-3 text-dense text-fg-muted">
      <Icon name={diff ? "diff" : "file.python"} className="text-icon" />
      {diff && parent && <><span className="min-w-0 truncate font-mono">{parent.id}.py</span><Icon name="chevron-right" size={12} className="text-icon" /></>}
      <span className="min-w-0 truncate font-mono text-fg">{id}.py</span>
      <span className="ml-auto" />
      {diff ? <TextButton onClick={() => openSourceTab(id)}><Icon name="file.python" />Open source</TextButton>
        : comparable && <TextButton onClick={() => openDiffTab(id)}><Icon name="diff" />Compare with parent</TextButton>}
      <TextButton onClick={() => { select(id); showLineage(); requestFocus(id); }}><Icon name="locate" />Locate in graph</TextButton>
    </div>
  );
}

/** The source of a version, or in a diff its change from its parent's source. */
export function SourceBody({ id, diff, widget }: { id: string; diff: boolean; widget: SourcesWidget | undefined }) {
  const { item, parent } = opened(widget, id);
  if (item?.source == null) return <p className="px-4 py-3 text-dense text-fg-faint">This graph holds no source for {id}.</p>;
  if (diff && parent?.source == null) return <p className="px-4 py-3 text-dense text-fg-faint">This graph holds no parent source to compare {id} with.</p>;
  return <CodeView source={item.source} original={diff ? parent!.source! : undefined} />;
}
