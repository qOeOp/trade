import { useAgentPane } from "../../state/agent";
import { ChatPane } from "./ChatPane";
import { HistoryPane } from "./HistoryPane";
import { SettingsPane } from "./SettingsPane";

/** The Agent tool window: the open thread, the saved threads or the agents, switched from its header. */
export function AgentWindow() {
  const pane = useAgentPane();
  if (pane === "settings") return <SettingsPane />;
  if (pane === "history") return <HistoryPane />;
  return <ChatPane />;
}
