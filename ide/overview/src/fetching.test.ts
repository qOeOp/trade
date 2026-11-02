import assert from "node:assert/strict";
import { test } from "node:test";
import { Host, HttpError } from "./fetching.ts";

test("a 429 or 418 pauses every request to that host for its Retry-After, at least a minute", async () => {
  let now = 0, calls = 0;
  const answers = [new Response("", { status: 418, headers: { "retry-after": "120" } }), new Response("{\"ok\":1}")];
  const host = new Host("https://fapi.example", async () => { calls++; return answers.shift()!; }, () => now);
  await assert.rejects(host.json("/a"), (e) => e instanceof HttpError && e.status === 418);
  assert.equal(host.wait(), 120_000);
  await assert.rejects(host.json("/b"), /paused/);
  assert.equal(calls, 1);  // the paused request never left
  now = 120_000;
  assert.deepEqual(await host.json("/b"), { ok: 1 });
  const quick = new Host("https://api.example", async () => new Response("", { status: 429 }), () => 0);
  await assert.rejects(quick.json("/c"));
  assert.equal(quick.wait(), 60_000);
});

test("a host with a weight cap waits for the next minute once the weight it reports reaches the cap", async () => {
  const now = 59_950;  // 50 ms before the minute turns
  const weighed = (used: number) => new Response("{}", { headers: { "x-mbx-used-weight-1m": String(used) } });
  const timed = async (host: Host) => { const t = performance.now(); await host.json("/x"); return performance.now() - t; };
  const capped = new Host("https://fapi.example", async () => weighed(600), () => now, 600);
  await capped.json("/first");
  assert.ok(await timed(capped) >= 40);
  const under = new Host("https://fapi.example", async () => weighed(599), () => now, 600);
  await under.json("/first");
  assert.ok(await timed(under) < 40);
});
