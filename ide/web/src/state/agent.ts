// The agent panel's state: whether the page's server has a chat service, the configured agents,
// the model chosen for the next message (kept in browser storage), which pane the panel shows, and
// the open thread's controls, registered by the chat runtime.
import { agentApi, type Agent, type Provider } from "../lib/agentApi";
import { atom, persistedAtom, useAtom } from "./atom";

export type Choice = { agent: string; model: string };
export type ModelOption = Choice & { name: string; provider: Provider };

export const agentService = atom<"checking" | "absent" | "present">("checking");
export const agents = atom<readonly Agent[]>([]);
const isChoice = (v: unknown): v is Choice | null =>
  v === null || (typeof (v as Choice)?.agent === "string" && typeof (v as Choice)?.model === "string");
export const chosen = persistedAtom<Choice | null>("rg-agent-model@1", null, isChoice);
export const agentPane = atom<"chat" | "history" | "settings">("chat");
export const chatControl = atom<{ newThread: () => void } | null>(null);

export const useAgentService = () => useAtom(agentService);
export const useAgents = () => useAtom(agents);
export const useChosen = () => useAtom(chosen);
export const useAgentPane = () => useAtom(agentPane);

/** Every model of every active agent that passed its test, in the agents' order. */
export const modelOptions = (list: readonly Agent[]): ModelOption[] =>
  list.filter((a) => a.status === "active").flatMap((a) => a.usable.map((model) => ({ agent: a.id, model, name: a.name, provider: a.provider })));

/** The chosen model while it is still usable, else the first active agent's default (or first) model. */
export function currentChoice(list: readonly Agent[], choice: Choice | null): ModelOption | null {
  const options = modelOptions(list);
  const kept = choice && options.find((o) => o.agent === choice.agent && o.model === choice.model);
  if (kept) return kept;
  const first = list.find((a) => a.status === "active");
  return options.find((o) => o.agent === first?.id && o.model === first?.defaultModel) ?? options[0] ?? null;
}

export async function refreshAgents(): Promise<void> {
  agents.set(await agentApi<Agent[]>("/agents"));
}

/** Asks the page's server for the chat service once; a page rendered to a file never has one. */
export async function detectAgentService(): Promise<void> {
  try {
    await agentApi("/health");
    agentService.set("present");
    await refreshAgents();
  } catch {
    agentService.set("absent");
  }
}

export function replaceAgent(agent: Agent): void {
  const list = agents.get();
  agents.set(list.some((a) => a.id === agent.id) ? list.map((a) => (a.id === agent.id ? agent : a)) : [...list, agent]);
}
