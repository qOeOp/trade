import {
  RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
  RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
  RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
  type RegisteredOperationId,
} from "./operation-registry.ts";

type OwnerApiEnvironmentV1 = Record<string, string | undefined>;

export type OwnerApiTargetV1 = {
  baseUrl: string | undefined;
  token: string | undefined;
};

export function ownerApiTargetForOperationV1(
  operationId: RegisteredOperationId,
  environment: OwnerApiEnvironmentV1 = process.env,
): OwnerApiTargetV1 {
  const usesReadApi = operationId === RD_FORMATION_CATALOG_SHADOW_READ_OPERATION
    || operationId === RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION
    || operationId === RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION;
  if (usesReadApi
    && (environment.RD_OWNER_READ_API_URL !== undefined
      || environment.RD_OWNER_READ_API_TOKEN !== undefined)) {
    return {
      baseUrl: environment.RD_OWNER_READ_API_URL,
      token: environment.RD_OWNER_READ_API_TOKEN,
    };
  }
  return {
    baseUrl: environment.RD_OWNER_API_URL,
    token: environment.RD_OWNER_API_TOKEN,
  };
}
