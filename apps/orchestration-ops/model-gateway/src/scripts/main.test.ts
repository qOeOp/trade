import assert from "node:assert/strict"
import test from "node:test"
import { buildModelTaskRequest } from "../../../../contracts/model-task-contract/src/model-task-contract"
import { runModelGatewayCli } from "../lib/model-gateway-cli"

test("published CLI resolves only the canonical profile and fails closed without credential", async () => {
  const previous = process.env.SILICONFLOW_API_KEY
  delete process.env.SILICONFLOW_API_KEY
  try {
    const result = await runModelGatewayCli(["--profile", "profile/model-gateway.json", "--json", JSON.stringify(request())], () => undefined)
    assert.equal(result.ok, true)
    const task = (result.data as Record<string, unknown>)
    assert.equal(task.status, "blocked")
    assert.deepEqual(task.failure, { code: "credential_unavailable", retryable: false })
    const rejected = await runModelGatewayCli(["--profile", "../../../profile/model-gateway.json", "--json", "{}"], () => undefined)
    assert.equal(rejected.ok, false)
  } finally {
    if (previous === undefined) delete process.env.SILICONFLOW_API_KEY
    else process.env.SILICONFLOW_API_KEY = previous
  }
})

function request() {
  return buildModelTaskRequest({
    task_id: "cli-task-1", task_type: "research_hypothesis",
    idempotency_key: "cli:task:1", trace_id: "trace-cli-task-1", input_refs: ["rd-program://1"],
    prompt_version: "research-hypothesis.v1", output_schema_version: "trade-flow.strategy-hypothesis-contract.v1",
    prompt: { system: "Return one JSON object.", user: "Design one bounded research hypothesis." },
    provider_policy: { capability: "json_object" },
    budget: { timeout_ms: 5000, max_attempts: 1, max_input_chars: 1000, max_output_tokens: 512, max_total_tokens: 2000 },
    data_classification: "project_internal",
  })
}
