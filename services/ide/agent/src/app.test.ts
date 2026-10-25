import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentStore, fingerprint } from "./agents.ts";
import { app } from "./app.ts";
import { dataDir, generating, streaming, text, toolCall } from "./fixtures.test-support.ts";
import { ThreadStore } from "./threads.ts";
import { productTools } from "./tools.ts";

const HOST = "127.0.0.1:8766";
const product = { root: "/opt/trade", ledger: "research", market: null };
const state = { line: { bundle: "research-line-ema" }, ledger_commit: "abc" };

function setup(model = streaming("research_state", {}, "The line is research-line-ema.")) {
  const dir = dataDir();
  const agents = new AgentStore(dir);
  const ran: string[][] = [];
  const service = app({
    agents, threads: new ThreadStore(dir), hosts: new Set([HOST]),
    chat: { model: () => model, tools: productTools(product, async (args) => { ran.push(args); return { code: 0, stdout: JSON.stringify(state), stderr: "" }; }), delayInMs: null },
    probe: { list: async () => ["m1"], model: () => generating(text("ready"), toolCall("ping", {}), text("pong-7319")) },
  });
  const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    service.request(`/api/agent${path}`, { ...init, headers: { host: HOST, "content-type": "application/json", ...init.headers } });
  return { agents, ran, call };
}

const input = { name: "Claude", provider: "anthropic", key: "sk-ant-secret-1234", models: ["m1"], defaultModel: "m1" };

test("only the page's own requests are served", async () => {
  const { call } = setup();
  assert.equal((await call("/agents", { headers: { host: "evil.example:8766" } })).status, 403);
  assert.equal((await call("/agents", { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await call("/agents", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await call("/agents")).status, 200);
});

test("an agent becomes active by passing its test, and no answer carries its key", async () => {
  const { call } = setup();
  type Reply = { id: string; status: string; probe: unknown; usable: string[] };
  const created = await (await call("/agents", { method: "POST", body: JSON.stringify(input) })).json() as Reply;
  assert.equal(created.status, "untested");
  const tested = await (await call(`/agents/${created.id}/test`, { method: "POST", body: "{}" })).json() as Reply;
  assert.equal(tested.status, "active", JSON.stringify(tested.probe));
  assert.deepEqual(tested.usable, ["m1"]);
  assert.ok(!JSON.stringify(await (await call("/agents")).json()).includes("secret"));
});

test("a model that answers without calling the tool fails the test", async () => {
  const dir = dataDir();
  const agents = new AgentStore(dir);
  const service = app({
    agents, threads: new ThreadStore(dir), hosts: new Set([HOST]), chat: { model: () => generating(), tools: {} },
    probe: { list: async () => ["m1"], model: () => generating(text("ready"), text("pong-7319")) },
  });
  const agent = agents.create({ ...input, provider: "anthropic", baseURL: null });
  const response = await service.request(`/api/agent/agents/${agent.id}/test`, { method: "POST", body: "{}", headers: { host: HOST, "content-type": "application/json" } });
  const tested = await response.json() as { status: string; probe: { steps: { detail: string }[] } };
  assert.equal(tested.status, "failed");
  assert.equal(tested.probe.steps.at(-1)?.detail, "the model did not call the tool");
});

test("an untested agent cannot chat", async () => {
  const { agents, call } = setup();
  const agent = agents.create({ ...input, provider: "anthropic", baseURL: null });
  const response = await call("/chat", { method: "POST", body: JSON.stringify({ agent: agent.id, model: "m1", messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }] }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { code: string }).code, "AGENT_INACTIVE");
});

test("a chat answer streams the tool call, its product output, the text and the model that wrote it", async () => {
  const { agents, ran, call } = setup();
  const agent = agents.create({ ...input, provider: "anthropic", baseURL: null });
  agents.setProbe(agent.id, { at: "t", fingerprint: fingerprint(agent), ok: true, steps: [], models: ["m1"] });
  const response = await call("/chat", { method: "POST", body: JSON.stringify({
    agent: agent.id, model: "m1", context: { version: "ema-12@5" },
    messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Which line?" }] }],
  }) });
  assert.equal(response.status, 200);
  const chunks = (await response.text()).split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)));
  assert.deepEqual(ran, [["research", "state", "--ledger=research"]]);
  const output = chunks.find((c) => c.type === "tool-output-available");
  assert.equal(output.output.command, "research state --ledger=research");
  assert.deepEqual(output.output.output, state);
  assert.deepEqual(chunks.find((c) => c.type === "start").messageMetadata, { agent: "Claude", provider: "anthropic", model: "m1" });
  const deltas = chunks.filter((c) => c.type === "text-delta");
  assert.ok(deltas.length > 1, "the text arrives in pieces");
  assert.equal(deltas.map((c) => c.delta).join(""), "The line is research-line-ema.");
});

test("threads keep their message rows", async () => {
  const { call } = setup();
  const thread = await (await call("/threads", { method: "POST", body: "{}" })).json() as { id: string };
  const row = { id: "m1", parent_id: null, format: "ai-sdk/v6", content: { role: "user" } };
  assert.equal((await call(`/threads/${thread.id}/messages`, { method: "POST", body: JSON.stringify(row) })).status, 204);
  await call(`/threads/${thread.id}`, { method: "PATCH", body: JSON.stringify({ title: "Drawdown" }) });
  assert.deepEqual(await (await call(`/threads/${thread.id}/messages`)).json(), [row]);
  assert.equal((await (await call("/threads")).json() as { title: string }[])[0]?.title, "Drawdown");
  assert.equal((await call(`/threads/${thread.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await call(`/threads/${thread.id}/messages`)).status, 404);
});
