import type {
  ArtifactBuildExecutionRequestV1,
} from "../../rd-owner-client/artifact_build_v1.ts";
import {
  operationalRunUnavailableV1,
  type OperationalRunReferenceV1,
} from "./operational-run-reference.ts";
import type {
  ProductEdgeRoutingLookupKeyV1,
  ProductEdgeRoutingObservationV1,
} from "./product-edge-routing-client.ts";
import type { PostgresRunStoreV1 } from "./run-store.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DISPATCH_NOT_ADMITTED = "DASHBOARD_EFFECT_DISPATCH_NOT_ADMITTED" as const;

type Fetcher = typeof fetch;
type Environment = Record<string, string | undefined>;

export type ArtifactFormationRequestV1 = ArtifactBuildExecutionRequestV1;

export type ArtifactFormationUnavailableV1 = {
  schema_version: 1;
  operation: "artifact_build.formation_execute.v1";
  channel: "DASHBOARD_DISPOSABLE_EXECUTION";
  availability: "unavailable";
  unavailable_reason:
    | typeof DISPATCH_NOT_ADMITTED
    | "EXECUTION_REQUEST_INVALID";
  projection: null;
  operational_run: OperationalRunReferenceV1;
};

export type ArtifactFormationPreflightEnvelopeV1 = {
  schema_version: 1;
  operation: "artifact_build.formation_execute.v1";
  channel: "DASHBOARD_DISPOSABLE_EXECUTION";
  phase: "PREFLIGHT";
  availability: "unavailable";
  unavailable_reason: typeof DISPATCH_NOT_ADMITTED | "EXECUTION_REQUEST_INVALID";
  research_request_identity: string;
  action_state: "REVALIDATION_REQUIRED";
};

export type ArtifactFormationPreflightResponseV1 = {
  status: number;
  envelope: ArtifactFormationPreflightEnvelopeV1;
};

export type ArtifactFormationResponseV1 = {
  status: number;
  envelope: ArtifactFormationUnavailableV1;
};

function unavailableReason(
  reason: ArtifactFormationUnavailableV1["unavailable_reason"],
  status: number,
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
      operational_run: operationalRunUnavailableV1("EFFECT_DISPATCH_NOT_ADMITTED"),
    },
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
  return preflightUnavailable(researchRequestIdentity, DISPATCH_NOT_ADMITTED, 503);
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
}: {
  request: ArtifactFormationRequestV1;
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
  if (!validRequest(request)) return unavailableReason("EXECUTION_REQUEST_INVALID", 400);
  return unavailableReason(DISPATCH_NOT_ADMITTED, 503);
}
