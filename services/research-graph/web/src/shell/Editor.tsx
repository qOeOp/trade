import type { DetailWidget, LineageWidget, SourcesWidget } from "../model/types";
import type { IconName } from "../icons/registry";
import { useView, useWidget } from "../model/view";
import { activateTab, closeTab, LINEAGE_TAB, parseTab, useEditors } from "../state/editors";
import { EditorTabStrip } from "../components/EditorTabStrip";
import { VersionDetail } from "../widgets/detail/Detail";
import { RENDERERS } from "../widgets/registry";
import { SourceBar, SourceBody } from "../widgets/source/SourceTab";
import { Island } from "./Island";

const TAB_ICON: Record<"detail" | "source" | "diff", IconName> = { detail: "tool.inspector", source: "file.python", diff: "diff" };
const LABEL: Record<"detail" | "source" | "diff", (id: string) => string> = { detail: (id) => id, source: (id) => `${id}.py`, diff: (id) => `${id}.py vs parent` };

/** The editor island: the lineage, and versions opened in tabs: a version's detail (double-click or the
 *  context menu), its source and its change from its parent (from Sources or the context menu). The tab
 *  strip shows only once a version tab is open (a lone lineage tab says nothing); the lineage stays
 *  mounted while another tab shows, so its view is kept. */
export function Editor() {
  const { targets } = useView();
  const lineage = useWidget<LineageWidget>("lineage@2");
  const detail = useWidget<DetailWidget>("candidate-detail@1");
  const sources = useWidget<SourcesWidget>("sources@1");
  const { tabs, active } = useEditors();
  const Lineage = RENDERERS.lineage.Component;
  const shown = parseTab(active);
  const version = shown.kind === "detail" ? detail?.items.find((c) => c.id === shown.id) : null;
  const code = shown.kind === "source" || shown.kind === "diff" ? { id: shown.id, diff: shown.kind === "diff", widget: sources } : null;
  const strip = tabs.length > 1 && (
    <EditorTabStrip active={active} onActivate={activateTab} onClose={closeTab}
                    tabs={tabs.map((id) => {
                      const tab = parseTab(id);
                      return tab.kind === "lineage"
                        ? { id, label: RENDERERS.lineage.title, icon: "lineage" as const, closable: false }
                        : { id, label: LABEL[tab.kind](tab.id), icon: TAB_ICON[tab.kind], closable: true };
                    })} />
  );
  return (
    <Island id="editor" header={<>{strip}{code && <SourceBar {...code} />}</>}>
      <div className={active === LINEAGE_TAB ? "h-full" : "hidden"}>{lineage && <Lineage widget={lineage} />}</div>
      {version && <div className="mx-auto max-w-6xl px-2 py-2"><VersionDetail c={version} targets={targets} /></div>}
      {code && <SourceBody key={active} {...code} />}
    </Island>
  );
}
