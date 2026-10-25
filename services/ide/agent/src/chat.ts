// One chat turn: the thread's messages to the chosen agent's model with the product's read-only
// tools, streamed back as AI SDK UI message chunks for assistant-ui. The text is cut into words
// (Chinese by its own word boundaries) and sent at an even pace: the page shows it as it arrives,
// which is the typewriter effect. Each answer carries the agent and model that wrote it.
import { APICallError, convertToModelMessages, smoothStream, stepCountIs, streamText, type LanguageModel, type ToolSet, type UIMessage } from "ai";
import { status, type Agent, type AgentStore } from "./agents.ts";

export type Context = { version?: string | null; line?: string | null; ledger_commit?: string | null };
export type ChatRequest = { messages: UIMessage[]; agent: string; model: string; context?: Context };
export type Metadata = { agent: string; provider: string; model: string };

export const MAX_STEPS = 12;
const PACE = new Intl.Segmenter("zh", { granularity: "word" });

const SYSTEM = `You are the assistant in the trade IDE, a workbench for crypto perpetual strategy research.
The research ledger (a public Dolt database) records research lines with the user's targets (maximum
drawdown, minimum annual return), strategy candidates as ID@N versions with their complete source,
registrations, trials (native replays) with sealed readings, judgments and eligibility. A market
database holds Binance market data.

You can only read, through your tools, which run the product's read-only commands.
- Every number, name and fact you state about the research comes from a tool result in this
  conversation. If you have not looked it up, look it up or say you have not. Never invent trial
  ids, versions or readings.
- You cannot change anything: no replays, no ledger writes, no targets. When asked, name the product
  command the user or their research agent would run, and say you cannot run it.
- Start from research_state for the current line. Use ledger_sql with SHOW TABLES and DESCRIBE before
  writing a query.
- Answer in the user's language, briefly. Write percentages with two decimals. Refer to versions as
  ID@N, so the page can link them.`;

function system(context: Context | undefined): string {
  const seen = [
    context?.version && `the selected version is ${context.version}`,
    context?.line && `the line is ${context.line}`,
    context?.ledger_commit && `the page shows ledger commit ${context.ledger_commit}`,
  ].filter(Boolean);
  return seen.length ? `${SYSTEM}\n\nOn the page: ${seen.join("; ")}.` : SYSTEM;
}

export type ChatDeps = { model: (agent: Agent, model: string) => LanguageModel; tools: ToolSet; store: AgentStore; delayInMs?: number | null };

/** A refusal before any model call, as { code, message } with an HTTP status. */
export class ChatRefusal extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function chat(request: ChatRequest, deps: ChatDeps, abortSignal?: AbortSignal): Promise<Response> {
  const agent = deps.store.get(request.agent);
  if (!agent) throw new ChatRefusal(404, "AGENT_UNKNOWN", `no agent ${request.agent}`);
  if (status(agent) !== "active") throw new ChatRefusal(409, "AGENT_INACTIVE", `${agent.name} has not passed its test`);
  if (!agent.probe!.models.includes(request.model)) throw new ChatRefusal(409, "MODEL_UNTESTED", `${request.model} did not pass ${agent.name}'s test`);
  const metadata: Metadata = { agent: agent.name, provider: agent.provider, model: request.model };
  const result = streamText({
    model: deps.model(agent, request.model),
    system: system(request.context),
    messages: await convertToModelMessages(request.messages, { tools: deps.tools }),
    tools: deps.tools,
    stopWhen: stepCountIs(MAX_STEPS),
    experimental_transform: smoothStream({ delayInMs: deps.delayInMs === undefined ? 12 : deps.delayInMs, chunking: PACE }),
    abortSignal,
    onError: ({ error }) => {
      // A key the provider now refuses: the agent is no longer active until it is tested again.
      if (APICallError.isInstance(error) && (error.statusCode === 401 || error.statusCode === 403)) {
        deps.store.setProbe(agent.id, { ...agent.probe!, ok: false, models: [], at: new Date().toISOString(),
          steps: [{ name: "key", model: request.model, ok: false, detail: `the provider refused the key while chatting: ${error.statusCode}`, ms: 0 }] });
      }
    },
  });
  return result.toUIMessageStreamResponse({
    originalMessages: request.messages,
    messageMetadata: ({ part }) => (part.type === "start" ? metadata : undefined),
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
}
