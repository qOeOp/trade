import type { LineageWidget, SourcesWidget } from "../model/types";
import { useView, useWidget } from "../model/view";
import { useAtom } from "../state/atom";
import { viewStatus } from "../state/update";
import { useOpenFile } from "../state/editors";
import { useShell } from "../state/shell";
import { Waiting } from "../components/Waiting";
import { RENDERERS } from "../widgets/registry";
import { HistoryPage } from "../widgets/history/HistoryPage";
import { MarketPage } from "../widgets/market/MarketPage";
import { RunsPage } from "../widgets/paper/RunsPage";
import { SourceBar, SourceBody } from "../widgets/source/SourceView";
import { Island } from "./Island";

/** The editor island follows the left tool window last chosen, as the views of one IDE window do:
 *  with Versions it shows the lineage, with Sources the open file (a version's source, or its change
 *  from its parent) under a header naming it, and with Market, Runs or History (no left tool window) that page. The
 *  lineage stays mounted while another view shows, so its view is kept. Before there is a view, Versions and
 *  Sources have nothing to show, so the editor says why. */
export function Editor() {
  const lineage = useWidget<LineageWidget>("lineage");
  const sources = useWidget<SourcesWidget>("sources");
  const { id, diff } = useOpenFile();
  const left = useShell().last.left;
  const files = left === "sources", runs = left === "runs", market = left === "market", history = left === "history";
  const Lineage = RENDERERS.lineage.Component;
  const code = files && id ? { id, diff, widget: sources } : null;
  const none = !useView().line.bundle, status = useAtom(viewStatus);
  return (
    <Island id="editor" header={code && <SourceBar {...code} />}>
      {lineage && <div className={files || runs || market || history ? "hidden" : "h-full"}><Lineage widget={lineage} /></div>}
      {market && <MarketPage />}
      {runs && <RunsPage />}
      {history && <HistoryPage />}
      {code && <SourceBody key={id} {...code} />}
      {none && !runs && !market && !history && <Waiting {...status} />}
      {!none && files && !code && <p className="grid h-full place-items-center text-dense text-fg-faint">Double-click a version to open its source</p>}
    </Island>
  );
}
