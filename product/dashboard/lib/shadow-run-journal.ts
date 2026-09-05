import type { RegisteredOperationId } from "./operation-registry.ts";
import type { OperationalRunReferenceV1 } from "./operational-run-reference.ts";
import type { RunTerminalCodeV1 } from "./run-contract.ts";
import {
  configuredRunStoreV1,
  type OperationRunV1,
  type OwnerOutcomeState,
  type PostgresRunStoreV1,
} from "./run-store.ts";

type ShadowResult = {
  status: number;
  envelope: {
    availability: "available" | "unavailable";
    unavailable_reason: string | null;
    projection: unknown;
  } & Record<string, unknown>;
};

export type { OperationalRunReferenceV1 } from "./operational-run-reference.ts";

export function ownerOutcomeForShadowResultV1(result: ShadowResult): {
  state: OwnerOutcomeState;
  terminalCode: RunTerminalCodeV1;
} {
  if (result.envelope.availability === "unavailable") {
    return { state: "unavailable", terminalCode: "OWNER_UNAVAILABLE" };
  }
  if (!result.envelope.projection || typeof result.envelope.projection !== "object") {
    return { state: "unavailable", terminalCode: "OWNER_UNAVAILABLE" };
  }
  const projectionAvailability = "availability" in result.envelope.projection
    ? result.envelope.projection.availability
    : undefined;
  if (projectionAvailability === "UNAVAILABLE") {
    return { state: "unavailable", terminalCode: "OWNER_UNAVAILABLE" };
  }
  if (projectionAvailability === "STALE") {
    return { state: "unknown", terminalCode: "OWNER_UNKNOWN" };
  }
  const resolution = "resolution" in result.envelope.projection
    ? result.envelope.projection.resolution
    : undefined;
  switch (resolution) {
    case undefined:
      return { state: "available", terminalCode: "OWNER_AVAILABLE" };
    case "ACCEPTED":
    case "SUCCESS":
    case "RETRIEVED":
    case "LEGACY_TERMINAL_QUARANTINED":
      return { state: "available", terminalCode: "OWNER_AVAILABLE" };
    case "REJECTED_NO_WRITE":
    case "FAILED_NO_ARTIFACT":
    case "NOT_FOUND":
    case "AUTH_REQUIRED":
    case "ACCESS_DENIED":
    case "RATE_LIMITED":
    case "TERMS_OR_LICENSE_BLOCKED":
    case "MALFORMED":
    case "UNAVAILABLE":
      return { state: "rejected", terminalCode: "OWNER_REJECTED" };
    case "SUBMITTED_OR_UNKNOWN":
    case "OUTCOME_UNKNOWN":
      return { state: "unknown", terminalCode: "OWNER_UNKNOWN" };
    default:
      return { state: "unavailable", terminalCode: "OWNER_UNAVAILABLE" };
  }
}

function unavailable(
  reason: string,
  run: OperationRunV1 | null = null,
): OperationalRunReferenceV1 {
  return {
    schema_version: 1,
    availability: "unavailable",
    unavailable_reason: reason,
    run_identity: run?.run_identity ?? null,
    state: run?.state ?? null,
    owner_outcome_state: run?.owner_outcome_state ?? null,
    transition_version: run?.transition_version ?? null,
  };
}

function available(run: OperationRunV1): OperationalRunReferenceV1 {
  return {
    schema_version: 1,
    availability: "available",
    unavailable_reason: null,
    run_identity: run.run_identity,
    state: run.state,
    owner_outcome_state: run.owner_outcome_state,
    transition_version: run.transition_version,
  };
}

export async function journalShadowReadV1<T extends ShadowResult>({
  operationId,
  recoveryIdentity,
  read,
  store = configuredRunStoreV1(),
}: {
  operationId: RegisteredOperationId;
  recoveryIdentity: Record<string, string>;
  read: () => Promise<T>;
  store?: Pick<PostgresRunStoreV1, "assertSchema" | "beginRead" | "completeRead"> | null;
}): Promise<T & { envelope: T["envelope"] & { operational_run: OperationalRunReferenceV1 } }> {
  let started: OperationRunV1 | null = null;
  let operationalRun = unavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE");
  if (store) {
    try {
      await store.assertSchema();
      started = await store.beginRead(operationId, recoveryIdentity);
      operationalRun = available(started);
    } catch {
      operationalRun = unavailable("RUN_STORE_UNAVAILABLE");
    }
  }

  const result = await read();
  if (store && started) {
    const outcome = ownerOutcomeForShadowResultV1(result);
    try {
      operationalRun = available(await store.completeRead({
        runIdentity: started.run_identity,
        expectedTransitionVersion: started.transition_version,
        ownerOutcomeState: outcome.state,
        terminalCode: outcome.terminalCode,
      }));
    } catch {
      operationalRun = unavailable("RUN_STORE_TRANSITION_UNAVAILABLE", started);
    }
  }
  return {
    ...result,
    envelope: { ...result.envelope, operational_run: operationalRun },
  };
}
