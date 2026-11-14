// The chat service (ide/agent) under /api/agent, reached through the page's own server. Its
// refusals are { code, message }, as the product's are.
import { serviceApi } from "./transport";

export const PROVIDERS = ["deepseek", "openai", "anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_LABEL: Record<Provider, string> = { deepseek: "DeepSeek", openai: "OpenAI", anthropic: "Anthropic" };

export type Step = { name: "key" | "reply" | "tools"; model: string | null; ok: boolean; detail: string; ms: number };
export type AgentStatus = "active" | "untested" | "failed";
export type Agent = {
  id: string; name: string; provider: Provider; baseURL: string | null; models: string[]; defaultModel: string | null;
  keyHint: string; status: AgentStatus; usable: string[];
  probe: { at: string; ok: boolean; steps: Step[]; models: string[] } | null;
};

/** One JSON request to the chat service; throws its refusal as an ApiError. */
export const agentApi = <T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> =>
  serviceApi<T>("AGENT", `/api/agent${path}`, init);
