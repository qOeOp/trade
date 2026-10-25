import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { AgentStore, fingerprint, publicAgent, status } from "./agents.ts";
import { dataDir } from "./fixtures.test-support.ts";

const input = { name: "Claude", provider: "anthropic" as const, baseURL: null, key: "sk-ant-secret-1234", models: ["m1"], defaultModel: "m1" };

test("the page never sees the key, only its last four characters", () => {
  const store = new AgentStore(dataDir());
  const shown = publicAgent(store.create(input));
  assert.equal(shown.keyHint, "…1234");
  assert.ok(!JSON.stringify(shown).includes("secret"));
});

test("the agents file is private to the service", () => {
  const dir = dataDir();
  new AgentStore(dir).create(input);
  assert.equal(statSync(join(dir, "agents.json")).mode & 0o777, 0o600);
});

test("an agent is active only while its test vouches for its current key, URL and models", () => {
  const store = new AgentStore(dataDir());
  const agent = store.create(input);
  assert.equal(status(agent), "untested");
  const passed = store.setProbe(agent.id, { at: "t", fingerprint: fingerprint(agent), ok: true, steps: [], models: ["m1"] })!;
  assert.equal(status(passed), "active");
  assert.equal(status(store.update(agent.id, { key: "" })!), "active", "an empty key keeps the stored one");
  assert.equal(status(store.update(agent.id, { key: "sk-ant-other-9999" })!), "untested");
});

test("a failed test leaves the agent failed until something changes", () => {
  const store = new AgentStore(dataDir());
  const agent = store.create(input);
  assert.equal(status(store.setProbe(agent.id, { at: "t", fingerprint: fingerprint(agent), ok: false, steps: [], models: [] })!), "failed");
  assert.equal(status(store.update(agent.id, { models: ["m1", "m2"] })!), "untested");
});
