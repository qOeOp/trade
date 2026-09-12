import assert from "node:assert/strict";
import test from "node:test";

import {
  configuredDashboardMcpCapabilityV1,
  dashboardMcpAuthorizationDigestV1,
  dashboardMcpTokenVerifierV1,
} from "../lib/mcp-capability.ts";

const NOW = 1_800_000_000;
const TOKEN = "dashboard-mcp-test-capability-token-0001";

function validEnvironment(overrides = {}) {
  return {
    DASHBOARD_MCP_API_TOKEN: TOKEN,
    DASHBOARD_MCP_PRINCIPAL_REF: "dashboard-mcp-test-client",
    DASHBOARD_MCP_TOKEN_EXPIRES_AT_EPOCH_SECONDS: String(NOW + 3_600),
    DASHBOARD_MCP_ALLOWED_HOSTNAMES: "LOCALHOST,127.0.0.1,[::1]",
    DASHBOARD_MCP_ALLOWED_ORIGIN_HOSTNAMES: "localhost,127.0.0.1,[::1]",
    ...overrides,
  };
}

test("MCP capability configuration is finite, bounded, and fail closed", () => {
  const capability = configuredDashboardMcpCapabilityV1(validEnvironment(), NOW);
  assert.deepEqual(capability, {
    schema_version: 1,
    token: TOKEN,
    principal_ref: "dashboard-mcp-test-client",
    expires_at_epoch_seconds: NOW + 3_600,
    allowed_hostnames: ["localhost", "127.0.0.1", "[::1]"],
    allowed_origin_hostnames: ["localhost", "127.0.0.1", "[::1]"],
  });

  for (const environment of [
    {},
    validEnvironment({ DASHBOARD_MCP_API_TOKEN: "short" }),
    validEnvironment({ DASHBOARD_MCP_API_TOKEN: `valid-prefix-${String.fromCharCode(10)}invalid` }),
    validEnvironment({ DASHBOARD_MCP_PRINCIPAL_REF: "principal with spaces" }),
    validEnvironment({ DASHBOARD_MCP_TOKEN_EXPIRES_AT_EPOCH_SECONDS: String(NOW) }),
    validEnvironment({ DASHBOARD_MCP_TOKEN_EXPIRES_AT_EPOCH_SECONDS: String(NOW + 86_401) }),
    validEnvironment({ DASHBOARD_MCP_ALLOWED_HOSTNAMES: "127.0.0.1,127.0.0.1" }),
    validEnvironment({ DASHBOARD_MCP_ALLOWED_ORIGIN_HOSTNAMES: "https://localhost" }),
  ]) {
    assert.equal(configuredDashboardMcpCapabilityV1(environment, NOW), null);
  }
});

test("MCP bearer verifier accepts only the exact finite capability", async () => {
  const capability = configuredDashboardMcpCapabilityV1(validEnvironment(), NOW);
  assert.ok(capability);
  const verifier = dashboardMcpTokenVerifierV1(capability);

  assert.deepEqual(await verifier.verifyAccessToken(TOKEN), {
    token: TOKEN,
    clientId: "dashboard-mcp-test-client",
    scopes: ["dashboard:mcp"],
    expiresAt: NOW + 3_600,
  });
  await assert.rejects(verifier.verifyAccessToken(`${TOKEN}x`), /invalid MCP capability/u);
  await assert.rejects(verifier.verifyAccessToken(TOKEN.slice(0, -1)), /invalid MCP capability/u);

  const digest = dashboardMcpAuthorizationDigestV1(TOKEN);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(digest.includes(TOKEN), false);
});
