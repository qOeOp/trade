// The configured agents: one provider's credentials and the models allowed from it, kept in
// agents.json in the data directory. The key never leaves this module except to the provider: the
// page sees only its last four characters. An agent is active while its last test passed with the
// same provider, URL, key and models it has now; changing any of them makes it untested again.
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJson, writeJson } from "./files.ts";

export const PROVIDERS = ["deepseek", "openai", "anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type Step = { name: "key" | "reply" | "tools"; model: string | null; ok: boolean; detail: string; ms: number };
export type Probe = { at: string; fingerprint: string; ok: boolean; steps: Step[]; models: string[] };
export type Agent = {
  id: string; name: string; provider: Provider; baseURL: string | null; key: string;
  models: string[]; defaultModel: string | null; probe: Probe | null;
};
export type Status = "active" | "untested" | "failed";
export type PublicAgent = Omit<Agent, "key"> & { keyHint: string; status: Status; usable: string[] };
export type AgentInput = { name: string; provider: Provider; baseURL: string | null; key: string; models: string[]; defaultModel: string | null };

/** What a test vouches for: changing any of these makes the agent untested. */
export function fingerprint(agent: Pick<Agent, "provider" | "baseURL" | "key" | "models">): string {
  const parts = [agent.provider, agent.baseURL ?? "", agent.key, [...agent.models].sort().join(",")];
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

export function status(agent: Agent): Status {
  if (!agent.probe || agent.probe.fingerprint !== fingerprint(agent)) return "untested";
  return agent.probe.ok ? "active" : "failed";
}

export function publicAgent(agent: Agent): PublicAgent {
  const { key, ...rest } = agent;
  const state = status(agent);
  return { ...rest, keyHint: `…${key.slice(-4)}`, status: state, usable: state === "active" ? agent.probe!.models : [] };
}

export class AgentStore {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "agents.json");
  }

  list(): Agent[] {
    return readJson<{ agents: Agent[] }>(this.path, { agents: [] }).agents;
  }

  get(id: string): Agent | undefined {
    return this.list().find((a) => a.id === id);
  }

  create(input: AgentInput): Agent {
    const agent: Agent = { id: randomUUID(), ...input, probe: null };
    this.write([...this.list(), agent]);
    return agent;
  }

  /** Replaces the given fields; an empty or absent key keeps the stored one. */
  update(id: string, change: Partial<AgentInput>): Agent | undefined {
    const agents = this.list();
    const index = agents.findIndex((a) => a.id === id);
    if (index < 0) return undefined;
    const { key, ...rest } = change;
    const agent = { ...agents[index], ...rest, ...(key ? { key } : {}) };
    if (agent.defaultModel && !agent.models.includes(agent.defaultModel)) agent.defaultModel = agent.models[0] ?? null;
    agents[index] = agent;
    this.write(agents);
    return agent;
  }

  setProbe(id: string, probe: Probe): Agent | undefined {
    const agents = this.list();
    const agent = agents.find((a) => a.id === id);
    if (!agent) return undefined;
    agent.probe = probe;
    this.write(agents);
    return agent;
  }

  remove(id: string): boolean {
    const agents = this.list();
    const kept = agents.filter((a) => a.id !== id);
    if (kept.length === agents.length) return false;
    this.write(kept);
    return true;
  }

  private write(agents: Agent[]): void {
    writeJson(this.path, { agents });
  }
}
