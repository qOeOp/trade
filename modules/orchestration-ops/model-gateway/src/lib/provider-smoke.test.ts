import assert from "node:assert/strict"
import test from "node:test"
import { runModelProviderSmoke } from "./provider-smoke"

const profile = {
  schema_version: "trade.model-gateway-profile.v1" as const,
  provider: "siliconflow" as const,
  base_url: "https://api.siliconflow.cn/v1" as const,
  model: "Qwen/Qwen3.5-27B",
  capabilities: ["json_object"] as ["json_object"],
  api_key_env: "SILICONFLOW_API_KEY" as const,
}

test("provider smoke requires the exact semantic marker and stays authority-free", async () => {
  const result = await runModelProviderSmoke(profile, "2026-07-23T03:00:00.000Z", {
    apiKey: "fixture-key",
    fetch: async () => response({ capability_ok: true, marker: "trade-model-gateway-smoke" }),
  })
  assert.equal(result.passed, true)
  assert.equal(result.reason, "passed")
  assert.equal(result.task_result.execution_authority, "none")

  const mismatch = await runModelProviderSmoke(profile, "2026-07-23T03:00:00.000Z", {
    apiKey: "fixture-key",
    fetch: async () => response({ capability_ok: true, marker: "wrong" }),
  })
  assert.equal(mismatch.passed, false)
  assert.equal(mismatch.reason, "semantic_marker_mismatch")
})

test("provider smoke preserves typed gateway failure without leaking the secret", async () => {
  const result = await runModelProviderSmoke(profile, "2026-07-23T03:00:00.000Z", {
    apiKey: "fixture-key-never-logged",
    fetch: async () => new Response("unauthorized private body", { status: 401 }),
  })
  assert.equal(result.passed, false)
  assert.equal(result.reason, "provider_task_failed")
  assert.equal(result.task_result.failure?.code, "provider_http_401")
  assert.equal(JSON.stringify(result).includes("fixture-key"), false)
  assert.equal(JSON.stringify(result).includes("private body"), false)
})

function response(output: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    id: "smoke-completion",
    model: profile.model,
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
    usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
  }), { status: 200, headers: { "content-type": "application/json" } })
}
