import {
  deriveGeneratedArtifactIdentitiesV1,
  executeArtifactBuildV1,
  preflightArtifactBuildV1,
  type ArtifactBuildExecutionRequestV1,
  type ArtifactBuildExecutionRuntimeV1,
} from "../../rd-owner-client/artifact_build_v1.ts";
import { admitArtifactFormationExecutionV1 } from "./artifact-formation-operation.ts";
import {
  validControlPlaneAdmissionContextV1,
  type ControlPlaneAdmissionContextV1,
} from "./control-plane-admission-contract.ts";
import {
  operationalRunAvailableV1,
  operationalRunUnavailableV1,
  type OperationalRunReferenceV1,
} from "./operational-run-reference.ts";
import {
  type ProductEdgeRoutingLookupKeyV1,
  type ProductEdgeRoutingObservationV1,
} from "./product-edge-routing-client.ts";
import {
  configuredRunStoreV1,
  type OperationRunV1,
  type PostgresRunStoreV1,
} from "./run-store.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DISPOSABLE_MODE = "DISPOSABLE_LOCAL";

type Fetcher = typeof fetch;
type Environment = Record<string, string | undefined>;

export type ArtifactFormationRequestV1 = ArtifactBuildExecutionRequestV1;

export type ArtifactFormationUnavailableV1 = {
  schema_version: 1;
  operation: "artifact_build.formation_execute.v1";
  channel: "DASHBOARD_DISPOSABLE_EXECUTION";
  availability: "unavailable";
  unavailable_reason:
    | "EXECUTION_CONFIGURATION_UNAVAILABLE"
    | "EXECUTION_COMPATIBILITY_UNAVAILABLE"
    | "EXECUTION_PREFLIGHT_UNAVAILABLE"
    | "EXECUTION_ROUTING_UNAVAILABLE"
    | "EXECUTION_AUTHORIZATION_UNAVAILABLE"
    | "EXECUTION_RUN_STORE_UNAVAILABLE"
    | "EXECUTION_RUN_STORE_TRANSITION_UNAVAILABLE"
    | "EXECUTION_REQUEST_INVALID";
  projection: null;
  operational_run: OperationalRunReferenceV1;
};

export type ArtifactFormationPreflightEnvelopeV1 = {
  schema_version: 1;
  operation: "artifact_build.formation_execute.v1";
  channel: "DASHBOARD_DISPOSABLE_EXECUTION";
  phase: "PREFLIGHT";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  research_request_identity: string;
  action_state: "READY" | "REVALIDATION_REQUIRED";
};

export type ArtifactFormationPreflightResponseV1 = {
  status: number;
  envelope: ArtifactFormationPreflightEnvelopeV1;
};

export type ArtifactFormationAvailableV1 = {
  schema_version: 1;
  operation: "artifact_build.formation_execute.v1";
  channel: "DASHBOARD_DISPOSABLE_EXECUTION";
  availability: "available";
  unavailable_reason: null;
  projection: Awaited<ReturnType<typeof executeArtifactBuildV1>>;
  operational_run: OperationalRunReferenceV1;
};

export type ArtifactFormationResponseV1 = {
  status: number;
  envelope: ArtifactFormationUnavailableV1 | ArtifactFormationAvailableV1;
};

function unavailable(
  reason: ArtifactFormationUnavailableV1["unavailable_reason"],
  status: number,
  run: OperationRunV1 | null = null,
): ArtifactFormationResponseV1 {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: "artifact_build.formation_execute.v1",
      channel: "DASHBOARD_DISPOSABLE_EXECUTION",
      availability: "unavailable",
      unavailable_reason: reason,
      projection: null,
      operational_run: operationalRunUnavailableV1(
        run ? "RUN_STORE_TRANSITION_UNAVAILABLE" : "RUN_STORE_CONFIGURATION_UNAVAILABLE",
        run,
      ),
    },
  };
}

function loopbackOwnerUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const value = new URL(raw);
    const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(value.hostname);
    if (!loopback || value.protocol !== "http:" || value.username || value.password
      || value.search || value.hash || value.pathname !== "/") return null;
    return value.origin;
  } catch {
    return null;
  }
}

function executionRuntime(
  request: Pick<ArtifactFormationRequestV1, "action">,
  environment: Environment,
  fetcher: Fetcher,
): ArtifactBuildExecutionRuntimeV1 | null {
  const ownerUrl = loopbackOwnerUrl(environment.RD_OWNER_API_URL);
  const providerUrl = environment.RD_EXECUTION_AGENT_PROVIDER_URL
    ?? "https://api.deepseek.com/chat/completions";
  let parsedProvider: URL;
  try {
    parsedProvider = new URL(providerUrl);
  } catch {
    return null;
  }
  if (environment.DASHBOARD_DEPLOYMENT_CLASS !== DISPOSABLE_MODE
    || environment.DASHBOARD_DISPOSABLE_ARTIFACT_EXECUTION !== "ENABLED"
    || !ownerUrl || !environment.RD_OWNER_API_TOKEN
    || parsedProvider.protocol !== "https:"
    || (request.action === "RUN" && !environment.DEEPSEEK_API_KEY)) return null;
  return {
    owner_url: ownerUrl,
    owner_token: environment.RD_OWNER_API_TOKEN,
    provider_url: parsedProvider.toString(),
    provider_api_key: environment.DEEPSEEK_API_KEY,
    provider_model: environment.RD_EXECUTION_AGENT_MODEL ?? "deepseek-chat",
    dispatcher: "TRADE_DASHBOARD",
    fetcher,
  };
}

function preflightUnavailable(
  researchRequestIdentity: string,
  reason: ArtifactFormationPreflightEnvelopeV1["unavailable_reason"],
  status: number,
): ArtifactFormationPreflightResponseV1 {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: "artifact_build.formation_execute.v1",
      channel: "DASHBOARD_DISPOSABLE_EXECUTION",
      phase: "PREFLIGHT",
      availability: "unavailable",
      unavailable_reason: reason,
      research_request_identity: researchRequestIdentity,
      action_state: "REVALIDATION_REQUIRED",
    },
  };
}

export async function preflightDisposableArtifactFormationV1({
  researchRequestIdentity,
  environment = process.env,
  fetcher = fetch,
  routingResolver,
  nowEpochMs = Date.now(),
}: {
  researchRequestIdentity: string;
  environment?: Environment;
  fetcher?: Fetcher;
  routingResolver?: (
    key: ProductEdgeRoutingLookupKeyV1,
  ) => Promise<ProductEdgeRoutingObservationV1>;
  nowEpochMs?: number;
}): Promise<ArtifactFormationPreflightResponseV1> {
  if (!IDENTITY.test(researchRequestIdentity)) {
    return preflightUnavailable(researchRequestIdentity, "EXECUTION_REQUEST_INVALID", 400);
  }
  const runtime = executionRuntime({ action: "RUN" }, environment, fetcher);
  if (!runtime) {
    return preflightUnavailable(
      researchRequestIdentity,
      "EXECUTION_CONFIGURATION_UNAVAILABLE",
      503,
    );
  }
  const admission = await admitArtifactFormationExecutionV1({
    action: "RUN",
    environment,
    nowEpochMs,
    ...(routingResolver ? { routingResolver } : {}),
  });
  if (admission.availability !== "available") {
    return preflightUnavailable(
      researchRequestIdentity,
      admission.unavailable_reason === "DASHBOARD_ROUTING_UNAVAILABLE"
        ? "EXECUTION_ROUTING_UNAVAILABLE"
        : "EXECUTION_COMPATIBILITY_UNAVAILABLE",
      503,
    );
  }
  const preflight = await preflightArtifactBuildV1(researchRequestIdentity, runtime);
  if (preflight.availability !== "available") {
    return preflightUnavailable(
      researchRequestIdentity,
      "EXECUTION_PREFLIGHT_UNAVAILABLE",
      409,
    );
  }
  return {
    status: 200,
    envelope: {
      schema_version: 1,
      operation: "artifact_build.formation_execute.v1",
      channel: "DASHBOARD_DISPOSABLE_EXECUTION",
      phase: "PREFLIGHT",
      availability: "available",
      unavailable_reason: null,
      research_request_identity: researchRequestIdentity,
      action_state: "READY",
    },
  };
}

function validRequest(request: ArtifactFormationRequestV1): boolean {
  return [
    request.build_request_identity,
    request.attempt_identity,
    request.research_request_identity,
  ].every((identity) => IDENTITY.test(identity))
    && ((request.action === "RUN" && request.identity_mode === "GENERATE")
      || (request.action === "RESOLVE" && request.identity_mode === "EXACT"));
}

export async function executeDisposableArtifactFormationV1({
  request,
  actionContext,
  environment = process.env,
  fetcher = fetch,
  routingResolver,
  nowEpochMs = Date.now(),
  store = configuredRunStoreV1(),
}: {
  request: ArtifactFormationRequestV1;
  actionContext: ControlPlaneAdmissionContextV1;
  environment?: Environment;
  fetcher?: Fetcher;
  routingResolver?: (
    key: ProductEdgeRoutingLookupKeyV1,
  ) => Promise<ProductEdgeRoutingObservationV1>;
  nowEpochMs?: number;
  store?: Pick<PostgresRunStoreV1,
    | "assertArtifactFormationSchema"
    | "findActiveArtifactFormation"
    | "beginArtifactFormation"
    | "recordArtifactFormationPhase"
    | "completeArtifactFormation"> | null;
}): Promise<ArtifactFormationResponseV1> {
  if (!validRequest(request)) return unavailable("EXECUTION_REQUEST_INVALID", 400);
  if (!validControlPlaneAdmissionContextV1(actionContext)
    || actionContext.requestedAction !== request.action) {
    return unavailable("EXECUTION_AUTHORIZATION_UNAVAILABLE", 503);
  }
  const runtime = executionRuntime(request, environment, fetcher);
  if (!runtime) return unavailable("EXECUTION_CONFIGURATION_UNAVAILABLE", 503);
  if (!store) return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  const generated = request.action === "RUN"
    ? await deriveGeneratedArtifactIdentitiesV1(
      request.build_request_identity,
      request.attempt_identity,
      request.research_request_identity,
    )
    : {
      build_request_identity: request.build_request_identity,
      attempt_identity: request.attempt_identity,
    };
  if (!generated) return unavailable("EXECUTION_REQUEST_INVALID", 400);
  const recoveryIdentity = {
    research_request_identity: request.research_request_identity,
    build_request_identity: generated.build_request_identity,
    attempt_identity: generated.attempt_identity,
  };
  let active: OperationRunV1 | null;
  try {
    await store.assertArtifactFormationSchema();
    active = await store.findActiveArtifactFormation(recoveryIdentity);
  } catch {
    return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  }
  const admission = await admitArtifactFormationExecutionV1({
    action: active ? "RESOLVE" : request.action,
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
  if (!active && request.action === "RUN") {
    const preflight = await preflightArtifactBuildV1(
      request.research_request_identity,
      runtime,
    );
    if (preflight.availability !== "available") {
      return unavailable("EXECUTION_PREFLIGHT_UNAVAILABLE", 409);
    }
    runtime.verified_s1_context = preflight.context;
  }
  let started;
  try {
    started = await store.beginArtifactFormation({
      action: request.action,
      recoveryIdentity,
      admission,
      actionContext,
      existingRecoveryOnly: active !== null,
    });
  } catch {
    return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  }
  let currentRun = started.run;
  runtime.observe_phase = async (phase) => {
    currentRun = await store.recordArtifactFormationPhase({
      runIdentity: currentRun.run_identity,
      expectedTransitionVersion: currentRun.transition_version,
      phase,
    });
  };
  const executionRequest: ArtifactFormationRequestV1 = started.execution_mode === "FRESH_RUN"
    ? request
    : {
      action: started.execution_mode === "CONTINUE_CLAIMED_ONCE" ? "RUN" : "RESOLVE",
      build_request_identity: generated.build_request_identity,
      attempt_identity: generated.attempt_identity,
      research_request_identity: request.research_request_identity,
      identity_mode: "EXACT",
    };
  try {
    const projection = await executeArtifactBuildV1(executionRequest, runtime);
    const manualReconciliation = projection.provider_invocation?.state === "INVOCATION_STARTED"
      || projection.next_legal_action === "MANUALLY_RECONCILE_PROVIDER_INVOCATION";
    if (manualReconciliation) {
      currentRun = await store.recordArtifactFormationPhase({
        runIdentity: currentRun.run_identity,
        expectedTransitionVersion: currentRun.transition_version,
        phase: "OWNER_CLAIMED",
      });
      currentRun = await store.recordArtifactFormationPhase({
        runIdentity: currentRun.run_identity,
        expectedTransitionVersion: currentRun.transition_version,
        phase: "INVOCATION_STARTED",
      });
      currentRun = await store.completeArtifactFormation({
        runIdentity: currentRun.run_identity,
        expectedTransitionVersion: currentRun.transition_version,
        ownerOutcomeState: "unknown",
        terminalCode: "MANUAL_RECONCILIATION_REQUIRED",
      });
    } else if (projection.resolution === "SUCCESS") {
      currentRun = await store.completeArtifactFormation({
        runIdentity: currentRun.run_identity,
        expectedTransitionVersion: currentRun.transition_version,
        ownerOutcomeState: "available",
        terminalCode: "OWNER_AVAILABLE",
      });
    } else if (projection.resolution !== "SUBMITTED_OR_UNKNOWN") {
      currentRun = await store.completeArtifactFormation({
        runIdentity: currentRun.run_identity,
        expectedTransitionVersion: currentRun.transition_version,
        ownerOutcomeState: "rejected",
        terminalCode: "OWNER_REJECTED",
      });
    }
    return {
      status: 200,
      envelope: {
        schema_version: 1,
        operation: "artifact_build.formation_execute.v1",
        channel: "DASHBOARD_DISPOSABLE_EXECUTION",
        availability: "available",
        unavailable_reason: null,
        projection,
        operational_run: operationalRunAvailableV1(currentRun),
      },
    };
  } catch {
    return unavailable("EXECUTION_RUN_STORE_TRANSITION_UNAVAILABLE", 503, currentRun);
  }
}
