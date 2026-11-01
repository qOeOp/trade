import type { LineageWidget, SourcesWidget } from "../model/types";
import { useWidget } from "../model/view";
import { useOpenFile } from "../state/editors";
import { useShell } from "../state/shell";
import { RENDERERS } from "../widgets/registry";
import { MarketPage } from "../widgets/market/MarketPage";
import { RunsPage } from "../widgets/paper/RunsPage";
import { SourceBar, SourceBody } from "../widgets/source/SourceView";
import { Island } from "./Island";

/** The editor island follows the left tool window last chosen, as the views of one IDE window do:
 *  with Versions it shows the lineage, with Sources the open file (a version's source, or its change
 *  from its parent) under a header naming it, and with Market or Runs (no left tool window) that page. The
 *  lineage stays mounted while another view shows, so its view is kept. */
export function Editor() {
  const lineage = useWidget<LineageWidget>("lineage@2");
  const sources = useWidget<SourcesWidget>("sources@1");
  const { id, diff } = useOpenFile();
  const left = useShell().last.left;
  const files = left === "sources", runs = left === "runs", market = left === "market";
  const Lineage = RENDERERS.lineage.Component;
  const code = files && id ? { id, diff, widget: sources } : null;
  return (
    <Island id="editor" header={code && <SourceBar {...code} />}>
      <div className={files || runs || market ? "hidden" : "h-full"}>{lineage && <Lineage widget={lineage} />}</div>
      {market && <MarketPage />}
      {runs && <RunsPage />}
      {code && <SourceBody key={id} {...code} />}
      {files && !code && <p className="grid h-full place-items-center text-dense text-fg-faint">Double-click a version to open its source</p>}
    </Island>
  );
}
