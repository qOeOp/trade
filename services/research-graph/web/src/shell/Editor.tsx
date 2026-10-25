import type { LineageWidget, SourcesWidget } from "../model/types";
import type { IconName } from "../icons/registry";
import { useWidget } from "../model/view";
import { activateTab, closeTab, parseTab, useEditors, type TabKind } from "../state/editors";
import { useShell } from "../state/shell";
import { EditorTabStrip } from "../components/EditorTabStrip";
import { RENDERERS } from "../widgets/registry";
import { SourceBar, SourceBody } from "../widgets/source/SourceTab";
import { Island } from "./Island";

const TAB_ICON: Record<TabKind, IconName> = { source: "file.python", diff: "diff" };
const LABEL: Record<TabKind, (id: string) => string> = { source: (id) => `${id}.py`, diff: (id) => `${id}.py vs parent` };

/** The editor island follows the left tool window last chosen, as the views of one IDE window do:
 *  with Versions it shows the lineage, with Sources the open files in tabs (a version's source, or its
 *  change from its parent). The lineage stays mounted while files show, so its view is kept. */
export function Editor() {
  const lineage = useWidget<LineageWidget>("lineage/2");
  const sources = useWidget<SourcesWidget>("sources/1");
  const { tabs, active } = useEditors();
  const files = useShell().last.left === "sources";
  const Lineage = RENDERERS.lineage.Component;
  const shown = files && active ? parseTab(active) : null;
  const code = shown && { id: shown.id, diff: shown.kind === "diff", widget: sources };
  const strip = files && tabs.length > 0 && (
    <EditorTabStrip active={active ?? ""} onActivate={activateTab} onClose={closeTab}
                    tabs={tabs.map((id) => {
                      const tab = parseTab(id);
                      return { id, label: LABEL[tab.kind](tab.id), icon: TAB_ICON[tab.kind], closable: true };
                    })} />
  );
  return (
    <Island id="editor" header={<>{strip}{code && <SourceBar {...code} />}</>}>
      <div className={files ? "hidden" : "h-full"}>{lineage && <Lineage widget={lineage} />}</div>
      {code && <SourceBody key={active} {...code} />}
      {files && !code && <p className="grid h-full place-items-center text-dense text-fg-faint">Double-click a version to open its source</p>}
    </Island>
  );
}
