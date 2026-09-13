import { createHash, timingSafeEqual } from "node:crypto";

import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

const PRINCIPAL = /^[A-Za-z0-9._:/-]{1,96}$/;
const HOSTNAME = /^(?:localhost|127\.0\.0\.1|\[::1\]|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)$/;
const BEARER = /^[!-~]+$/u;

export type DashboardMcpCapabilityV1 = {
  schema_version: 1;
  token: string;
  principal_ref: string;
  expires_at_epoch_seconds: number;
  allowed_hostnames: string[];
  allowed_origin_hostnames: string[];
};

function hostnameList(value: string | undefined): string[] | null {
  const values = (value ?? "localhost,127.0.0.1,[::1]")
    .split(",")
    .map((entry) => entry.trim().toLowerCase());
  return values.length > 0 && values.length <= 16
    && new Set(values).size === values.length && values.every((entry) => HOSTNAME.test(entry))
    ? values : null;
}

export function configuredDashboardMcpCapabilityV1(
  environment: Record<string, string | undefined> = process.env,
  nowEpochSeconds = Math.floor(Date.now() / 1_000),
): DashboardMcpCapabilityV1 | null {
  const token = environment.DASHBOARD_MCP_API_TOKEN;
  const principal = environment.DASHBOARD_MCP_PRINCIPAL_REF;
  const expires = Number(environment.DASHBOARD_MCP_TOKEN_EXPIRES_AT_EPOCH_SECONDS);
  const allowedHostnames = hostnameList(environment.DASHBOARD_MCP_ALLOWED_HOSTNAMES);
  const allowedOrigins = hostnameList(environment.DASHBOARD_MCP_ALLOWED_ORIGIN_HOSTNAMES);
  if (!token || !principal || !BEARER.test(token)
    || Buffer.byteLength(token, "utf8") < 32 || Buffer.byteLength(token, "utf8") > 4_096
    || !PRINCIPAL.test(principal) || !Number.isSafeInteger(expires)
    || expires <= nowEpochSeconds || expires > nowEpochSeconds + 86_400
    || !allowedHostnames || !allowedOrigins) return null;
  return {
    schema_version: 1,
    token,
    principal_ref: principal,
    expires_at_epoch_seconds: expires,
    allowed_hostnames: allowedHostnames,
    allowed_origin_hostnames: allowedOrigins,
  };
}

export function dashboardMcpAuthorizationDigestV1(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

export function dashboardMcpTokenVerifierV1(
  capability: DashboardMcpCapabilityV1,
): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const supplied = Buffer.from(token, "utf8");
      const expected = Buffer.from(capability.token, "utf8");
      if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "invalid MCP capability");
      }
      return {
        token,
        clientId: capability.principal_ref,
        scopes: ["dashboard:mcp"],
        expiresAt: capability.expires_at_epoch_seconds,
      };
    },
  };
}
