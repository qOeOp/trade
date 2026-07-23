import assert from "node:assert/strict"
import test from "node:test"
import { executeOpenClawGatewayHttp } from "./openclaw-gateway-http-executor"
import { parseOpenClawOutput } from "./openclaw-agent-run"

test("Gateway HTTP executor routes one private Agent Run and normalizes output", async () => {
  let observed: Request | null = null
  const result = await executeOpenClawGatewayHttp({
    gateway_url: "http://openclaw:18789",
    gateway_token: "a".repeat(64),
    request: {
      run_id: "agent-run-1",
      agent_id: "rd-planner",
      message: "{\"task\":\"bounded\"}",
      timeout_seconds: 30,
      transport: "gateway",
    },
    signal: new AbortController().signal,
    fetch: async (request, init) => {
      observed = new Request(request, init)
      return Response.json({
        id: "resp-1",
        output: [
          { type: "function_call", name: "owner_read", call_id: "call-1" },
          {
            type: "message",
            content: [{ type: "output_text", text: "{\"status\":\"ok\"}" }],
          },
        ],
      })
    },
  })
  assert.equal(result.exit_code, 0)
  assert.equal(result.tool_calls, 1)
  assert.equal(result.model_turns, 2)
  assert.equal(parseOpenClawOutput(result.stdout, "gateway"), "{\"status\":\"ok\"}")
  assert.equal(observed!.url, "http://openclaw:18789/v1/responses")
  assert.equal(observed!.headers.get("x-openclaw-agent-id"), "rd-planner")
  assert.equal(observed!.headers.get("x-openclaw-session-key"), "agent-run-1")
  assert.equal(observed!.headers.get("authorization"), `Bearer ${"a".repeat(64)}`)
})

test("Gateway HTTP executor redacts error bodies and closes aborts", async () => {
  const failed = await executeOpenClawGatewayHttp({
    gateway_url: "http://openclaw:18789/",
    gateway_token: "b".repeat(64),
    request: {
      run_id: "agent-run-2",
      agent_id: "rd-reviewer",
      message: "{}",
      timeout_seconds: 30,
      transport: "gateway",
    },
    signal: new AbortController().signal,
    fetch: async () => Response.json({
      error: { type: "provider_unavailable", message: "secret response text" },
    }, { status: 503 }),
  })
  assert.equal(failed.exit_code, 1)
  assert.equal(failed.stderr, "OpenClaw Gateway HTTP 503: provider_unavailable")
  assert.equal(failed.stderr.includes("secret response text"), false)

  const controller = new AbortController()
  controller.abort()
  const aborted = await executeOpenClawGatewayHttp({
    gateway_url: "http://openclaw:18789",
    gateway_token: "c".repeat(64),
    request: {
      run_id: "agent-run-3",
      agent_id: "rd-reviewer",
      message: "{}",
      timeout_seconds: 30,
      transport: "gateway",
    },
    signal: controller.signal,
    fetch: async (_request, init) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError")
      return Response.json({})
    },
  })
  assert.equal(aborted.interrupted, true)
  assert.equal(aborted.exit_code, 143)
})

test("Gateway HTTP executor preserves a successful tool-only response", async () => {
  const result = await executeOpenClawGatewayHttp({
    gateway_url: "http://openclaw:18789",
    gateway_token: "d".repeat(64),
    request: {
      run_id: "agent-run-tool-only",
      agent_id: "rd-developer",
      message: "{}",
      timeout_seconds: 30,
      transport: "gateway",
    },
    signal: new AbortController().signal,
    fetch: async () => Response.json({
      id: "resp-tool-only",
      output: [{
        type: "function_call",
        name: "research_developer_submission_prepare",
        call_id: "call-tool-only",
      }],
    }),
  })
  assert.equal(result.exit_code, 0)
  assert.equal(result.tool_calls, 1)
  assert.equal(parseOpenClawOutput(result.stdout, "gateway", true), "")
  assert.throws(() => parseOpenClawOutput(result.stdout, "gateway"), /text is missing/)
})
