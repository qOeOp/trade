import assert from "node:assert/strict"
import test from "node:test"
import { buildModelTaskRequest } from "../../../../contracts/model-task-contract/src/model-task-contract"
import { runModelTask } from "./model-gateway"

const profile = {
  schema_version: "trade.model-gateway-profile.v1",
  provider: "siliconflow",
  base_url: "https://api.siliconflow.cn/v1",
  model: "Qwen/Qwen3.5-27B",
  capabilities: ["json_object"],
  api_key_env: "SILICONFLOW_API_KEY",
}

test("gateway returns parsed proposal without prompt, secret, raw body, or authority", async () => {
  let providerBody: Record<string, unknown> | undefined
  const result = await runModelTask(request(), profile, {
    apiKey: "fixture-key-never-logged",
    fetch: async (_input, init) => {
      providerBody = JSON.parse(String(init?.body))
      return response(200, completion(JSON.stringify({ hypothesis_id: "h-1" })))
    },
  })
  assert.equal(result.status, "completed")
  assert.deepEqual(result.output, { hypothesis_id: "h-1" })
  assert.equal(providerBody?.enable_thinking, false)
  assert.equal(result.execution_authority, "none")
  assert.equal(JSON.stringify(result).includes("fixture-key"), false)
  assert.equal(JSON.stringify(result).includes("Design one"), false)
})

test("gateway retries bounded transient failures and classifies exhaustion", async () => {
  let calls = 0
  const recovered = await runModelTask(request(), profile, {
    apiKey: "fixture-key",
    fetch: async () => {
      calls += 1
      return calls === 1 ? response(503, {}) : response(200, completion("{}"))
    },
  })
  assert.equal(recovered.status, "completed")
  assert.equal(recovered.attempts, 2)
  const exhausted = await runModelTask(request(), profile, {
    apiKey: "fixture-key",
    fetch: async () => response(429, {}),
  })
  assert.equal(exhausted.status, "retryable")
  assert.equal(exhausted.failure?.code, "provider_http_429")
})

test("gateway blocks missing credential, truncation, invalid JSON, and token overrun", async () => {
  let calls = 0
  const missing = await runModelTask(request(), profile, { apiKey: "", fetch: async () => { calls += 1; return response(200, {}) } })
  assert.equal(missing.failure?.code, "credential_unavailable")
  assert.equal(calls, 0)
  const truncated = await runModelTask(request(), profile, {
    apiKey: "fixture", fetch: async () => response(200, completion("{}", "length")),
  })
  assert.equal(truncated.failure?.code, "provider_output_truncated")
  const invalid = await runModelTask(request(), profile, {
    apiKey: "fixture", fetch: async () => response(200, completion("not-json")),
  })
  assert.equal(invalid.failure?.code, "model_output_invalid_json")
  const overrun = await runModelTask(request(), profile, {
    apiKey: "fixture", fetch: async () => response(200, completion("{}", "stop", 5_000)),
  })
  assert.equal(overrun.failure?.code, "total_token_budget_exceeded")
  const missingUsage = await runModelTask(request(), profile, {
    apiKey: "fixture", fetch: async () => response(200, { choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: {} }),
  })
  assert.equal(missingUsage.failure?.code, "provider_response_shape_invalid")
})

function request() {
  return buildModelTaskRequest({
    task_id: "model-task-gateway-1", task_type: "research_hypothesis", idempotency_key: "model-task:gateway:1",
    trace_id: "trace-gateway-1", input_refs: ["rd-program://context/1"], prompt_version: "research-hypothesis.v1",
    output_schema_version: "trade-flow.strategy-hypothesis-contract.v1",
    prompt: { system: "Return exactly one JSON object.", user: "Design one bounded research hypothesis." },
    provider_policy: { capability: "json_object" },
    budget: { timeout_ms: 5_000, max_attempts: 2, max_input_chars: 2_000, max_output_tokens: 512, max_total_tokens: 4_000 },
    data_classification: "project_internal",
  })
}

function completion(content: string, finishReason = "stop", totalTokens = 30) {
  return { id: "completion-1", model: profile.model, choices: [{ finish_reason: finishReason, message: { content } }], usage: { prompt_tokens: 10, completion_tokens: totalTokens - 10, total_tokens: totalTokens } }
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
