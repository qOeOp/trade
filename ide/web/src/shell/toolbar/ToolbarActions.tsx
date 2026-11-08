import { ActionGroup } from "../../components/ActionGroup";
import { useOnRunsPage } from "../../state/shell";
import { useRunActions } from "./RunsWidget";

/** The main toolbar's action group, left of search: on the Runs page the selected stage's actions, each
 *  with its words beside its icon. DoltHub's sync is in the ledger widget's menu. */
export function ToolbarActions() {
  const runs = useOnRunsPage(), actions = useRunActions();
  return runs && actions ? <ActionGroup className="ml-4 mr-3">{actions}</ActionGroup> : null;
}
