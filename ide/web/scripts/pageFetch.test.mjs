import assert from "node:assert/strict";
import { createContext } from "node:vm";
import { test } from "node:test";
import { loader, namespace } from "./load.mjs";

async function page(replies) {
  const meta = { content: "old" }, requests = [];
  const context = createContext({ Headers, document: { querySelector: () => meta }, fetch: async (url, init) => {
    requests.push({ url, init, token: init.headers?.get("x-trade-paper-token") ?? null });
    return replies.shift();
  } });
  const module = await namespace("lib/transport.ts", { context, sources: [], packages: [] });
  return { ...module, requests, meta };
}
const reply = (status, nonce) => new Response("{}", { status, headers: nonce ? { "x-trade-paper-token": nonce } : {} });

test("an old page renews after cutover without repeating a forwarded operation or changing its operation ID", async () => {
  const p = await page([reply(403, "new"), reply(200)]);
  const body = JSON.stringify({ op_id: "original", candidate: "test@1" });
  assert.equal((await p.pageFetch("/api/paper/runs", { method: "POST", body })).status, 200);
  assert.deepEqual(p.requests.map((r) => [r.token, r.init.body]), [["old", body], ["new", body]]);
  assert.equal(p.meta.content, "new");
});
test("only the pre-forward renewal marker permits one retry", async () => {
  for (const status of [401, 403, 502]) {
    const p = await page([reply(status)]);
    assert.equal((await p.pageFetch("/api/research/sync", { method: "POST" })).status, status);
    assert.equal(p.requests.length, 1);
  }
  const p = await page([reply(403, "next"), reply(403, "another")]);
  assert.equal((await p.pageFetch("/api/paper/runs", { method: "POST" })).status, 403);
  assert.equal(p.requests.length, 2);
  const get = await page([reply(403, "next")]);
  assert.equal((await get.pageFetch("/api/paper/runs")).status, 403);
  assert.equal(get.requests.length, 1);
});

test("a 401 says once that the sign-in expired, and from then on no poll asks again (oauth2-proxy logged one every ~2 s for days)", async () => {
  const timers = [], said = [];
  const window = { setTimeout: (tick) => timers.push(tick), clearTimeout: () => {} };
  const context = createContext({
    window, Headers, document: { hidden: false, querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {} },
    fetch: async () => new Response("<html>sign in</html>", { status: 401 }),
  });
  const graph = loader({ context, sources: ["lib/transport", "lib/polled"], packages: [] });
  const transport = await graph.namespace("lib/transport.ts");
  const { polled } = await graph.namespace("lib/polled.ts");
  transport.whenSignedOut(() => said.push("sign in"));
  const answers = [];
  await polled("/api/about", 3000, (answer) => answers.push(answer?.status)).read();
  assert.deepEqual(answers, [401]);
  assert.equal(transport.signedOut(), true);
  assert.equal(timers.length, 0, "nothing is asked again");
  await transport.pageFetch("/api/market-import");
  assert.deepEqual(said, ["sign in"]);
});
