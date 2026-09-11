import {
  type ProductEdgeRoutingLookupKeyV1,
  type ProductEdgeRoutingObservationV1,
} from "./product-edge-routing-client.ts";
import { configuredDisposableOwnerTransportV1 } from "./rd-owner-http.ts";
import {
  executeResearchGoalOperationV2,
  validResearchGoalExecutionInputV2,
  type ResearchGoalExecutionInputV2,
} from "./research-goal-operation.ts";
import {
  executeSourceIntakeOperationV1,
  validSourceIntakeExecutionInputV1,
  type SourceIntakeExecutionInputV1,
} from "./source-intake-operation.ts";
import {
  operationalRunAvailableV1,
  operationalRunUnavailableV1,
  type OperationalRunReferenceV1,
} from "./operational-run-reference.ts";
import {
  configuredRunStoreV1,
  type OperationRunV1,
  type PostgresRunStoreV1,
  type SourceResearchRecoverySnapshotV1,
} from "./run-store.ts";
import {
  SOURCE_RESEARCH_EXECUTE_OPERATION,
  admitSourceResearchExecutionV1,
  unavailableSourceResearchRoutingAdmissionV1,
} from "./source-research-run-contract.ts";

type Environment = Record<string, string | undefined>;
type Fetcher = typeof fetch;
type JsonRecord = Record<string, unknown>;

export type SourceResearchOperationRequestV1 = {
  action: "RUN" | "RESOLVE";
  source: SourceIntakeExecutionInputV1;
  research: ResearchGoalExecutionInputV2;
};

export type SourceResearchOperationResponseV1 = {
  status: number;
  envelope: {
    schema_version: 1;
    operation: typeof SOURCE_RESEARCH_EXECUTE_OPERATION;
    channel: "DASHBOARD_DISPOSABLE_EXECUTION";
    availability: "available" | "unavailable";
    unavailable_reason: string | null;
    source: JsonRecord | null;
    research: JsonRecord | null;
    operational_run: OperationalRunReferenceV1;
  };
};

type SourceResearchStoreV1 = Pick<PostgresRunStoreV1,
  | "assertSourceResearchSchema"
  | "readSourceResearchRecovery"
  | "beginSourceResearch"
  | "recordSourceResearchPhase"
  | "completeSourceResearch">;

function unavailable(
  reason: string,
  status: number,
  run: OperationRunV1 | null = null,
): SourceResearchOperationResponseV1 {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: SOURCE_RESEARCH_EXECUTE_OPERATION,
      channel: "DASHBOARD_DISPOSABLE_EXECUTION",
      availability: "unavailable",
      unavailable_reason: reason,
      source: null,
      research: null,
      operational_run: operationalRunUnavailableV1(
        run ? "RUN_RECOVERY_REQUIRED" : "RUN_NOT_STARTED",
        run,
      ),
    },
  };
}

function validRequest(request: SourceResearchOperationRequestV1): boolean {
  return (request.action === "RUN" || request.action === "RESOLVE")
    && validSourceIntakeExecutionInputV1(request.source)
    && validResearchGoalExecutionInputV2(request.research);
}

export async function executeSourceResearchOperationV1({
  request,
  environment = process.env,
  fetcher = fetch,
  routingResolver,
  nowEpochMs = Date.now(),
  store = configuredRunStoreV1(),
}: {
  request: SourceResearchOperationRequestV1;
  environment?: Environment;
  fetcher?: Fetcher;
  routingResolver?: (
    key: ProductEdgeRoutingLookupKeyV1,
  ) => Promise<ProductEdgeRoutingObservationV1>;
  nowEpochMs?: number;
  store?: SourceResearchStoreV1 | null;
}): Promise<SourceResearchOperationResponseV1> {
  if (!validRequest(request)) return unavailable("EXECUTION_REQUEST_INVALID", 400);
  const ownerTransport = configuredDisposableOwnerTransportV1({
    environment,
    enablementKey: "DASHBOARD_DISPOSABLE_SOURCE_RESEARCH_EXECUTION",
    fetcher,
  });
  if (!ownerTransport) return unavailable("EXECUTION_CONFIGURATION_UNAVAILABLE", 503);
  if (!store) return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);

  const recoveryIdentity = {
    source_request_identity: request.source.request_identity,
    research_request_identity: request.research.request_identity,
  };
  let recovery: SourceResearchRecoverySnapshotV1 | null;
  try {
    await store.assertSourceResearchSchema();
    recovery = await store.readSourceResearchRecovery(recoveryIdentity);
  } catch {
    return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  }

  if (recovery && !["queued", "running"].includes(recovery.run.state)) {
    const terminalOwnerOutcome = recovery.run.state === "succeeded"
      && recovery.run.owner_outcome_state === "available"
      || recovery.run.state === "failed"
      && recovery.run.owner_outcome_state === "rejected";
    if (!terminalOwnerOutcome
      || !recovery.observed_phases.includes("SOURCE_OWNER_AVAILABLE")
      || !recovery.observed_phases.includes("RESEARCH_OWNER_AVAILABLE")) {
      return unavailable("EXECUTION_PRIOR_RUN_TERMINAL", 409, recovery.run);
    }
    return resolveCompletedRun({ request, storeRun: recovery.run, ownerTransport });
  }

  const effectiveAction = recovery ? "RESOLVE" : request.action;
  const admission = await admitSourceResearchExecutionV1({
    action: effectiveAction,
    environment,
    nowEpochMs,
    ...(routingResolver ? { routingResolver } : {}),
  });
  if (admission.availability !== "available") {
    return unavailable(
      admission.unavailable_reason === "DASHBOARD_ROUTING_UNAVAILABLE"
        ? "EXECUTION_ROUTING_UNAVAILABLE"
        : "EXECUTION_COMPATIBILITY_UNAVAILABLE",
      503,
    );
  }
  const routing = admission.routing;
  const retainedRouting = recovery?.routing ?? routing;

  let started;
  try {
    started = await store.beginSourceResearch({
      action: effectiveAction,
      recoveryIdentity,
      admission,
      existingRecoveryOnly: recovery !== null,
    });
  } catch {
    return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  }
  let currentRun = started.run;
  const recoveryPhases = new Set(recovery?.observed_phases ?? []);
  const canResumeMissingStage = request.action === "RUN"
    && recovery?.requested_action === "RUN";

  let sourceResult = await executeSourceIntakeOperationV1({
    action: started.execution_mode === "FRESH_RUN" ? effectiveAction : "RESOLVE",
    input: request.source,
    transport: ownerTransport,
    routing: routing.source,
  });
  if (started.execution_mode === "RESOLVE_ONLY"
    && !recoveryPhases.has("SOURCE_OWNER_AVAILABLE")
    && ["SOURCE_OWNER_ABSENT", "SOURCE_OWNER_UNKNOWN"].includes(
      sourceResult.unavailable_reason ?? "",
    )
    && canResumeMissingStage) {
    sourceResult = await executeSourceIntakeOperationV1({
      action: "RUN",
      input: request.source,
      transport: ownerTransport,
      routing: retainedRouting.source,
    });
    if (sourceResult.unavailable_reason === "SOURCE_OWNER_UNKNOWN") {
      sourceResult = await executeSourceIntakeOperationV1({
        action: "RESOLVE",
        input: request.source,
        transport: ownerTransport,
        routing: unavailableSourceResearchRoutingAdmissionV1().source,
      });
    }
  }
  if (sourceResult.availability !== "available" || !sourceResult.owner_response
    || !sourceResult.ancestry) {
    return unavailable(
      sourceResult.unavailable_reason ?? "SOURCE_OWNER_RESPONSE_UNAVAILABLE",
      sourceResult.unavailable_reason === "SOURCE_TERMINAL_UNAVAILABLE" ? 409 : 503,
      currentRun,
    );
  }
  try {
    currentRun = await store.recordSourceResearchPhase({
      runIdentity: currentRun.run_identity,
      expectedTransitionVersion: currentRun.transition_version,
      phase: "SOURCE_OWNER_AVAILABLE",
    });
  } catch {
    return unavailable("EXECUTION_RUN_STORE_TRANSITION_UNAVAILABLE", 503, currentRun);
  }

  let researchResult = await executeResearchGoalOperationV2({
    action: started.execution_mode === "FRESH_RUN" ? effectiveAction : "RESOLVE",
    input: request.research,
    ancestry: sourceResult.ancestry,
    transport: ownerTransport,
    routing: routing.research,
  });
  if (started.execution_mode === "RESOLVE_ONLY"
    && !recoveryPhases.has("RESEARCH_OWNER_AVAILABLE")
    && ["RESEARCH_OWNER_ABSENT", "RESEARCH_OWNER_UNKNOWN"].includes(
      researchResult.unavailable_reason ?? "",
    )
    && canResumeMissingStage) {
    researchResult = await executeResearchGoalOperationV2({
      action: "RUN",
      input: request.research,
      ancestry: sourceResult.ancestry,
      transport: ownerTransport,
      routing: retainedRouting.research,
    });
    if (researchResult.unavailable_reason === "RESEARCH_OWNER_UNKNOWN") {
      researchResult = await executeResearchGoalOperationV2({
        action: "RESOLVE",
        input: request.research,
        ancestry: sourceResult.ancestry,
        transport: ownerTransport,
        routing: unavailableSourceResearchRoutingAdmissionV1().research,
      });
    }
  }
  if (researchResult.availability !== "available" || !researchResult.owner_response) {
    return unavailable(
      researchResult.unavailable_reason ?? "RESEARCH_OWNER_RESPONSE_UNAVAILABLE",
      503,
      currentRun,
    );
  }
  try {
    currentRun = await store.recordSourceResearchPhase({
      runIdentity: currentRun.run_identity,
      expectedTransitionVersion: currentRun.transition_version,
      phase: "RESEARCH_OWNER_AVAILABLE",
    });
    currentRun = await store.completeSourceResearch({
      runIdentity: currentRun.run_identity,
      expectedTransitionVersion: currentRun.transition_version,
      ownerOutcomeState: researchResult.owner_outcome_state,
    });
  } catch {
    return unavailable("EXECUTION_RUN_STORE_TRANSITION_UNAVAILABLE", 503, currentRun);
  }
  return available(sourceResult.owner_response, researchResult.owner_response, currentRun);
}

async function resolveCompletedRun({
  request,
  storeRun,
  ownerTransport,
}: {
  request: SourceResearchOperationRequestV1;
  storeRun: OperationRunV1;
  ownerTransport: NonNullable<ReturnType<typeof configuredDisposableOwnerTransportV1>>;
}): Promise<SourceResearchOperationResponseV1> {
  const noRouting = unavailableSourceResearchRoutingAdmissionV1();
  const sourceResult = await executeSourceIntakeOperationV1({
    action: "RESOLVE",
    input: request.source,
    transport: ownerTransport,
    routing: noRouting.source,
  });
  if (sourceResult.availability !== "available" || !sourceResult.owner_response
    || !sourceResult.ancestry) {
    return unavailable(
      sourceResult.unavailable_reason ?? "SOURCE_OWNER_RESPONSE_UNAVAILABLE",
      503,
      storeRun,
    );
  }
  const researchResult = await executeResearchGoalOperationV2({
    action: "RESOLVE",
    input: request.research,
    ancestry: sourceResult.ancestry,
    transport: ownerTransport,
    routing: noRouting.research,
  });
  if (researchResult.availability !== "available" || !researchResult.owner_response
    || !["available", "rejected"].includes(researchResult.owner_outcome_state ?? "")) {
    return unavailable(
      researchResult.unavailable_reason ?? "RESEARCH_OWNER_RESPONSE_UNAVAILABLE",
      503,
      storeRun,
    );
  }
  return available(sourceResult.owner_response, researchResult.owner_response, storeRun);
}

function available(
  source: JsonRecord,
  research: JsonRecord,
  run: OperationRunV1,
): SourceResearchOperationResponseV1 {
  return {
    status: 200,
    envelope: {
      schema_version: 1,
      operation: SOURCE_RESEARCH_EXECUTE_OPERATION,
      channel: "DASHBOARD_DISPOSABLE_EXECUTION",
      availability: "available",
      unavailable_reason: null,
      source,
      research,
      operational_run: operationalRunAvailableV1(run),
    },
  };
}
