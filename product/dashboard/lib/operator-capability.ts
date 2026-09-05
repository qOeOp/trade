import { timingSafeEqual } from "node:crypto";
import { createHash } from "node:crypto";

const MAX_CAPABILITY_BYTES = 4_096;

export type OperatorCapabilityStateV1 = "available" | "configuration_unavailable" | "denied";

export function verifyOperatorCapabilityV1(
  authorization: string | null,
  configuredCapability: string | undefined = process.env.DASHBOARD_OPERATOR_API_TOKEN,
): OperatorCapabilityStateV1 {
  if (!configuredCapability || Buffer.byteLength(configuredCapability, "utf8") < 32
    || Buffer.byteLength(configuredCapability, "utf8") > MAX_CAPABILITY_BYTES) {
    return "configuration_unavailable";
  }
  if (!authorization?.startsWith("Bearer ")) return "denied";
  const provided = authorization.slice("Bearer ".length);
  if (Buffer.byteLength(provided, "utf8") > MAX_CAPABILITY_BYTES) return "denied";
  const expectedBytes = Buffer.from(configuredCapability, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
    ? "available"
    : "denied";
}

export function operatorCapabilityAuthorizationDigestV1(
  configuredCapability: string | undefined = process.env.DASHBOARD_OPERATOR_API_TOKEN,
): string | null {
  if (!configuredCapability || Buffer.byteLength(configuredCapability, "utf8") < 32
    || Buffer.byteLength(configuredCapability, "utf8") > MAX_CAPABILITY_BYTES) return null;
  return `sha256:${createHash("sha256").update(configuredCapability).digest("hex")}`;
}
