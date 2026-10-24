import type { LineageWidget, SummaryWidget } from "../model/types";
import { useView, useWidget } from "../model/view";
import { shortSha } from "../lib/format";
import { Icon } from "../icons/Icon";
import { useHovered } from "../state/linking";
import { useSelection } from "../state/selection";
import { Tip } from "../components/Tip";
import { VersionLine } from "../components/VersionLine";

/** The window's bottom row, on the frame: where the data comes from at the left; the version under the
 *  pointer (or selected) at the right, as the same VersionLine the canvas shows. */
export function StatusBar() {
  const view = useView();
  const lineage = useWidget<LineageWidget>("lineage/2");
  const summary = useWidget<SummaryWidget>("summary/1");
  const hovered = useHovered();
  const selected = useSelection();
  const id = hovered && hovered.length > 1 ? null : hovered?.[0] ?? selected;
  const focus = lineage?.nodes.find((n) => n.id === id);
  const commit = view.scope?.ledger_commit;
  return (
    <footer className="flex h-(--status-h) shrink-0 items-center gap-4 px-3 text-small text-fg-faint">
      <span className="inline-flex items-center gap-1"><Icon name="commit" size={12} />{view.source === "ledger" ? "账本" : "会话"}</span>
      {commit && <Tip content={`账本提交 ${commit}`}><span className="font-mono">{shortSha(commit)}</span></Tip>}
      {view.line.window && <span className="font-mono">{view.line.window.join(" → ")}</span>}
      {summary && <span>{summary.versions} 个版本 · {summary.research_runs} 次研究运行 · {summary.masked_runs} 次失去资格</span>}
      <span className="ml-auto">
        {hovered && hovered.length > 1 ? <span className="text-fg-muted">{hovered.length} 个版本</span>
          : focus && <VersionLine node={focus} targets={lineage?.targets ?? null} />}
      </span>
    </footer>
  );
}
