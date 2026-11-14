// Which question the first-start page asks, given what the service knows and what it refused.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "node:vm";
import { namespace } from "./load.mjs";

const setupApi = (fetch = () => { throw new Error("no fetch"); }) => namespace("lib/setupApi.ts", {
  context: createContext({ fetch }), sources: [], packages: [],
  stubs: { "lib/transport": { pageFetch: () => { throw new Error("no post"); } } },
});

const waiting = (repository = null) => ({ state: "waiting", repository, public_key: "k", step: null, refusal: null });

test("a repository nobody named is asked for; a named one goes on to the key", async () => {
  const { question } = await setupApi();
  assert.equal(question(waiting(), null, null, false), "repository");
  assert.equal(question(waiting(), null, "o/r", false), "key", "answered on the page");
  assert.equal(question(waiting("o/r"), null, null, false), "key", "named by the deployment");
  assert.equal(question(waiting("o/r"), null, null, true), "repository", "going back to change it");
});

test("each refusal goes back to the question that can fix it", async () => {
  const { question } = await setupApi();
  for (const code of ["BOOTSTRAP_FAILED", "REMOTE_INVALID"]) assert.equal(question(waiting("o/r"), { code, message: "" }, null, false), "repository", code);
  for (const code of ["DOLTHUB_CREDENTIALS", "PUBLISH_FAILED"]) assert.equal(question(waiting("o/r"), { code, message: "" }, null, false), "key", code);
});

test("no setup port is told apart from one that does not answer now", async () => {
  const answers = [{ status: 404, ok: false, json: async () => ({}) }, { status: 502, ok: false, json: async () => ({ code: "SETUP_UNAVAILABLE" }) },
    { status: 200, ok: true, json: async () => { throw new Error("a page, not an answer"); } }, { status: 200, ok: true, json: async () => waiting() }];
  const { readSetup } = await setupApi(async () => answers.shift());
  assert.equal(await readSetup(), "none");
  assert.equal(await readSetup(), "down");
  assert.equal(await readSetup(), "down");
  assert.equal((await readSetup()).state, "waiting");
});

test("a step reads as a sentence without the remote's host", async () => {
  const { stepLine } = await setupApi();
  assert.equal(stepLine("reading https://doltremoteapi.dolthub.com/o/r"), "Reading o/r…");
  assert.equal(stepLine(null), "Starting…");
});
