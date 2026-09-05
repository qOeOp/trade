import {
  projectRunDetailEnvelopeV1,
  type RunDetailEnvelopeV1,
} from "./run-detail-projection.ts";
import { configuredRunStoreV1, isRunIdentityV1 } from "./run-store.ts";
import { operatorCapabilityAuthorizationDigestV1 } from "./operator-capability.ts";

export type RunDetailGatewayResultV1 = {
  status: 200 | 400 | 404 | 503;
  envelope: RunDetailEnvelopeV1;
};

export function unavailableRunDetailEnvelopeV1(
  runIdentity: string,
  reason: string,
): RunDetailEnvelopeV1 {
  return {
    schema_version: 1,
    operation: "dashboard.run_store.detail.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: new Date().toISOString(),
    run_identity: runIdentity,
    run: null,
    bounded_result: null,
    logs: [],
    operational_cache: null,
    operational_cancellation: null,
  };
}

export async function readRunDetailGatewayV1(runIdentity: string): Promise<RunDetailGatewayResultV1> {
  if (!isRunIdentityV1(runIdentity)) {
    return { status: 400, envelope: unavailableRunDetailEnvelopeV1(runIdentity, "RUN_IDENTITY_INVALID") };
  }
  try {
    const store = configuredRunStoreV1();
    if (!store) {
      return {
        status: 503,
        envelope: unavailableRunDetailEnvelopeV1(runIdentity, "RUN_STORE_CONFIGURATION_UNAVAILABLE"),
      };
    }
    await store.assertSchema();
    const authorizationDigest = operatorCapabilityAuthorizationDigestV1();
    const detail = await store.readRunDetail(runIdentity, authorizationDigest
      ? { authorizationDigest, principalRef: "local_operator" }
      : undefined);
    return detail
      ? { status: 200, envelope: projectRunDetailEnvelopeV1(detail) }
      : { status: 404, envelope: unavailableRunDetailEnvelopeV1(runIdentity, "RUN_NOT_FOUND") };
  } catch {
    return { status: 503, envelope: unavailableRunDetailEnvelopeV1(runIdentity, "RUN_STORE_UNAVAILABLE") };
  }
}
