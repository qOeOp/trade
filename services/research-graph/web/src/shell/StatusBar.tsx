import type { LineageWidget, SummaryWidget } from "../model/types";
import { ancestors, lineageTree } from "../model/lineageTree";
import { useView, useWidget } from "../model/view";
import { requestFocus, useHovered } from "../state/linking";
import { select, useSelection } from "../state/selection";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { VersionLine } from "../components/VersionLine";
import { useMemo } from "react";

/** The window's bottom row, on the frame, as IntelliJ's: the path to the selected version (line ›
 *  ancestors › version, each step clickable) at the left; the version under the pointer, else the
 *  selected one, as its VersionLine and the line's counts at the right. */
export function StatusBar() {
  const { line } = useView();
  const lineage = useWidget<LineageWidget>("lineage/2");
  const summary = useWidget<SummaryWidget>("summary/1");
  const tree = useMemo(() => (lineage ? lineageTree(lineage) : null), [lineage]);
  const hovered = useHovered();
  const selected = useSelection();
  const id = hovered && hovered.length > 1 ? null : hovered?.[0] ?? selected;
  const focus = lineage?.nodes.find((n) => n.id === id);
  const path = selected && tree ? [...ancestors(tree, selected), selected] : [];
  return (
    <footer className="flex h-(--status-h) shrink-0 items-center gap-4 px-(--frame-inset) text-small text-fg-faint">
      <Breadcrumbs items={[
        { id: "line", label: line.bundle.replace(/^research-line-/, ""), onSelect: () => requestFocus("") },
        ...path.map((v) => ({ id: v, label: v, onSelect: () => select(v, { reveal: true }) })),
      ]} />
      <span className="ml-auto flex shrink-0 items-center gap-4 pr-2">
        {hovered && hovered.length > 1 ? <span className="text-fg-muted">{hovered.length} 个版本</span>
          : focus && <VersionLine node={focus} targets={lineage?.targets ?? null} />}
        {summary && <span>{summary.versions} 个版本 · {summary.research_runs} 次研究运行 · {summary.masked_runs} 次失去资格</span>}
      </span>
    </footer>
  );
}
