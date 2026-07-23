import { buildModelTaskRequest, type ModelTaskResult } from "../../../../contracts/model-task-contract/src/model-task-contract"
import { runModelTask, type ModelGatewayProfile } from "./model-gateway"

export const MODEL_PROVIDER_SMOKE_SCHEMA = "trade.model-provider-smoke-result.v1" as const
const EXPECTED_MARKER = "trade-model-gateway-smoke"

export interface ModelProviderSmokeResult {
  schema_version: typeof MODEL_PROVIDER_SMOKE_SCHEMA
  observed_at: string
  passed: boolean
  reason: "passed" | "provider_task_failed" | "semantic_marker_mismatch"
  task_result: ModelTaskResult
}

export async function runModelProviderSmoke(
  profile: ModelGatewayProfile,
  observedAt = new Date().toISOString(),
  dependencies?: Parameters<typeof runModelTask>[2],
): Promise<ModelProviderSmokeResult> {
  const request = buildSmokeRequest(observedAt)
  const taskResult = await runModelTask(request, profile, dependencies)
  const passed = taskResult.status === "completed" && hasExpectedMarker(taskResult.output)
  return {
    schema_version: MODEL_PROVIDER_SMOKE_SCHEMA,
    observed_at: observedAt,
    passed,
    reason: passed ? "passed" : taskResult.status === "completed" ? "semantic_marker_mismatch" : "provider_task_failed",
    task_result: taskResult,
  }
}

export function buildSmokeRequest(observedAt: string) {
  const canonicalTime = new Date(observedAt).toISOString()
  if (canonicalTime !== observedAt) throw new Error("observed_at must be canonical UTC")
  const identity = canonicalTime.replace(/[-:.]/g, "")
  return buildModelTaskRequest({
    task_id: `provider-smoke-${identity}`,
    task_type: "research_hypothesis",
    idempotency_key: `model-provider-smoke:${identity}`,
    trace_id: `trace-provider-smoke-${identity}`,
    input_refs: ["smoke://public/json-capability"],
    prompt_version: "provider-smoke.v1",
    output_schema_version: "provider-smoke.v1",
    prompt: {
      system: "Return exactly one compact JSON object and no prose.",
      user: `Return an object with exactly these fields: capability_ok=true and marker=${EXPECTED_MARKER}.`,
    },
    provider_policy: { capability: "json_object" },
    budget: {
      timeout_ms: 30_000,
      max_attempts: 2,
      max_input_chars: 1_000,
      max_output_tokens: 128,
      max_total_tokens: 512,
    },
    data_classification: "public",
  })
}

function hasExpectedMarker(output: Record<string, unknown> | undefined): boolean {
  if (!output) return false
  const keys = Object.keys(output).sort()
  return keys.length === 2
    && keys[0] === "capability_ok"
    && keys[1] === "marker"
    && output.capability_ok === true
    && output.marker === EXPECTED_MARKER
}
