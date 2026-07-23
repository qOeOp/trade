import assert from "node:assert/strict"
import test from "node:test"
import { runProviderCapabilityProbe } from "./provider-capability-probe"

const profile = {
  schema_version: "trade.model-gateway-profile.v1" as const,
  provider: "siliconflow" as const,
  base_url: "https://api.siliconflow.cn/v1" as const,
  model: "fixture/model",
  capabilities: ["json_object"] as ["json_object"],
  api_key_env: "SILICONFLOW_API_KEY" as const,
}

test("provider capability probe separates complete Chat agent wire from unsupported Responses", async () => {
  const result = await runProviderCapabilityProbe(profile, {
    api_key: "fixture-key",
    observed_at: "2026-07-23T08:00:00.000Z",
    fetcher: fixtureFetcher(),
  })
  assert.equal(result.chat_agent_wire_compatible, true)
  assert.equal(result.responses_agent_wire_compatible, false)
  assert.equal(result.checks.responses_wire.reason, "unsupported_endpoint")
  assert.equal(result.raw_payload_persisted, false)
})

test("provider capability probe reports malformed stream and HTTP error without raw payload", async () => {
  let call = 0
  const result = await runProviderCapabilityProbe(profile, {
    api_key: "fixture-key",
    observed_at: "2026-07-23T08:00:00.000Z",
    fetcher: (async () => {
      call += 1
      if (call === 1) return jsonResponse(chat("trade-provider-json-ok"))
      if (call === 2) return new Response("data: {bad}\n", { status: 200 })
      return new Response("rate limited", { status: 429 })
    }) as unknown as typeof fetch,
  })
  assert.equal(result.checks.chat_stream.reason, "malformed_response")
  assert.equal(result.checks.single_tool_call.http_status, 429)
  assert.equal(JSON.stringify(result).includes("rate limited"), false)
})

function fixtureFetcher(): typeof fetch {
  let call = 0
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    call += 1
    if (call === 1) return jsonResponse(chat("trade-provider-json-ok"))
    if (call === 2) {
      return new Response([
        'data: {"choices":[{"delta":{"content":"trade-provider-stream-ok"}}]}',
        "data: [DONE]",
        "",
      ].join("\n"), { status: 200 })
    }
    if (call === 3) return jsonResponse(chat(null, [toolCall("call-1", "marker_one")]))
    if (call === 4) return jsonResponse(chat(null, [toolCall("call-1", "marker_one"), toolCall("call-2", "marker_two")]))
    if (call === 5) return jsonResponse(chat(null, [toolCall("call-1", "marker_one")]))
    if (call === 6) {
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ role: string }> }
      assert.equal(request.messages.at(-1)?.role, "tool")
      return jsonResponse(chat("trade-provider-continuation-ok"))
    }
    return new Response("not found", { status: 404 })
  }) as unknown as typeof fetch
}

function chat(content: string | null, tool_calls?: unknown[]) {
  return { choices: [{ message: { role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) } }] }
}

function toolCall(id: string, name: string) {
  return { id, type: "function", function: { name, arguments: `{"marker":"${name}"}` } }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })
}
