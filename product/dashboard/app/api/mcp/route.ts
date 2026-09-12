import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
  requireBearerAuth,
} from "@modelcontextprotocol/server";

import { createDashboardMcpServerV1 } from "@/lib/dashboard-mcp-server";
import {
  configuredDashboardMcpCapabilityV1,
  dashboardMcpTokenVerifierV1,
} from "@/lib/mcp-capability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createMcpHandler(({ authInfo }) => {
  if (!authInfo) throw new Error("MCP_AUTHORIZATION_UNAVAILABLE");
  return createDashboardMcpServerV1(authInfo);
}, { responseMode: "json", legacy: "reject" });

async function serve(request: Request): Promise<Response> {
  const capability = configuredDashboardMcpCapabilityV1();
  if (!capability) {
    return Response.json({ error: "MCP_CONFIGURATION_UNAVAILABLE" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  const rejected = hostHeaderValidationResponse(request, capability.allowed_hostnames)
    ?? originValidationResponse(request, capability.allowed_origin_hostnames);
  if (rejected) return rejected;
  const authenticate = requireBearerAuth({
    verifier: dashboardMcpTokenVerifierV1(capability),
    requiredScopes: ["dashboard:mcp"],
  });
  const authInfo = await authenticate(request);
  if (authInfo instanceof Response) return authInfo;
  return handler.fetch(request, { authInfo });
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
