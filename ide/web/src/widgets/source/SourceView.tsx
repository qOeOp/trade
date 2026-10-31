import { useRef } from "react";
import type { SourceItem, SourcesWidget } from "../../model/types";
import { Icon } from "../../icons/Icon";
import { showLineage, toggleDiff } from "../../state/editors";
import { requestFocus } from "../../state/linking";
import { select } from "../../state/selection";
import { CodeView } from "../../components/CodeView";
import { useSize } from "../../components/hooks/useSize";
import { PanelHeader } from "../../components/PanelHeader";
import { TextButton } from "../../components/TextButton";

type Opened = { item: SourceItem | undefined; parent: SourceItem | undefined; comparing: boolean };

/** The open version, its parent, and whether the change from the parent shows: the comparison is on
 *  and both sources are in the graph. */
export function opened(widget: SourcesWidget | undefined, id: string, diff: boolean): Opened {
  const item = widget?.items.find((i) => i.id === id);
  const parent = item?.parent ? widget?.items.find((i) => i.id === item.parent) : undefined;
  return { item, parent, comparing: diff && item?.source != null && parent?.source != null };
}

/** The editor's header, as IntelliJ's editor breadcrumbs and diff toolbar in one row: the file (while
 *  comparing, its parent's file before it), then the comparison toggle and the way back to the graph. */
export function SourceBar({ id, diff, widget }: { id: string; diff: boolean; widget: SourcesWidget | undefined }) {
  const { item, parent, comparing } = opened(widget, id, diff);
  return (
    <PanelHeader actions={[]}>
      <div className="@container flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap text-dense">
        <Icon name={comparing ? "diff" : "file.python"} className="shrink-0 text-icon" />
        {/* short of room, the parent's name gives way before the open file's */}
        {comparing && <><FileName id={parent!.id} className="shrink-[100] text-fg-muted" /><Icon name="chevron-right" size={12} className="shrink-0 text-icon" /></>}
        <FileName id={id} data-file />
        <span className="ml-auto" />
        {/* in a narrow editor the actions keep only their icons */}
        {item?.source != null && parent?.source != null
          && <TextButton active={diff} onClick={toggleDiff} aria-label="Compare with parent" title="Compare with parent" className="shrink-0">
            <Icon name="diff" /><span className="hidden @[34rem]:inline">Compare with parent</span></TextButton>}
        <TextButton onClick={() => { select(id); showLineage(); requestFocus(id); }} aria-label="Locate in graph" title="Locate in graph" className="shrink-0">
          <Icon name="locate" /><span className="hidden @[34rem]:inline">Locate in graph</span></TextButton>
      </div>
    </PanelHeader>
  );
}

/** A version's file name, cut in the middle to the room it is given so `@<revision>.py` stays: the whole
 *  name on hover. An invisible copy of the whole name keeps its place in the row (how far it shrinks); the
 *  face is monospace, so the cut is a count of characters and the ellipsis meets the kept end. */
function FileName({ id, className = "", ...rest }: { id: string; className?: string; "data-file"?: boolean }) {
  const name = `${id}.py`, keep = name.slice(name.lastIndexOf("@"));
  const [ref, { width }] = useSize<HTMLSpanElement>();
  const whole = useRef<HTMLSpanElement>(null);
  const ch = (whole.current?.getBoundingClientRect().width ?? 0) / name.length;
  const room = ch ? Math.floor(width / ch + 0.01) : name.length;
  const shown = room >= name.length ? name : `${name.slice(0, Math.max(1, room - keep.length - 1))}…${keep}`;
  return (
    // never narrower than its shortest form, a first letter, the ellipsis and the kept end
    <span ref={ref} title={name} style={{ minWidth: `${keep.length + 2}ch` }} className={`relative overflow-hidden font-mono ${className}`} {...rest}>
      <span ref={whole} aria-hidden className="invisible inline-block">{name}</span>
      <span className="absolute inset-0">{shown}</span>
    </span>
  );
}

/** The source of a version, or while comparing its change from its parent's source. */
export function SourceBody({ id, diff, widget }: { id: string; diff: boolean; widget: SourcesWidget | undefined }) {
  const { item, parent, comparing } = opened(widget, id, diff);
  if (item?.source == null) return <p className="px-4 py-3 text-dense text-fg-faint">This graph holds no source for {id}.</p>;
  return <CodeView key={String(comparing)} source={item.source} original={comparing ? parent!.source! : undefined} />;
}
