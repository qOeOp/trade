import assert from "node:assert/strict";
import { createContext } from "node:vm";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const atom = (initial) => { let value = initial; return { get: () => value, set: (next) => { value = next; } }; };
async function page(replies) {
  const sessionRequired = atom(false), requests = [];
  const context = createContext({ fetch: async (url, init) => {
    requests.push({ url, init });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return { status: reply.status, ok: reply.status < 300, json: async () => reply.body };
  } });
  const module = await namespace("state/researchSync.ts", { context, sources: [], packages: [],
    stubs: { "state/atom": { atom }, "state/session": { sessionRequired }, "lib/paperApi": { pageFetch: context.fetch } } });
  return { ...module, sessionRequired, requests };
}
test("sync failure retains the previously observed research version", async () => {
  const p = await page([{ status: 200, body: { state: "idle", ledger_commit: "old", origin: "published" } },
    { status: 503, body: { message: "origin unavailable" } }]);
  await p.readResearchSync();
  await p.readResearchSync(true);
  assert.equal(p.researchSync.get().ledger_commit, "old");
  assert.equal(p.syncError.get(), "origin unavailable");
});
test("retry clears the previous failure without sending a caller-selected sync target", async () => {
  const p = await page([{ status: 200, body: { state: "error", ledger_commit: "old", error: { message: "offline" } } },
    { status: 202, body: { state: "syncing" } }]);
  await p.readResearchSync();
  await p.readResearchSync(true);
  assert.equal(p.researchSync.get().state, "syncing");
  assert.equal(p.researchSync.get().error, undefined);
  assert.equal(p.requests[1].url, "/api/research/sync");
  assert.equal(p.requests[1].init.body, undefined);
});
test("expired login asks for authentication and retains the research view", async () => {
  const p = await page([{ status: 200, body: { state: "ready", ledger_commit: "old" } }, { status: 401 }]);
  await p.readResearchSync();
  await p.readResearchSync(true);
  assert.equal(p.sessionRequired.get(), true);
  assert.equal(p.researchSync.get().ledger_commit, "old");
});
