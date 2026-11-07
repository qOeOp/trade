import { ActionGroup, ActionRule } from "../../components/ActionGroup";
import { ResearchSync, researchSyncEnabled } from "../../components/ResearchSync";
import { useOnRunsPage } from "../../state/shell";
import { usePaperRunActions } from "./PaperRunWidget";

/** The main toolbar's action group, left of search: ⟳ Sync DoltHub where this IDE follows DoltHub, and on the
 *  Runs page the shown run's ■ or ▶ and Delete, each with its words beside its icon. */
export function ToolbarActions() {
  const sync = researchSyncEnabled(), runs = useOnRunsPage(), paper = usePaperRunActions();
  const run = runs ? paper : null;
  if (!sync && !run) return null;
  return <ActionGroup className="mr-2">{sync && <ResearchSync />}{sync && run && <ActionRule />}{run}</ActionGroup>;
}
