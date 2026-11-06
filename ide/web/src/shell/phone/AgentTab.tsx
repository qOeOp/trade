import { IconButton } from "../../components/IconButton";
import { PhoneBar } from "../../components/PhoneBar";
import { agentPane, chatControl, useAgentPane } from "../../state/agent";
import { ChatPane } from "../agent/ChatPane";
import { HistoryPane } from "../agent/HistoryPane";

/** The Agent tab: the Agent window's chat and saved chats, its header's New chat and Chats. Its agents and their
 *  API keys are set in the desktop layout. */
export function AgentTab() {
  const pane = useAgentPane(), history = pane === "history";
  return (
    <>
      <PhoneBar>
        <h1 className="px-2 text-dense font-semibold">Agent</h1>
        <span className="ml-auto flex items-center">
          <IconButton frame icon="new-chat" label="New chat" onClick={() => { chatControl.get()?.newThread(); agentPane.set("chat"); }} />
          <IconButton frame icon="history" label="Chats" active={history} onClick={() => agentPane.set(history ? "chat" : "history")} />
        </span>
      </PhoneBar>
      <div className="min-h-0 flex-1 overflow-y-auto">{history ? <HistoryPane /> : <ChatPane />}</div>
    </>
  );
}
