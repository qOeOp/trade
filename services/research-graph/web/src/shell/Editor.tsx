import type { DetailWidget, LineageWidget } from "../model/types";
import { useView, useWidget } from "../model/view";
import { activateTab, closeTab, LINEAGE_TAB, useEditors } from "../state/editors";
import { EditorTabStrip } from "../components/EditorTabStrip";
import { VersionDetail } from "../widgets/detail/Detail";
import { RENDERERS } from "../widgets/registry";
import { Island } from "./Island";

/** The editor island: tabs at the top (the lineage always, versions opened by double-click or the
 *  context menu); the lineage stays mounted while a version tab shows, so its view is kept. */
export function Editor() {
  const { targets } = useView();
  const lineage = useWidget<LineageWidget>("lineage/2");
  const detail = useWidget<DetailWidget>("candidate-detail/1");
  const { tabs, active } = useEditors();
  const Lineage = RENDERERS.lineage.Component;
  const version = active === LINEAGE_TAB ? null : detail?.items.find((c) => c.id === active);
  return (
    <Island id="editor" header={
      <EditorTabStrip active={active} onActivate={activateTab} onClose={closeTab}
                      tabs={tabs.map((id) => id === LINEAGE_TAB
                        ? { id, label: RENDERERS.lineage.title, icon: "lineage" as const, closable: false }
                        : { id, label: id, icon: "tool.inspector" as const, closable: true })} />}>
      <div className={active === LINEAGE_TAB ? "h-full" : "hidden"}>{lineage && <Lineage widget={lineage} />}</div>
      {version && <div className="mx-auto max-w-3xl py-2"><VersionDetail c={version} targets={targets} /></div>}
    </Island>
  );
}
