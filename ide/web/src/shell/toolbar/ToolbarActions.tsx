import { ActionGroup, ActionRule } from "../../components/ActionGroup";
import { ResearchSync, researchSyncEnabled } from "../../components/ResearchSync";
import { useOnRunsPage } from "../../state/shell";
import { useRunActions } from "./RunsWidget";

/** The main toolbar's action group, left of search: ⟳ Sync DoltHub where this IDE follows DoltHub, and on the
 *  Runs page the selected stage's actions, each with its words beside its icon. */
export function ToolbarActions() {
  const sync = researchSyncEnabled(), runs = useOnRunsPage(), actions = useRunActions();
  const run = runs ? actions : null;
  if (!sync && !run) return null;
  return <ActionGroup className="ml-4 mr-3">{sync && <ResearchSync />}{sync && run && <ActionRule />}{run}</ActionGroup>;
}
