import assert from "node:assert/strict"
import test from "node:test"
import { canonicalHash } from "../../runtime-core/src/canonical-json"
import { buildModelTaskRequest, compileModelTaskRequest, compileModelTaskResult } from "./model-task-contract"

test("model task request is canonical, bounded, and provider-neutral", () => {
  const request = buildModelTaskRequest(fixture())
  assert.equal(compileModelTaskRequest(request).request_hash, request.request_hash)
  assert.equal(Object.hasOwn(request, "provider"), false)
  assert.equal(Object.hasOwn(request, "model"), false)
})

test("model task rejects secret-like context and hash drift", () => {
  assert.throws(() => buildModelTaskRequest({
    ...fixture(),
    prompt: { system: "Return JSON", user: "Authorization: Bearer sk-secretsecretsecret" },
  }), /secret-like/)
  const request = buildModelTaskRequest(fixture())
  assert.throws(() => compileModelTaskRequest({ ...request, trace_id: "trace-drift" }), /hash mismatch/)
})

test("model task result verifies authority, identity hashes, output, and failure class", () => {
  const request = buildModelTaskRequest(fixture())
  const output = { hypothesis_id: "h-1" }
  const completed = compileModelTaskResult({
    schema_version: "trade.model-task-result.v1", task_id: request.task_id, trace_id: request.trace_id,
    request_hash: request.request_hash, status: "completed", attempts: 1, provider: "siliconflow",
    model: "fixture/model", usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    output, output_hash: canonicalHash(output), execution_authority: "none",
  })
  assert.deepEqual(completed.output, output)
  assert.throws(() => compileModelTaskResult({ ...completed, output_hash: "0".repeat(64) }), /output_hash mismatch/)
  assert.throws(() => compileModelTaskResult({ ...completed, execution_authority: "live" }), /authority/)
  const blocked = compileModelTaskResult({
    schema_version: "trade.model-task-result.v1", task_id: request.task_id, trace_id: request.trace_id,
    request_hash: request.request_hash, status: "blocked", attempts: 0, provider: "siliconflow",
    model: "fixture/model", usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    failure: { code: "credential_unavailable", retryable: false }, execution_authority: "none",
  })
  assert.equal(blocked.failure?.retryable, false)
})

function fixture() {
  return {
    task_id: "model-task-1",
    task_type: "research_hypothesis" as const,
    idempotency_key: "model-task:rd:1",
    trace_id: "trace-model-task-1",
    input_refs: ["rd-program://1/context"],
    prompt_version: "research-hypothesis.v1",
    output_schema_version: "trade-flow.strategy-hypothesis-contract.v1",
    prompt: { system: "Return exactly one JSON object.", user: "Design one bounded hypothesis from the supplied context." },
    provider_policy: { capability: "json_object" as const },
    budget: { timeout_ms: 10_000, max_attempts: 2, max_input_chars: 10_000, max_output_tokens: 1_000, max_total_tokens: 4_000 },
    data_classification: "project_internal" as const,
  }
}
