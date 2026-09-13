import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";

const dashboardRoot = new URL("../", import.meta.url);

// Next resolves @/ at build time. Keep the production route intact while making
// the same alias available to Node's native TypeScript test loader.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, dashboardRoot).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const route = await import("../app/api/mcp/route.ts");

const TOKEN = "dashboard-mcp-route-test-capability-0001";
const MCP_ENVIRONMENT_KEYS = [
  "DASHBOARD_MCP_API_TOKEN",
  "DASHBOARD_MCP_PRINCIPAL_REF",
  "DASHBOARD_MCP_TOKEN_EXPIRES_AT_EPOCH_SECONDS",
  "DASHBOARD_MCP_ALLOWED_HOSTNAMES",
  "DASHBOARD_MCP_ALLOWED_ORIGIN_HOSTNAMES",
];
const EXPECTED_TOOLS = [
  "dashboard_artifact_action_v1",
  "dashboard_artifact_preflight_v1",
  "dashboard_develop_composer_action_v2",
  "dashboard_exploratory_replay_action_v2",
  "dashboard_run_detail_read_v1",
  "dashboard_run_logs_read_v1",
  "dashboard_source_research_action_v1",
];
const PROTOCOL_VERSION = "2026-07-28";

function configureCapability() {
  process.env.DASHBOARD_MCP_API_TOKEN = TOKEN;
  process.env.DASHBOARD_MCP_PRINCIPAL_REF = "dashboard-mcp-route-test-client";
  process.env.DASHBOARD_MCP_TOKEN_EXPIRES_AT_EPOCH_SECONDS = String(Math.floor(Date.now() / 1_000) + 3_600);
  process.env.DASHBOARD_MCP_ALLOWED_HOSTNAMES = "127.0.0.1";
  process.env.DASHBOARD_MCP_ALLOWED_ORIGIN_HOSTNAMES = "127.0.0.1";
}

function clearCapability() {
  for (const key of MCP_ENVIRONMENT_KEYS) delete process.env[key];
}

function mcpRequest(method, {
  authorization = `Bearer ${TOKEN}`,
  host = "127.0.0.1",
  origin = "http://127.0.0.1",
} = {}) {
  return new Request("http://127.0.0.1/api/mcp", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      host,
      "mcp-method": method,
      "mcp-protocol-version": PROTOCOL_VERSION,
      origin,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "dashboard-mcp-route-test", version: "1.0.0" },
        },
      },
    }),
  });
}

test("MCP route fails closed before protocol dispatch when configuration is absent", async () => {
  clearCapability();
  const response = await route.POST(mcpRequest("tools/list"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "MCP_CONFIGURATION_UNAVAILABLE" });
});

test("MCP route rejects untrusted Host and Origin before bearer authorization", async (t) => {
  configureCapability();
  t.after(clearCapability);

  const rejectedHost = await route.POST(mcpRequest("tools/list", {
    authorization: "Bearer deliberately-wrong-token-that-is-long-enough",
    host: "dashboard.example.test",
  }));
  assert.equal(rejectedHost.status, 403);

  const rejectedOrigin = await route.POST(mcpRequest("tools/list", {
    authorization: "Bearer deliberately-wrong-token-that-is-long-enough",
    origin: "https://dashboard.example.test",
  }));
  assert.equal(rejectedOrigin.status, 403);
});

test("MCP route requires the exact bearer capability", async (t) => {
  configureCapability();
  t.after(clearCapability);

  for (const authorization of ["", "Basic opaque", `Bearer ${TOKEN}x`]) {
    const response = await route.POST(mcpRequest("tools/list", { authorization }));
    assert.equal(response.status, 401);
  }
});

test("MCP tools/list exposes exactly seven bounded Dashboard tools and no arbitrary executor", async (t) => {
  configureCapability();
  t.after(clearCapability);

  const response = await route.POST(mcpRequest("tools/list"));
  assert.equal(response.status, 200);
  const envelope = await response.json();
  const tools = envelope.result.tools;
  assert.deepEqual(tools.map(({ name }) => name).sort(), EXPECTED_TOOLS);
  assert.equal(tools.length, 7);
  assert.equal(tools.some(({ name }) => /(?:shell|script|sql|eval|exec|admin)/iu.test(name)), false);

  const arbitraryMethod = await route.POST(mcpRequest("shell/execute"));
  assert.equal(arbitraryMethod.status, 404);
  assert.deepEqual(await arbitraryMethod.json(), {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32601, message: "Method not found" },
  });
});

test("MCP route rejects the legacy initialize handshake", async (t) => {
  configureCapability();
  t.after(clearCapability);
  const request = new Request("http://127.0.0.1/api/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      host: "127.0.0.1",
      origin: "http://127.0.0.1",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "legacy-client", version: "1.0.0" },
      },
    }),
  });
  const response = await route.POST(request);
  assert.equal(response.status, 400);
  const envelope = await response.json();
  assert.equal(envelope.error.code, -32022);
  assert.match(envelope.error.message, /Unsupported protocol version/u);
});
