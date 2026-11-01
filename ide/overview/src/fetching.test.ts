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
