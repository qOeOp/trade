// The test an agent must pass to become active, in three steps: the key lists models (key and URL
// work), each chosen model replies, and each calls a tool and uses its result. Every product query
// goes through tools, so a model that cannot call one is left out of the usable models.
import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { fingerprint, type Agent, type Probe, type Step } from "./agents.ts";
import { languageModel, listModels } from "./providers.ts";

export type ProbeDeps = { list: typeof listModels; model: (agent: Agent, model: string) => LanguageModel };
const DEFAULTS: ProbeDeps = { list: listModels, model: languageModel };
const TOKEN = "pong-7319";
const TIMEOUT = 90_000;

async function step(name: Step["name"], model: string | null, run: () => Promise<string>): Promise<Step> {
  const started = performance.now();
  try {
    const detail = await run();
    return { name, model, ok: true, detail, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { name, model, ok: false, detail: (error as Error).message.slice(0, 400), ms: Math.round(performance.now() - started) };
  }
}

const ping = tool({
  description: "Returns a token. Call it exactly once.",
  inputSchema: z.object({}),
  execute: async () => ({ token: TOKEN }),
});

export async function probe(agent: Agent, deps: ProbeDeps = DEFAULTS): Promise<Probe> {
  const steps: Step[] = [];
  const usable: string[] = [];
  const key = await step("key", null, async () => `${(await deps.list(agent)).length} models listed`);
  steps.push(key);
  if (key.ok) {
    for (const id of agent.models) {
      const model = deps.model(agent, id);
      const reply = await step("reply", id, async () => {
        const { text } = await generateText({ model, prompt: "Reply with the single word: ready", abortSignal: AbortSignal.timeout(TIMEOUT) });
        if (!text.trim()) throw new Error("the model answered with no text");
        return text.trim().slice(0, 60);
      });
      steps.push(reply);
      if (!reply.ok) continue;
      const tools = await step("tools", id, async () => {
        const result = await generateText({
          model, tools: { ping }, stopWhen: stepCountIs(3), abortSignal: AbortSignal.timeout(TIMEOUT),
          prompt: "Call the ping tool once, then reply with the token it returned and nothing else.",
        });
        if (!result.steps.some((s) => s.toolCalls.some((c) => c.toolName === "ping"))) throw new Error("the model did not call the tool");
        if (!result.text.includes(TOKEN)) throw new Error(`the model called the tool but did not use its result: ${result.text.slice(0, 80)}`);
        return "called the tool and used its result";
      });
      steps.push(tools);
      if (tools.ok) usable.push(id);
    }
    if (agent.models.length === 0) steps.push({ name: "reply", model: null, ok: false, detail: "no model is chosen", ms: 0 });
  }
  return { at: new Date().toISOString(), fingerprint: fingerprint(agent), ok: key.ok && usable.length > 0, steps, models: usable };
}
