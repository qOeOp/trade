import {
  type ProductEdgeRoutingLookupKeyV1,
  type ProductEdgeRoutingObservationV1,
} from "./product-edge-routing-client.ts";
import { configuredDisposableOwnerTransportV1 } from "./rd-owner-http.ts";
import {
  validControlPlaneAdmissionContextV1,
  type ControlPlaneAdmissionContextV1,
} from "./control-plane-admission-contract.ts";
import {
  executeResearchGoalOperationV2,
  resolveResearchGoalOperationV2,
} from "./research-goal-operation.ts";
import {
  executeSourceIntakeOperationV1,
  resolveSourceIntakeOperationV1,
} from "./source-intake-operation.ts";
import {
  validSourceResearchOperationRequestV1,
  type SourceResearchRunRequestV1,
  type SourceResearchOperationRequestV1,
} from "./source-research-input-contract.ts";
import { sourceResearchRunInputCustodyV1 } from "./source-research-run-input-custody.ts";
import {
  configuredEffectDispatchTargetV1,
  effectDispatchRequestDigestV1,
  effectDispatchTargetDigestV1,
  type EffectDispatchClaimV1,
} from "./effect-dispatch-contract.ts";
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
} from "./source-research-run-contract.ts";

export type { SourceResearchOperationRequestV1 } from "./source-research-input-contract.ts";

type Environment = Record<string, string | undefined>;
type Fetcher = typeof fetch;
type JsonRecord = Record<string, unknown>;

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

type SourceResearchQueueStoreV1 = Pick<PostgresRunStoreV1,
  | "assertEffectDispatchSchema"
  | "readSourceResearchRecovery"
  | "beginSourceResearch">;

type ClaimedSourceResearchStoreV1 = Pick<PostgresRunStoreV1,
  | "readSourceResearchRecovery"
  | "recordSourceResearchPhase"
  | "completeSourceResearch">;

export type ClaimedSourceResearchOutcomeV1 = "terminal" | "retry";

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
  return validSourceResearchOperationRequestV1(request);
}

export async function enqueueSourceResearchOperationV1({
  request,
  actionContext,
  environment = process.env,
  routingResolver,
  nowEpochMs = Date.now(),
  store = configuredRunStoreV1(),
}: {
  request: SourceResearchOperationRequestV1;
  actionContext: ControlPlaneAdmissionContextV1;
  environment?: Environment;
  routingResolver?: (
    key: ProductEdgeRoutingLookupKeyV1,
  ) => Promise<ProductEdgeRoutingObservationV1>;
  nowEpochMs?: number;
  store?: SourceResearchQueueStoreV1 | null;
}): Promise<SourceResearchOperationResponseV1> {
  if (!validRequest(request) || request.action !== "RUN") {
    return unavailable("EXECUTION_REQUEST_INVALID", 400);
  }
  if (!validControlPlaneAdmissionContextV1(actionContext)
    || actionContext.requestedAction !== "RUN") {
    return unavailable("EXECUTION_AUTHORIZATION_UNAVAILABLE", 503);
  }
  if (environment.DASHBOARD_DEPLOYMENT_CLASS !== "DISPOSABLE_LOCAL"
    || environment.DASHBOARD_DISPOSABLE_SOURCE_RESEARCH_EXECUTION !== "ENABLED") {
    return unavailable("EXECUTION_CONFIGURATION_UNAVAILABLE", 503);
  }
  const dispatchTarget = configuredEffectDispatchTargetV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    environment,
  );
  if (!dispatchTarget) return unavailable("EXECUTION_CONFIGURATION_UNAVAILABLE", 503);
  if (!store) return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  const recoveryIdentity = {
    source_request_identity: request.source.request_identity,
    research_request_identity: request.research.request_identity,
  };
  const submittedCustody = sourceResearchRunInputCustodyV1(request);
  if (!submittedCustody) return unavailable("EXECUTION_REQUEST_INVALID", 400);
  try {
    await store.assertEffectDispatchSchema();
    const recovery = await store.readSourceResearchRecovery(recoveryIdentity);
    if (recovery) {
      if (recovery.input_custody.availability !== "available") {
        return unavailable("EXECUTION_INPUT_CUSTODY_UNAVAILABLE", 409, recovery.run);
      }
      if (recovery.input_custody.request_digest !== submittedCustody.request_digest) {
        return unavailable("EXECUTION_REQUEST_CONFLICT", 409, recovery.run);
      }
      if (["queued", "running"].includes(recovery.run.state)) {
        return {
          status: 202,
          envelope: {
            schema_version: 1,
            operation: SOURCE_RESEARCH_EXECUTE_OPERATION,
            channel: "DASHBOARD_DISPOSABLE_EXECUTION",
            availability: "available",
            unavailable_reason: null,
            source: null,
            research: null,
            operational_run: operationalRunAvailableV1(recovery.run),
          },
        };
      }
      return unavailable("EXECUTION_PRIOR_RUN_TERMINAL", 409, recovery.run);
    }
  } catch {
    return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  }
  const admission = await admitSourceResearchExecutionV1({
    action: "RUN",
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
  try {
    const started = await store.beginSourceResearch({
      action: "RUN",
      recoveryIdentity,
      admission,
      actionContext,
      runRequest: request,
      dispatchMode: "queue",
      dispatchTarget,
    });
    return {
      status: 202,
      envelope: {
        schema_version: 1,
        operation: SOURCE_RESEARCH_EXECUTE_OPERATION,
        channel: "DASHBOARD_DISPOSABLE_EXECUTION",
        availability: "available",
        unavailable_reason: null,
        source: null,
        research: null,
        operational_run: operationalRunAvailableV1(started.run),
      },
    };
  } catch {
    return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  }
}

export async function executeClaimedSourceResearchOperationV1({
  claim,
  environment = process.env,
  fetcher = fetch,
  store,
}: {
  claim: EffectDispatchClaimV1;
  environment?: Environment;
  fetcher?: Fetcher;
  store: ClaimedSourceResearchStoreV1;
}): Promise<ClaimedSourceResearchOutcomeV1> {
  if (claim.operation_id !== SOURCE_RESEARCH_EXECUTE_OPERATION
    || !validRequest(claim.request as SourceResearchOperationRequestV1)
    || (claim.request as SourceResearchOperationRequestV1).action !== "RUN"
    || effectDispatchRequestDigestV1(claim.operation_id, claim.request) !== claim.request_digest
    || effectDispatchTargetDigestV1(claim.operation_id, claim.frozen_target)
      !== claim.frozen_target_digest
    || claim.frozen_context !== null || claim.frozen_context_digest !== null) return "retry";
  const request = claim.request as SourceResearchRunRequestV1;
  const configuredTarget = configuredEffectDispatchTargetV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    environment,
  );
  if (!configuredTarget
    || effectDispatchTargetDigestV1(claim.operation_id, configuredTarget)
      !== claim.frozen_target_digest) return "retry";
  const ownerTransport = configuredDisposableOwnerTransportV1({
    environment,
    enablementKey: "DASHBOARD_DISPOSABLE_SOURCE_RESEARCH_EXECUTION",
    fetcher,
    ownerUrl: claim.frozen_target.owner_url,
  });
  if (!ownerTransport) return "retry";
  let recovery: SourceResearchRecoverySnapshotV1 | null;
  try {
    recovery = await store.readSourceResearchRecovery({
      source_request_identity: request.source.request_identity,
      research_request_identity: request.research.request_identity,
    });
  } catch {
    return "retry";
  }
  const submittedCustody = sourceResearchRunInputCustodyV1(request);
  if (!recovery || !submittedCustody
    || recovery.run.run_identity !== claim.run_identity
    || recovery.run.state !== "running"
    || recovery.requested_action !== "RUN"
    || recovery.input_custody.availability !== "available"
    || recovery.input_custody.request_digest !== submittedCustody.request_digest) return "retry";

  let transitionVersion = claim.transition_version;
  const observed = new Set(recovery.observed_phases);
  const record = async (phase: "SOURCE_OWNER_AVAILABLE" | "RESEARCH_OWNER_AVAILABLE") => {
    const run = await store.recordSourceResearchPhase({
      runIdentity: claim.run_identity,
      expectedTransitionVersion: transitionVersion,
      phase,
    });
    transitionVersion = run.transition_version;
    observed.add(phase);
  };

  let sourceResult = observed.has("SOURCE_OWNER_AVAILABLE") || claim.claim_attempt > 1
    ? await resolveSourceIntakeOperationV1({
      requestIdentity: request.source.request_identity,
      transport: ownerTransport,
    })
    : await executeSourceIntakeOperationV1({
      action: "RUN",
      input: request.source,
      transport: ownerTransport,
      routing: recovery.routing.source,
    });
  if (sourceResult.availability !== "available" && claim.claim_attempt === 1
    && !observed.has("SOURCE_OWNER_AVAILABLE")) {
    sourceResult = await resolveSourceIntakeOperationV1({
      requestIdentity: request.source.request_identity,
      transport: ownerTransport,
    });
  }
  if (sourceResult.availability !== "available" || !sourceResult.owner_response
    || !sourceResult.ancestry) return "retry";
  try {
    if (!observed.has("SOURCE_OWNER_AVAILABLE")) await record("SOURCE_OWNER_AVAILABLE");
  } catch {
    return "retry";
  }

  let researchResult = observed.has("RESEARCH_OWNER_AVAILABLE") || claim.claim_attempt > 1
    ? await resolveResearchGoalOperationV2({
      requestIdentity: request.research.request_identity,
      transport: ownerTransport,
    })
    : await executeResearchGoalOperationV2({
      action: "RUN",
      input: request.research,
      ancestry: sourceResult.ancestry,
      transport: ownerTransport,
      routing: recovery.routing.research,
    });
  if (researchResult.availability !== "available" && claim.claim_attempt === 1
    && !observed.has("RESEARCH_OWNER_AVAILABLE")) {
    researchResult = await resolveResearchGoalOperationV2({
      requestIdentity: request.research.request_identity,
      transport: ownerTransport,
    });
  }
  if (researchResult.availability !== "available" || !researchResult.owner_response
    || !researchResult.owner_outcome_state) return "retry";
  try {
    if (!observed.has("RESEARCH_OWNER_AVAILABLE")) await record("RESEARCH_OWNER_AVAILABLE");
    await store.completeSourceResearch({
      runIdentity: claim.run_identity,
      expectedTransitionVersion: transitionVersion,
      ownerOutcomeState: researchResult.owner_outcome_state,
    });
  } catch {
    return "retry";
  }
  return "terminal";
}

export async function executeSourceResearchOperationV1({
  request,
  actionContext,
  environment = process.env,
  fetcher = fetch,
  routingResolver,
  nowEpochMs = Date.now(),
  store = configuredRunStoreV1(),
}: {
  request: SourceResearchOperationRequestV1;
  actionContext: ControlPlaneAdmissionContextV1;
  environment?: Environment;
  fetcher?: Fetcher;
  routingResolver?: (
    key: ProductEdgeRoutingLookupKeyV1,
  ) => Promise<ProductEdgeRoutingObservationV1>;
  nowEpochMs?: number;
  store?: SourceResearchStoreV1 | null;
}): Promise<SourceResearchOperationResponseV1> {
  if (!validRequest(request)) return unavailable("EXECUTION_REQUEST_INVALID", 400);
  if (!validControlPlaneAdmissionContextV1(actionContext)
    || actionContext.requestedAction !== request.action) {
    return unavailable("EXECUTION_AUTHORIZATION_UNAVAILABLE", 503);
  }
  const ownerTransport = configuredDisposableOwnerTransportV1({
    environment,
    enablementKey: "DASHBOARD_DISPOSABLE_SOURCE_RESEARCH_EXECUTION",
    fetcher,
  });
  if (!ownerTransport) return unavailable("EXECUTION_CONFIGURATION_UNAVAILABLE", 503);
  if (!store) return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);

  const recoveryIdentity = request.action === "RUN" ? {
    source_request_identity: request.source.request_identity,
    research_request_identity: request.research.request_identity,
  } : {
    source_request_identity: request.source_request_identity,
    research_request_identity: request.research_request_identity,
  };
  let recovery: SourceResearchRecoverySnapshotV1 | null;
  try {
    await store.assertSourceResearchSchema();
    recovery = await store.readSourceResearchRecovery(recoveryIdentity);
  } catch {
    return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  }

  if (!recovery && request.action === "RESOLVE") {
    return unavailable("EXECUTION_RECOVERY_NOT_FOUND", 404);
  }

  if (recovery && request.action === "RUN") {
    const submittedCustody = sourceResearchRunInputCustodyV1(request);
    if (recovery.input_custody.availability !== "available") {
      return unavailable("EXECUTION_INPUT_CUSTODY_UNAVAILABLE", 409, recovery.run);
    }
    if (!submittedCustody
      || submittedCustody.request_digest !== recovery.input_custody.request_digest) {
      return unavailable("EXECUTION_REQUEST_CONFLICT", 409, recovery.run);
    }
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

  let started;
  try {
    started = await store.beginSourceResearch({
      action: effectiveAction,
      recoveryIdentity,
      admission,
      actionContext,
      runRequest: request.action === "RUN" ? request : null,
      existingRecoveryOnly: recovery !== null,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "SOURCE_RESEARCH_INPUT_CUSTODY_UNAVAILABLE") {
      return unavailable("EXECUTION_INPUT_CUSTODY_UNAVAILABLE", 409, recovery?.run ?? null);
    }
    if (reason === "SOURCE_RESEARCH_INPUT_CUSTODY_CONFLICT") {
      return unavailable("EXECUTION_REQUEST_CONFLICT", 409, recovery?.run ?? null);
    }
    return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  }
  let currentRun = started.run;
  if (!recovery && started.execution_mode === "RESOLVE_ONLY") {
    try {
      recovery = await store.readSourceResearchRecovery(recoveryIdentity);
    } catch {
      return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503, currentRun);
    }
    if (!recovery) return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503, currentRun);
  }
  const recoveryPhases = new Set(recovery?.observed_phases ?? []);
  const retainedInput = started.input_custody.availability === "available"
    ? started.input_custody.request
    : recovery?.input_custody.availability === "available"
      ? recovery.input_custody.request
      : null;
  const runInput: SourceResearchRunRequestV1 | null = started.execution_mode === "FRESH_RUN"
    && request.action === "RUN" ? request : retainedInput;
  const priorRunWithoutInput = started.execution_mode === "RESOLVE_ONLY"
    && recovery?.requested_action === "RUN" && !runInput;
  const canResumeMissingStage = started.execution_mode === "RESOLVE_ONLY"
    && recovery?.requested_action === "RUN" && runInput !== null;
  const retainedRouting = recovery?.routing ?? routing;

  let sourceResult = request.action === "RESOLVE"
    ? await resolveSourceIntakeOperationV1({
      requestIdentity: request.source_request_identity,
      transport: ownerTransport,
    })
    : await executeSourceIntakeOperationV1({
      action: started.execution_mode === "FRESH_RUN" ? effectiveAction : "RESOLVE",
      input: runInput?.source ?? request.source,
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
      input: runInput.source,
      transport: ownerTransport,
      routing: retainedRouting.source,
    });
    if (sourceResult.unavailable_reason === "SOURCE_OWNER_UNKNOWN") {
      sourceResult = await resolveSourceIntakeOperationV1({
        requestIdentity: runInput.source.request_identity,
        transport: ownerTransport,
      });
    }
  }
  if (started.execution_mode === "RESOLVE_ONLY"
    && !recoveryPhases.has("SOURCE_OWNER_AVAILABLE")
    && ["SOURCE_OWNER_ABSENT", "SOURCE_OWNER_UNKNOWN"].includes(
      sourceResult.unavailable_reason ?? "",
    )
    && priorRunWithoutInput) {
    return unavailable("EXECUTION_INPUT_CUSTODY_UNAVAILABLE", 409, currentRun);
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

  let researchResult = request.action === "RESOLVE"
    ? await resolveResearchGoalOperationV2({
      requestIdentity: request.research_request_identity,
      transport: ownerTransport,
    })
    : await executeResearchGoalOperationV2({
      action: started.execution_mode === "FRESH_RUN" ? effectiveAction : "RESOLVE",
      input: runInput?.research ?? request.research,
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
      input: runInput.research,
      ancestry: sourceResult.ancestry,
      transport: ownerTransport,
      routing: retainedRouting.research,
    });
    if (researchResult.unavailable_reason === "RESEARCH_OWNER_UNKNOWN") {
      researchResult = await resolveResearchGoalOperationV2({
        requestIdentity: runInput.research.request_identity,
        transport: ownerTransport,
      });
    }
  }
  if (started.execution_mode === "RESOLVE_ONLY"
    && !recoveryPhases.has("RESEARCH_OWNER_AVAILABLE")
    && ["RESEARCH_OWNER_ABSENT", "RESEARCH_OWNER_UNKNOWN"].includes(
      researchResult.unavailable_reason ?? "",
    )
    && priorRunWithoutInput) {
    return unavailable("EXECUTION_INPUT_CUSTODY_UNAVAILABLE", 409, currentRun);
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
  const sourceIdentity = request.action === "RUN"
    ? request.source.request_identity : request.source_request_identity;
  const researchIdentity = request.action === "RUN"
    ? request.research.request_identity : request.research_request_identity;
  const sourceResult = await resolveSourceIntakeOperationV1({
    requestIdentity: sourceIdentity,
    transport: ownerTransport,
  });
  if (sourceResult.availability !== "available" || !sourceResult.owner_response
    || !sourceResult.ancestry) {
    return unavailable(
      sourceResult.unavailable_reason ?? "SOURCE_OWNER_RESPONSE_UNAVAILABLE",
      503,
      storeRun,
    );
  }
  const researchResult = await resolveResearchGoalOperationV2({
    requestIdentity: researchIdentity,
    transport: ownerTransport,
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
