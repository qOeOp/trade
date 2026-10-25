import { useState } from "react";
import { AgentCard } from "../../components/chat/AgentCard";
import { FormButton } from "../../components/chat/Field";
import { agentApi, ApiError, type Agent } from "../../lib/agentApi";
import { agents, refreshAgents, replaceAgent, useAgents } from "../../state/agent";
import { AgentEditor } from "./AgentEditor";

// The configured agents and the editor. Testing runs the chat service's three steps (key, reply,
// tools) against every chosen model; an agent is active once at least one model passes all three.
export function SettingsPane() {
  const list = useAgents();
  const [editing, setEditing] = useState<Agent | "new" | null>(list.length ? null : "new");
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const test = async (agent: Agent) => {
    setTesting(agent.id); setError(null);
    try { replaceAgent(await agentApi<Agent>(`/agents/${agent.id}/test`, { method: "POST", body: {} })); }
    catch (e) { setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e)); }
    finally { setTesting(null); }
  };
  const remove = async (agent: Agent) => {
    if (!window.confirm(`Delete ${agent.name} and its stored key?`)) return;
    await agentApi(`/agents/${agent.id}`, { method: "DELETE" });
    agents.set(agents.get().filter((a) => a.id !== agent.id));
  };
  const done = (saved: Agent | null) => {
    setEditing(null);
    void refreshAgents();
    if (saved && saved.status === "untested" && saved.models.length) void test(saved);
  };

  return (
    <div className="space-y-2 p-3">
      {list.map((agent) => (editing !== "new" && editing?.id === agent.id
        ? <AgentEditor key={agent.id} agent={agent} onDone={done} />
        : <AgentCard key={agent.id} agent={agent} testing={testing === agent.id} onTest={() => void test(agent)}
                     onEdit={() => setEditing(agent)} onDelete={() => void remove(agent)} />))}
      {editing === "new" ? <AgentEditor agent={null} onDone={done} />
        : <FormButton icon="plus" onClick={() => setEditing("new")}>Add an agent</FormButton>}
      {error && <p className="text-dense break-words text-fail">{error}</p>}
      <p className="pt-2 text-small text-fg-faint">
        Keys stay in the chat service's data directory on this machine (0600). They are never written to the ledger, which is public, and never sent back to this page.
      </p>
    </div>
  );
}
