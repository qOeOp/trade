import { IconButton } from "../../components/IconButton";
import { PhoneBar } from "../../components/PhoneBar";
import { agentPane, chatControl, useAgentPane } from "../../state/agent";
import { ChatPane } from "../agent/ChatPane";
import { HistoryPane } from "../agent/HistoryPane";
import { SettingsPane } from "../agent/SettingsPane";

/** The Agent tab: the Agent window's chat, saved chats and agents, with its header's three buttons. */
export function AgentTab() {
  const pane = useAgentPane(), toggle = (p: "history" | "settings") => agentPane.set(pane === p ? "chat" : p);
  return (
    <>
      <PhoneBar>
        <h1 className="px-2 text-dense font-semibold">Agent</h1>
        <span className="ml-auto flex items-center">
          <IconButton frame icon="new-chat" label="New chat" onClick={() => { chatControl.get()?.newThread(); agentPane.set("chat"); }} />
          <IconButton frame icon="history" label="Chats" active={pane === "history"} onClick={() => toggle("history")} />
          <IconButton frame icon="settings" label="Agents" active={pane === "settings"} onClick={() => toggle("settings")} />
        </span>
      </PhoneBar>
      <div className="min-h-0 flex-1 overflow-y-auto">{pane === "settings" ? <SettingsPane /> : pane === "history" ? <HistoryPane /> : <ChatPane />}</div>
    </>
  );
}
