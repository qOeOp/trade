import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../src/state/researchSync.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const atom = (initial) => { let value = initial; return { get: () => value, set: (next) => { value = next; } }; };
async function page(replies) {
  const sessionRequired = atom(false), requests = [];
  const context = createContext({ fetch: async (url, init) => {
    requests.push({ url, init });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return { status: reply.status, ok: reply.status < 300, json: async () => reply.body };
  } });
  const module = new SourceTextModule(source, { context });
  await module.link(async (name) => {
    const values = name === "./atom" ? { atom } : name === "./session" ? { sessionRequired } : { paperToken: () => "page-token" };
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { ...module.namespace, sessionRequired, requests };
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
  assert.equal(p.requests[1].init.headers["x-trade-paper-token"], "page-token");
});
test("expired login asks for authentication and retains the research view", async () => {
  const p = await page([{ status: 200, body: { state: "ready", ledger_commit: "old" } }, { status: 401 }]);
  await p.readResearchSync();
  await p.readResearchSync(true);
  assert.equal(p.sessionRequired.get(), true);
  assert.equal(p.researchSync.get().ledger_commit, "old");
});
