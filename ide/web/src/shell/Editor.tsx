import type { LineageWidget, SourcesWidget } from "../model/types";
import { useView, useWidget } from "../model/view";
import { useAtom } from "../state/atom";
import { viewStatus } from "../state/update";
import { useOpenFile } from "../state/editors";
import { useShell } from "../state/shell";
import { Waiting } from "../ui/Waiting";
import { RENDERERS } from "../widgets/registry";
import { HistoryPage } from "../widgets/history/HistoryPage";
import { MarketPage } from "../widgets/market/MarketPage";
import { RunsPage } from "../widgets/paper/RunsPage";
import { SourceBar, SourceBody } from "../widgets/source/SourceView";
import { Island } from "./Island";

/** The editor island shows the shell's page: Market, Runs, History, or the research view, which follows
 *  the left tool window last chosen, as the views of one IDE window do: with Versions it shows the
 *  lineage, with Sources the open file (a version's source, or its change from its parent) under a
 *  header naming it. A left tool window opened on another page leaves that page in place. The
 *  lineage stays mounted while another view shows, so its view is kept. Before there is a view, Versions and
 *  Sources have nothing to show, so the editor says why. */
export function Editor() {
  const lineage = useWidget<LineageWidget>("lineage");
  const sources = useWidget<SourcesWidget>("sources");
  const { id, diff, pinned } = useOpenFile();
  const { page, last } = useShell();
  const files = page === "research" && last.left === "sources", runs = page === "runs", market = page === "market", history = page === "history";
  const Lineage = RENDERERS.lineage.Component;
  const code = files && id ? { id, diff, pinned, widget: sources } : null;
  const none = !useView().line.name, status = useAtom(viewStatus);
  return (
    <Island id="editor" header={code && <SourceBar {...code} />}>
      {lineage && <div className={files || runs || market || history ? "hidden" : "h-full"}><Lineage widget={lineage} /></div>}
      {market && <MarketPage />}
      {runs && <RunsPage />}
      {history && <HistoryPage />}
      {code && <SourceBody key={id} {...code} />}
      {none && !runs && !market && !history && <Waiting {...status} />}
      {!none && files && !code && <p className="grid h-full place-items-center text-dense text-fg-faint">Click a version to open its source</p>}
    </Island>
  );
}
