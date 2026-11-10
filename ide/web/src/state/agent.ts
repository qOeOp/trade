// The agent panel's state: whether the page's server has a chat service, the configured agents,
// the model chosen for the next message (kept in browser storage), which pane the panel shows, and
// the open thread's controls, registered by the chat runtime.
import { agentApi, type Agent, type Provider } from "../lib/agentApi";
import { whileVisible } from "../lib/whileVisible";
import { atom, persistedAtom, useAtom } from "./atom";

type Choice = { agent: string; model: string };
export type ModelOption = Choice & { name: string; provider: Provider };

/** "absent" when the server has no chat service, so the page has no Agent window; "offline" while one does not answer. */
export const agentService = atom<"checking" | "absent" | "offline" | "present">("checking");
const RETRY_MS = 30_000;
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

/** Asks the page's server for the chat service, and while it does not answer (a restart, a release switching over)
 *  again every 30 s while the page shows, so the Agent window comes back without a reload. Only a 404 says there is none. */
export async function detectAgentService(): Promise<void> {
  const ask = async () => {
    const health = await fetch("/api/agent/health", { cache: "no-store" }).catch(() => null);
    if (health?.status === 404) return agentService.set("absent");
    const listed = health?.ok && await refreshAgents().then(() => true, () => false);
    agentService.set(listed ? "present" : "offline");
  };
  await ask();
  if (agentService.get() === "offline") whileVisible(() => { if (agentService.get() === "offline") void ask(); }, RETRY_MS);
}

export function replaceAgent(agent: Agent): void {
  const list = agents.get();
  agents.set(list.some((a) => a.id === agent.id) ? list.map((a) => (a.id === agent.id ? agent : a)) : [...list, agent]);
}
