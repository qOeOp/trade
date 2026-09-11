import {
  RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
  RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
  RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
  RESEARCH_SHADOW_RESOLVE_OPERATION,
  type RegisteredOperationId,
} from "./operation-registry.ts";

type OwnerApiEnvironmentV1 = Record<string, string | undefined>;

const BEARER_CREDENTIAL = /^[!-~]+$/u;

export type OwnerApiTargetV1 = {
  baseUrl: string | undefined;
  token: string | undefined;
};

export function ownerApiTargetAvailableV1(target: OwnerApiTargetV1): boolean {
  if (!target.baseUrl || !target.token || !BEARER_CREDENTIAL.test(target.token)
    || Buffer.byteLength(target.token, "utf8") > 4_096) {
    return false;
  }
  try {
    const base = new URL(target.baseUrl);
    return ["http:", "https:"].includes(base.protocol)
      && !base.username && !base.password && !base.search && !base.hash;
  } catch {
    return false;
  }
}

export function ownerApiTargetForOperationV1(
  operationId: RegisteredOperationId,
  environment: OwnerApiEnvironmentV1 = process.env,
): OwnerApiTargetV1 {
  if (operationId === RESEARCH_SHADOW_RESOLVE_OPERATION) {
    const researchBaseUrl = environment.RD_RESEARCH_OWNER_READ_API_URL || undefined;
    const researchToken = environment.RD_RESEARCH_OWNER_READ_API_TOKEN || undefined;
    if (researchBaseUrl || researchToken) {
      return { baseUrl: researchBaseUrl, token: researchToken };
    }
  }
  const usesReadApi = operationId === RD_FORMATION_CATALOG_SHADOW_READ_OPERATION
    || operationId === RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION
    || operationId === RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION;
  const readBaseUrl = environment.RD_OWNER_READ_API_URL || undefined;
  const readToken = environment.RD_OWNER_READ_API_TOKEN || undefined;
  if (usesReadApi && (readBaseUrl || readToken)) {
    return {
      baseUrl: readBaseUrl,
      token: readToken,
    };
  }
  return {
    baseUrl: environment.RD_OWNER_API_URL,
    token: environment.RD_OWNER_API_TOKEN,
  };
}
