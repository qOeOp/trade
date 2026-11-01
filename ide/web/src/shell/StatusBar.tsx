import { useMemo } from "react";
import type { LineageWidget, SummaryWidget } from "../model/types";
import { ACTIVE } from "../model/chain";
import { ancestors, lineageTree } from "../model/lineageTree";
import { useView, useWidget } from "../model/view";
import { plural } from "../lib/format";
import { useAtom } from "../state/atom";
import { useBacktest, type Loaded } from "../state/backtest";
import { requestFocus, useHovered } from "../state/linking";
import { notice, usePaperRuns } from "../state/paper";
import { select, useSelection } from "../state/selection";
import { useOnRunsPage } from "../state/shell";
import { useShown } from "../state/shown";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { MarketImportStatus } from "../components/MarketImportStatus";
import { UpdateStatus } from "../components/UpdateStatus";
import { VersionLine } from "../components/VersionLine";

/** Where the stage the Runs page shows comes from. */
const SOURCE = { backtest: "", paper: " · 1m bars · Binance public data · Sandbox fills" } as const;
const EXECUTION: Record<string, string> = { bars: "1m bars", quotes: "aggTrades quotes" };
/** The backtest's: its daily series, the runtime image and the line's market commit (each by its end), how
 *  it filled; or, in the failure colour, that its report is not served here. */
function backtestSource(l: Loaded | null, market: string | null): { text: string; failed: boolean } {
  if (l?.kind === "absent") return { text: " · data not served by this IDE", failed: true };
  if (l?.kind !== "ready") return { text: "", failed: false };
  const { image, execution } = l.b, digest = image?.replace(/^sha256:/, "");
  return { text: [" · 1d series", digest && `image …${digest.slice(-6)}`, market && `market …${market.slice(-4)}`, execution && (EXECUTION[execution] ?? execution)]
    .filter(Boolean).join(" · "), failed: false };
}

/** The window's bottom row, on the frame, as IntelliJ's: the path to the selected version (line ›
 *  ancestors › version, each step clickable) at the left, then on the Runs page where the stage it shows
 *  comes from, and the last notice; the version under the pointer, else the selected one, as its
 *  VersionLine and the line's counts at the right, after the market import's state (when the server has
 *  its status) and the graph's update, and on the Runs page after the count of running paper runs
 *  missing data or protection. */
export function StatusBar() {
  const { line } = useView();
  const lineage = useWidget<LineageWidget>("lineage@2");
  const summary = useWidget<SummaryWidget>("summary@1");
  const tree = useMemo(() => (lineage ? lineageTree(lineage) : null), [lineage]);
  const hovered = useHovered();
  const selected = useSelection();
  const id = hovered && hovered.length > 1 ? null : hovered?.[0] ?? selected;
  const focus = lineage?.nodes.find((n) => n.id === id);
  const path = selected && tree ? [...ancestors(tree, selected), selected] : [];
  const said = useAtom(notice);
  const runs = useOnRunsPage();
  const { stage, name } = useShown(), backtest = useBacktest();
  const tested = backtestSource(stage === "backtest" ? backtest : null, line.market_commit ?? null);
  const gapped = (usePaperRuns()?.runs ?? []).filter((r) => ACTIVE.has(r.state) && (r.live?.missing_bars ?? 0) + (r.live?.protection_gaps ?? 0) > 0).length;
  return (
    <footer className="flex h-(--status-h) shrink-0 items-center gap-4 px-(--frame-inset) text-small text-fg-faint">
      <Breadcrumbs items={[
        { id: "line", label: line.bundle.replace(/^research-line-/, ""), onSelect: () => requestFocus("") },
        ...path.map((v) => ({ id: v, label: v, onSelect: () => select(v, { reveal: true }) })),
      ]} />
      {runs && stage && <span className="min-w-0 truncate text-fg-muted">{name}{SOURCE[stage]}<span className={tested.failed ? "text-fail" : ""}>{tested.text}</span></span>}
      {said && <span role="status" className={`min-w-0 truncate ${said.failed ? "text-fail" : "text-fg-muted"}`}>{said.text}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-4 pr-2">
        {runs && gapped > 0 && <span className="text-misses">{plural(gapped, "running paper run")} with missing bars or protection gaps</span>}
        <MarketImportStatus />
        <UpdateStatus />
        {hovered && hovered.length > 1 ? <span className="text-fg-muted">{plural(hovered.length, "version")}</span>
          : focus && <VersionLine node={focus} targets={lineage?.targets ?? null} />}
        {summary && <span>{plural(summary.versions, "version")} · {plural(summary.research_runs, "research run")} · {summary.masked_runs} ineligible</span>}
      </span>
    </footer>
  );
}
