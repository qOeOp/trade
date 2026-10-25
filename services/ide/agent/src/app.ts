// The chat service's HTTP interface under /api/agent. The page reaches it through `ide.py serve
// --agent=URL`, which checks Host and cross-site requests first; this service checks them again,
// since on a workstation its own port is reachable too: only its own Host, never a cross-site
// request, and every POST is JSON (a cross-origin JSON post needs a preflight, and no CORS header
// is ever sent). Errors are { code, message }, as the product's refusals are.
import { Hono, type Context as HonoContext } from "hono";
import { z } from "zod";
import { PROVIDERS, publicAgent, type AgentStore } from "./agents.ts";
import { chat, ChatRefusal, type ChatDeps } from "./chat.ts";
import { probe, type ProbeDeps } from "./probe.ts";
import { ProviderError } from "./providers.ts";
import type { ThreadStore } from "./threads.ts";

export type Deps = { agents: AgentStore; threads: ThreadStore; hosts: ReadonlySet<string>; chat: Omit<ChatDeps, "store">; probe: ProbeDeps };

const url = z.string().url().refine((u) => /^https?:\/\//.test(u), "http or https").nullable();
const agentInput = z.object({
  name: z.string().trim().min(1).max(60),
  provider: z.enum(PROVIDERS),
  baseURL: url.default(null),
  key: z.string().trim().min(8).max(400),
  models: z.array(z.string().min(1).max(120)).max(40).default([]),
  defaultModel: z.string().max(120).nullable().default(null),
});
const agentChange = agentInput.partial().extend({ key: z.string().trim().max(400).optional() });
const chatInput = z.object({
  messages: z.array(z.any()).min(1),
  agent: z.string().min(1),
  model: z.string().min(1),
  context: z.object({ version: z.string().nullish(), line: z.string().nullish(), ledger_commit: z.string().nullish() }).optional(),
});
const row = z.object({ id: z.string().min(1).max(200), parent_id: z.string().max(200).nullable(), format: z.string().max(60), content: z.unknown() });
const threadChange = z.object({ title: z.string().max(200).optional(), status: z.enum(["regular", "archived"]).optional() });

const refuse = (c: HonoContext, status: number, code: string, message: string) =>
  c.json({ code, message }, status as 400);

async function body<T>(c: HonoContext, schema: z.ZodType<T>): Promise<T | Response> {
  let value: unknown;
  try { value = await c.req.json(); } catch { return refuse(c, 400, "BAD_REQUEST", "the body is not JSON"); }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : refuse(c, 400, "BAD_REQUEST", z.prettifyError(parsed.error));
}

export function app(deps: Deps): Hono {
  const api = new Hono().basePath("/api/agent");

  api.use("*", async (c, next) => {
    if (!deps.hosts.has(c.req.header("host") ?? "") || c.req.header("sec-fetch-site") === "cross-site")
      return refuse(c, 403, "FORBIDDEN", "requests come from the page itself");
    if (c.req.method === "POST" && !(c.req.header("content-type") ?? "").startsWith("application/json"))
      return refuse(c, 415, "BAD_REQUEST", "the body must be application/json");
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
  });

  api.get("/health", (c) => c.json({ ok: true }));

  // Agents
  api.get("/agents", (c) => c.json(deps.agents.list().map(publicAgent)));
  api.post("/agents", async (c) => {
    const input = await body(c, agentInput);
    return input instanceof Response ? input : c.json(publicAgent(deps.agents.create(input)), 201);
  });
  api.put("/agents/:id", async (c) => {
    const change = await body(c, agentChange);
    if (change instanceof Response) return change;
    const agent = deps.agents.update(c.req.param("id"), change);
    return agent ? c.json(publicAgent(agent)) : refuse(c, 404, "AGENT_UNKNOWN", c.req.param("id"));
  });
  api.delete("/agents/:id", (c) => (deps.agents.remove(c.req.param("id")) ? c.body(null, 204) : refuse(c, 404, "AGENT_UNKNOWN", c.req.param("id"))));
  api.post("/agents/:id/models", async (c) => {
    const agent = deps.agents.get(c.req.param("id"));
    if (!agent) return refuse(c, 404, "AGENT_UNKNOWN", c.req.param("id"));
    try {
      return c.json({ models: await deps.probe.list(agent) });
    } catch (error) {
      return refuse(c, 502, "PROVIDER_REFUSED", error instanceof ProviderError ? error.message : String(error));
    }
  });
  api.post("/agents/:id/test", async (c) => {
    const agent = deps.agents.get(c.req.param("id"));
    if (!agent) return refuse(c, 404, "AGENT_UNKNOWN", c.req.param("id"));
    return c.json(publicAgent(deps.agents.setProbe(agent.id, await probe(agent, deps.probe))!));
  });

  // Chat
  api.post("/chat", async (c) => {
    const input = await body(c, chatInput);
    if (input instanceof Response) return input;
    try {
      return await chat(input, { ...deps.chat, store: deps.agents }, c.req.raw.signal);
    } catch (error) {
      if (error instanceof ChatRefusal) return refuse(c, error.status, error.code, error.message);
      throw error;
    }
  });

  // Threads
  api.get("/threads", (c) => c.json(deps.threads.list()));
  api.post("/threads", (c) => c.json(deps.threads.create(), 201));
  api.get("/threads/:id", (c) => {
    const thread = deps.threads.get(c.req.param("id"));
    if (!thread) return refuse(c, 404, "THREAD_UNKNOWN", c.req.param("id"));
    const { messages: _, ...meta } = thread;
    return c.json(meta);
  });
  api.patch("/threads/:id", async (c) => {
    const change = await body(c, threadChange);
    if (change instanceof Response) return change;
    const thread = deps.threads.patch(c.req.param("id"), change);
    return thread ? c.json({ id: thread.id }) : refuse(c, 404, "THREAD_UNKNOWN", c.req.param("id"));
  });
  api.delete("/threads/:id", (c) => (deps.threads.remove(c.req.param("id")) ? c.body(null, 204) : refuse(c, 404, "THREAD_UNKNOWN", c.req.param("id"))));
  api.get("/threads/:id/messages", (c) => {
    const thread = deps.threads.get(c.req.param("id"));
    return thread ? c.json(thread.messages) : refuse(c, 404, "THREAD_UNKNOWN", c.req.param("id"));
  });
  api.post("/threads/:id/messages", async (c) => {
    const input = await body(c, row);
    if (input instanceof Response) return input;
    return deps.threads.append(c.req.param("id"), input as never) ? c.body(null, 204) : refuse(c, 404, "THREAD_UNKNOWN", c.req.param("id"));
  });

  api.notFound((c) => refuse(c, 404, "NOT_FOUND", c.req.path));
  api.onError((error, c) => refuse(c, 500, "AGENT_FAILED", error.message));
  return api;
}
