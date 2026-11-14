import { useMemo } from "react";
import type { LineageWidget, SummaryWidget } from "../model/types";
import { ACTIVE } from "../model/chain";
import { ancestors, lineageTree } from "../model/lineageTree";
import { useView, useWidget } from "../model/view";
import { marketThrough, plural } from "../lib/format";
import { useAtom } from "../state/atom";
import { useBacktest, type Loaded } from "../state/backtest";
import { requestFocus, useHovered } from "../state/linking";
import { notice, usePaperRuns } from "../state/paper";
import { select, useSelection } from "../state/selection";
import { useRunData } from "../state/runData";
import { viewStatus } from "../state/update";
import { useOnMarketPage, useOnRunsPage } from "../state/shell";
import { paperTab } from "../state/stage";
import { useShown } from "../state/shown";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { MarketImportStatus } from "../components/MarketImportStatus";
import { PaperStartStatus } from "../components/PaperStartStatus";
import { Tip } from "../components/Tip";
import { UpdateStatus } from "../components/UpdateStatus";
import { PublicCopyStatus } from "../components/About";
import { ResearchSyncStatus } from "../components/ResearchSync";
import { VersionLine } from "../components/VersionLine";

/** Where the stage the Runs page shows comes from. */
const SOURCE = { backtest: "", paper: " · 1m bars · Binance public data · Sandbox fills", live: " · native execution observations" } as const;
const EXECUTION: Record<string, string> = { bars: "1m bars", quotes: "aggTrades quotes" };
/** The backtest's: its daily series (a contract's daily bars on a contract's chart), the runtime image (by
 *  its end) and the last day of the line's market data, how it filled; or, in the failure colour, that its report is
 *  not served here. */
function backtestSource(l: Loaded | null, market: string | null, contract: boolean): { text: string; failed: boolean } {
  if (l?.kind === "absent") return { text: " · data not served by this IDE", failed: true };
  if (l?.kind !== "ready") return { text: "", failed: false };
  const { image, execution } = l.b, digest = image?.replace(/^sha256:/, "");
  return { text: [contract ? " · 1d bars" : " · 1d series", digest && `image …${digest.slice(-6)}`, market && `market ${marketThrough(market)}`, execution && (EXECUTION[execution] ?? execution)]
    .filter(Boolean).join(" · "), failed: false };
}

/** Where the stage the Runs page shows comes from, after its name. */
function StageSource({ className }: { className: string }) {
  const { line } = useView(), { stage, name } = useShown(), backtest = useBacktest();
  // The chart's view: the run's, else (a version with no paper run) a contract only while its backtest traded it.
  const tab = useAtom(paperTab), chart = useRunData()?.view ?? (backtest?.kind === "ready" && backtest.b.cycles.some((c) => c.symbol === tab) ? tab : null);
  const tested = backtestSource(stage === "backtest" ? backtest : null, line.market_day ?? null, !!chart && chart !== "equity");
  return stage && <span className={className}>{name}{SOURCE[stage]}<span className={tested.failed ? "text-fail-fg" : ""}>{tested.text}</span></span>;
}

const lineCounts = (s: SummaryWidget) => `${plural(s.versions, "version")} · ${plural(s.research_runs, "research run")} · ${s.masked_runs} ineligible`;

/** The window's bottom row, on the frame, as IntelliJ's: the path to the selected version (line ›
 *  ancestors › version, each step clickable) at the left, then on the Runs page where the stage it shows
 *  comes from, and the last notice; the version under the pointer, else the selected one, as its
 *  VersionLine and the line's counts at the right, after the public copy's fault (when it has one), the market
 *  import's state (when the server has its status) and the graph's update, and on the Runs page after the count of running paper runs
 *  missing data or protection. Before there is a view, why there is none takes the path's place on the Runs and
 *  Market pages (the editor says it otherwise). */
export function StatusBar() {
  const { line } = useView();
  const lineage = useWidget<LineageWidget>("lineage");
  const summary = useWidget<SummaryWidget>("summary");
  const tree = useMemo(() => (lineage ? lineageTree(lineage) : null), [lineage]);
  const hovered = useHovered();
  const selected = useSelection();
  const id = hovered && hovered.length > 1 ? null : hovered?.[0] ?? selected;
  const focus = lineage?.nodes.find((n) => n.id === id);
  const path = selected && tree ? [...ancestors(tree, selected), selected] : [];
  const said = useAtom(notice), status = useAtom(viewStatus);
  const runs = useOnRunsPage(), market = useOnMarketPage(), live = useShown().stage === "live" && runs;
  const gapped = (usePaperRuns()?.runs ?? []).filter((r) => ACTIVE.has(r.state) && (r.readings?.missing_bars ?? 0) + (r.readings?.protection_gaps ?? 0) > 0).length;
  return (
    <footer className="flex h-(--status-h) shrink-0 items-center gap-4 px-(--frame-inset) text-small text-fg-faint">
      {!live && !line.name && !status.busy && (runs || market) && <span role="status" className="min-w-0 truncate text-fg-muted">{status.text}</span>}
      {live && <span className="min-w-0 truncate">Execution runs independently of this page</span>}
      {!live && line.name && <Breadcrumbs items={[
        { id: "line", label: line.name, onSelect: () => requestFocus("") },
        ...path.map((v) => ({ id: v, label: v, onSelect: () => select(v, { reveal: true }) })),
      ]} />}
      {runs && <StageSource className="min-w-0 truncate text-fg-muted" />}
      {!live && <PaperStartStatus />}
      {!live && said && <Tip content={said.text} side="top"><span role="status" className={`min-w-0 truncate ${said.failed ? "text-fail-fg" : "text-fg-muted"}`}>{said.text}</span></Tip>}
      <span className="ml-auto flex shrink-0 items-center gap-4 pr-2">
        {runs && !live && gapped > 0 && <span className="text-misses-fg">{plural(gapped, "running paper run")} with missing bars or protection gaps</span>}
        <PublicCopyStatus />
        <MarketImportStatus />
        <ResearchSyncStatus />
        <UpdateStatus />
        {!live && (hovered && hovered.length > 1 ? <span className="text-fg-muted">{plural(hovered.length, "version")}</span>
          : focus && <VersionLine node={focus} targets={lineage?.targets ?? null} />)}
        {summary && <span>{lineCounts(summary)}</span>}
      </span>
    </footer>
  );
}
