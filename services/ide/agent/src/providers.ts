// The three providers: a language model for an agent's model, and the provider's own model list.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { Agent, Provider } from "./agents.ts";

export const DEFAULT_URL: Record<Provider, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
};

type Credentials = Pick<Agent, "provider" | "baseURL" | "key">;

export function languageModel(agent: Credentials, model: string): LanguageModel {
  const settings = { apiKey: agent.key, baseURL: agent.baseURL ?? DEFAULT_URL[agent.provider] };
  switch (agent.provider) {
    case "deepseek": return createDeepSeek(settings)(model);
    case "openai": return createOpenAI(settings)(model);
    case "anthropic": return createAnthropic(settings)(model);
  }
}

/** A provider's answer that was not a model list; `status` is its HTTP status (0 when unreachable). */
export class ProviderError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// OpenAI lists every model it serves; only the ones that chat are offered.
const OPENAI_CHAT = /^(gpt-|chatgpt-|o\d)/;
const OPENAI_NOT_CHAT = /(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct|codex)/;

/** The model ids the provider lists for this key, sorted. */
export async function listModels(agent: Credentials, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const base = (agent.baseURL ?? DEFAULT_URL[agent.provider]).replace(/\/+$/, "");
  const headers: Record<string, string> = agent.provider === "anthropic"
    ? { "x-api-key": agent.key, "anthropic-version": "2023-06-01" }
    : { authorization: `Bearer ${agent.key}` };
  let response: Response;
  try {
    response = await fetchImpl(`${base}/models${agent.provider === "anthropic" ? "?limit=1000" : ""}`,
      { headers, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new ProviderError(0, `${base} did not answer: ${(error as Error).message}`);
  }
  const text = await response.text();
  if (!response.ok) throw new ProviderError(response.status, `${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  let ids: string[];
  try {
    ids = (JSON.parse(text) as { data: { id: string }[] }).data.map((m) => m.id);
  } catch {
    throw new ProviderError(response.status, `the model list was not JSON: ${text.slice(0, 120)}`);
  }
  if (agent.provider === "openai") ids = ids.filter((id) => OPENAI_CHAT.test(id) && !OPENAI_NOT_CHAT.test(id));
  return ids.sort();
}
