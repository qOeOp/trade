// The chat service (ide/agent) under /api/agent, reached through the page's own server. Its
// refusals are { code, message }, as the product's are.
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
export type AgentInput = { name: string; provider: Provider; baseURL: string | null; key: string; models: string[]; defaultModel: string | null };

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** One JSON request to the chat service; throws its refusal as an ApiError. */
export async function agentApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/agent${path}`, {
      method: init.method ?? "GET", cache: "no-store",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new ApiError("AGENT_UNAVAILABLE", String(error));
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({ code: "AGENT_FAILED", message: `${response.status} ${response.statusText}` }));
  if (!response.ok) throw new ApiError(body.code ?? "AGENT_FAILED", body.message ?? "");
  return body as T;
}
