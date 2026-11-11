// Whether the page has an Agent window (state/agent.ts): only a 404 says the server has no chat service.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "node:vm";
import { namespace } from "./load.mjs";

const atom = (initial) => { let value = initial; return { get: () => value, set: (next) => { value = next; } }; };

/** The page with its server's replies: a status for `/health`, and for `/agents` a list or an Error. */
async function page(health, agents = []) {
  const ticks = [], asked = [];
  const context = createContext({ fetch: async (url) => {
    asked.push(url);
    const reply = health.shift();
    if (reply instanceof Error) throw reply;
    return { status: reply, ok: reply < 300 };
  } });
  const stubs = {
    "lib/agentApi": { agentApi: async (path) => {
      assert.equal(path, "/agents");
      const reply = agents.shift();
      if (reply instanceof Error) throw reply;
      return reply;
    } },
    "lib/whileVisible": { whileVisible: (tick, ms) => ticks.push({ tick, ms }) },
    "state/atom": { atom, persistedAtom: (_key, fallback) => atom(fallback), useAtom: (a) => a.get() },
  };
  const module = await namespace("state/agent.ts", { context, stubs, sources: [], packages: [] });
  const tick = async () => {
    ticks[0].tick();
    await new Promise((done) => setImmediate(done));
  };
  return { ...module, ticks, asked, tick };
}

test("a service that answers is present with its agents, and nothing asks again", async () => {
  const p = await page([200], [[{ id: "a" }]]);
  await p.detectAgentService();
  assert.equal(p.agentService.get(), "present");
  assert.deepEqual(p.agents.get(), [{ id: "a" }]);
  assert.equal(p.ticks.length, 0);
});

test("a 404 means the server has no chat service, and nothing asks again", async () => {
  const p = await page([404]);
  await p.detectAgentService();
  assert.equal(p.agentService.get(), "absent");
  assert.equal(p.ticks.length, 0);
});

for (const [name, failure] of [["a 502", 502], ["an unreachable server", new TypeError("Load failed")]]) {
  test(`${name} is offline, and the service is present once it answers, with no reload`, async () => {
    const p = await page([failure, 502, 200], [[{ id: "a" }]]);
    await p.detectAgentService();
    assert.equal(p.agentService.get(), "offline");
    assert.equal(p.ticks[0].ms, 30_000);
    await p.tick();
    assert.equal(p.agentService.get(), "offline");
    await p.tick();
    assert.equal(p.agentService.get(), "present");
    assert.deepEqual(p.agents.get(), [{ id: "a" }]);
    await p.tick();
    assert.equal(p.asked.length, 3);  // answered: the poll asks nothing more
  });
}

test("a service whose agents cannot be read stays offline rather than show an empty list", async () => {
  const p = await page([200, 200], [new Error("AGENT_FAILED"), [{ id: "a" }]]);
  await p.detectAgentService();
  assert.equal(p.agentService.get(), "offline");
  await p.tick();
  assert.equal(p.agentService.get(), "present");
});
