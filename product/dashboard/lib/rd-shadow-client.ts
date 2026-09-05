import {
  deriveVerifiedS1ConsumerContextV1,
  projectArtifactOwnerResultWithEvidenceV1,
  projectResearchOwnerResultWithEvidenceV1,
  unknownArtifactProjectionV1,
  unknownResearchProjectionV1,
} from "../../rd-owner-client/consumer_projection_v1.ts";
import {
  projectOwnerReadbackV1 as projectSourceIntakeOwnerReadbackV1,
  unknownSourceIntakeProjectionV1,
} from "../../rd-owner-client/source_intake_v1.ts";
import {
  projectLegacyResearchQuarantineV1,
  unknownLegacyResearchProjectionV1,
  type LegacyResearchQuarantineProjectionV1,
} from "./legacy-research-v1-contract.ts";
import {
  ARTIFACT_SHADOW_RESOLVE_OPERATION,
  LEGACY_RESEARCH_QUARANTINE_READ_OPERATION,
  operationByIdV1,
  ownerOperationUrlV1,
  RESEARCH_SHADOW_RESOLVE_OPERATION,
  SOURCE_INTAKE_SHADOW_READ_OPERATION,
} from "./operation-registry.ts";

const REQUEST_IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const MAX_OWNER_RESPONSE_BYTES = 1_048_576;

type Fetcher = typeof fetch;

export type ResearchShadowUnavailableReason =
  | "INVALID_REQUEST_IDENTITY"
  | "OWNER_CONFIGURATION_UNAVAILABLE"
  | "OWNER_TRANSPORT_UNAVAILABLE"
  | "OWNER_RESPONSE_UNAVAILABLE";

export type ResearchShadowEnvelope = {
  schema_version: 1;
  operation: "research_goal.shadow_resolve.v1";
  channel: "DASHBOARD_SHADOW_READ";
  request_identity: string;
  transport_observed_at: string;
  availability: "available" | "unavailable";
  unavailable_reason: ResearchShadowUnavailableReason | null;
  projection: Awaited<ReturnType<typeof projectResearchOwnerResultWithEvidenceV1>>["projection"];
};

export type ResearchShadowResponse = {
  status: number;
  envelope: ResearchShadowEnvelope;
};

export type LegacyResearchShadowEnvelopeV1 = {
  schema_version: 1;
  operation: "research_goal.legacy_quarantine_read.v1";
  channel: "DASHBOARD_SHADOW_READ";
  request_identity: string;
  transport_observed_at: string;
  availability: "available" | "unavailable";
  unavailable_reason: ResearchShadowUnavailableReason | null;
  projection: LegacyResearchQuarantineProjectionV1;
};

export type LegacyResearchShadowResponseV1 = {
  status: number;
  envelope: LegacyResearchShadowEnvelopeV1;
};

export type ArtifactShadowEnvelope = {
  schema_version: 1;
  operation: "artifact_build.shadow_resolve.v1";
  channel: "DASHBOARD_SHADOW_READ";
  research_request_identity: string;
  build_request_identity: string;
  attempt_identity: string;
  transport_observed_at: string;
  availability: "available" | "unavailable";
  unavailable_reason: ResearchShadowUnavailableReason | null;
  research_projection: ResearchShadowEnvelope["projection"];
  projection: Awaited<ReturnType<typeof projectArtifactOwnerResultWithEvidenceV1>>["projection"];
};

export type ArtifactShadowResponse = {
  status: number;
  envelope: ArtifactShadowEnvelope;
};

export type SourceIntakeShadowEnvelope = {
  schema_version: 1;
  operation: "source_intake.shadow_read.v1";
  channel: "DASHBOARD_SHADOW_READ";
  request_identity: string;
  transport_observed_at: string;
  availability: "available" | "unavailable";
  unavailable_reason: ResearchShadowUnavailableReason | null;
  projection: ReturnType<typeof projectSourceIntakeOwnerReadbackV1>;
};

export type SourceIntakeShadowResponse = {
  status: number;
  envelope: SourceIntakeShadowEnvelope;
};

function unavailable(
  requestIdentity: string,
  reason: ResearchShadowUnavailableReason,
  status: number,
): ResearchShadowResponse {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: "research_goal.shadow_resolve.v1",
      channel: "DASHBOARD_SHADOW_READ",
      request_identity: requestIdentity,
      transport_observed_at: new Date().toISOString(),
      availability: "unavailable",
      unavailable_reason: reason,
      projection: unknownResearchProjectionV1(requestIdentity),
    },
  };
}

function legacyResearchUnavailable(
  requestIdentity: string,
  reason: ResearchShadowUnavailableReason,
  status: number,
): LegacyResearchShadowResponseV1 {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: "research_goal.legacy_quarantine_read.v1",
      channel: "DASHBOARD_SHADOW_READ",
      request_identity: requestIdentity,
      transport_observed_at: new Date().toISOString(),
      availability: "unavailable",
      unavailable_reason: reason,
      projection: unknownLegacyResearchProjectionV1(requestIdentity),
    },
  };
}

function artifactUnavailable(
  researchRequestIdentity: string,
  buildRequestIdentity: string,
  attemptIdentity: string,
  reason: ResearchShadowUnavailableReason,
  status: number,
  researchProjection: ResearchShadowEnvelope["projection"] = unknownResearchProjectionV1(
    researchRequestIdentity,
  ),
): ArtifactShadowResponse {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: "artifact_build.shadow_resolve.v1",
      channel: "DASHBOARD_SHADOW_READ",
      research_request_identity: researchRequestIdentity,
      build_request_identity: buildRequestIdentity,
      attempt_identity: attemptIdentity,
      transport_observed_at: new Date().toISOString(),
      availability: "unavailable",
      unavailable_reason: reason,
      research_projection: researchProjection,
      projection: unknownArtifactProjectionV1(buildRequestIdentity, attemptIdentity),
    },
  };
}

function sourceIntakeUnavailable(
  requestIdentity: string,
  reason: ResearchShadowUnavailableReason,
  status: number,
): SourceIntakeShadowResponse {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: "source_intake.shadow_read.v1",
      channel: "DASHBOARD_SHADOW_READ",
      request_identity: requestIdentity,
      transport_observed_at: new Date().toISOString(),
      availability: "unavailable",
      unavailable_reason: reason,
      projection: unknownSourceIntakeProjectionV1(requestIdentity),
    },
  };
}

function exactSourceUnknown(raw: unknown, requestIdentity: string): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return Object.keys(value).sort().join(",") === "next_legal_action,request_identity,resolution"
    && value.request_identity === requestIdentity
    && value.resolution === "SUBMITTED_OR_UNKNOWN"
    && value.next_legal_action === "RESOLVE_SAME_REQUEST";
}

async function boundedOwnerJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_OWNER_RESPONSE_BYTES) {
    throw new Error("OWNER_RESPONSE");
  }
  if (response.status >= 500) throw new Error("OWNER_TRANSPORT");
  if (!response.ok) throw new Error("OWNER_RESPONSE");
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("OWNER_RESPONSE");
  }
}

function ownerReadInit(token: string, timeoutMs: number): RequestInit {
  return {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  };
}

export async function resolveResearchShadowV1({
  requestIdentity,
  baseUrl,
  token,
  fetcher = fetch,
}: {
  requestIdentity: string;
  baseUrl: string | undefined;
  token: string | undefined;
  fetcher?: Fetcher;
}): Promise<ResearchShadowResponse> {
  if (!REQUEST_IDENTITY.test(requestIdentity)) {
    return unavailable(requestIdentity, "INVALID_REQUEST_IDENTITY", 400);
  }
  const operation = operationByIdV1(RESEARCH_SHADOW_RESOLVE_OPERATION);
  const endpoint = baseUrl ? ownerOperationUrlV1({
    operationId: RESEARCH_SHADOW_RESOLVE_OPERATION,
    baseUrl,
    identities: { request_identity: requestIdentity },
  }) : null;
  if (!endpoint || !token) {
    return unavailable(requestIdentity, "OWNER_CONFIGURATION_UNAVAILABLE", 503);
  }

  try {
    const response = await fetcher(endpoint, ownerReadInit(token, operation.timeout_class.milliseconds));
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_OWNER_RESPONSE_BYTES) {
      return unavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    if (response.status >= 500) {
      return unavailable(requestIdentity, "OWNER_TRANSPORT_UNAVAILABLE", 503);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      return unavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    const projected = await projectResearchOwnerResultWithEvidenceV1(raw, requestIdentity);
    if (!projected.verified) {
      return unavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    return {
      status: 200,
      envelope: {
        schema_version: 1,
        operation: "research_goal.shadow_resolve.v1",
        channel: "DASHBOARD_SHADOW_READ",
        request_identity: requestIdentity,
        transport_observed_at: new Date().toISOString(),
        availability: "available",
        unavailable_reason: null,
        projection: projected.projection,
      },
    };
  } catch {
    return unavailable(requestIdentity, "OWNER_TRANSPORT_UNAVAILABLE", 503);
  }
}

export async function resolveLegacyResearchQuarantineShadowV1({
  requestIdentity,
  baseUrl,
  token,
  fetcher = fetch,
}: {
  requestIdentity: string;
  baseUrl: string | undefined;
  token: string | undefined;
  fetcher?: Fetcher;
}): Promise<LegacyResearchShadowResponseV1> {
  if (!REQUEST_IDENTITY.test(requestIdentity)) {
    return legacyResearchUnavailable(requestIdentity, "INVALID_REQUEST_IDENTITY", 400);
  }
  const operation = operationByIdV1(LEGACY_RESEARCH_QUARANTINE_READ_OPERATION);
  const endpoint = baseUrl ? ownerOperationUrlV1({
    operationId: LEGACY_RESEARCH_QUARANTINE_READ_OPERATION,
    baseUrl,
    identities: { request_identity: requestIdentity },
  }) : null;
  if (!endpoint || !token) {
    return legacyResearchUnavailable(requestIdentity, "OWNER_CONFIGURATION_UNAVAILABLE", 503);
  }

  try {
    const response = await fetcher(endpoint, {
      method: operation.owner_route.method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(operation.timeout_class.milliseconds),
    });
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_OWNER_RESPONSE_BYTES) {
      return legacyResearchUnavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    if (response.status >= 500) {
      return legacyResearchUnavailable(requestIdentity, "OWNER_TRANSPORT_UNAVAILABLE", 503);
    }
    if (!response.ok) {
      return legacyResearchUnavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      return legacyResearchUnavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    const projection = await projectLegacyResearchQuarantineV1(raw, requestIdentity);
    if (!projection) {
      return legacyResearchUnavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    return {
      status: 200,
      envelope: {
        schema_version: 1,
        operation: "research_goal.legacy_quarantine_read.v1",
        channel: "DASHBOARD_SHADOW_READ",
        request_identity: requestIdentity,
        transport_observed_at: new Date().toISOString(),
        availability: "available",
        unavailable_reason: null,
        projection,
      },
    };
  } catch {
    return legacyResearchUnavailable(requestIdentity, "OWNER_TRANSPORT_UNAVAILABLE", 503);
  }
}

export async function resolveSourceIntakeShadowV1({
  requestIdentity,
  baseUrl,
  token,
  fetcher = fetch,
}: {
  requestIdentity: string;
  baseUrl: string | undefined;
  token: string | undefined;
  fetcher?: Fetcher;
}): Promise<SourceIntakeShadowResponse> {
  if (!REQUEST_IDENTITY.test(requestIdentity)) {
    return sourceIntakeUnavailable(requestIdentity, "INVALID_REQUEST_IDENTITY", 400);
  }
  const operation = operationByIdV1(SOURCE_INTAKE_SHADOW_READ_OPERATION);
  const endpoint = baseUrl ? ownerOperationUrlV1({
    operationId: SOURCE_INTAKE_SHADOW_READ_OPERATION,
    baseUrl,
    identities: { request_identity: requestIdentity },
  }) : null;
  if (!endpoint || !token) {
    return sourceIntakeUnavailable(requestIdentity, "OWNER_CONFIGURATION_UNAVAILABLE", 503);
  }

  try {
    const raw = await boundedOwnerJson(await fetcher(
      endpoint,
      ownerReadInit(token, operation.timeout_class.milliseconds),
    ));
    const projection = projectSourceIntakeOwnerReadbackV1(raw, requestIdentity);
    if (projection.resolution === "SUBMITTED_OR_UNKNOWN"
      && !exactSourceUnknown(raw, requestIdentity)) {
      return sourceIntakeUnavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    return {
      status: 200,
      envelope: {
        schema_version: 1,
        operation: "source_intake.shadow_read.v1",
        channel: "DASHBOARD_SHADOW_READ",
        request_identity: requestIdentity,
        transport_observed_at: new Date().toISOString(),
        availability: "available",
        unavailable_reason: null,
        projection,
      },
    };
  } catch (error) {
    const reason = error instanceof Error && error.message === "OWNER_RESPONSE"
      ? "OWNER_RESPONSE_UNAVAILABLE"
      : "OWNER_TRANSPORT_UNAVAILABLE";
    return sourceIntakeUnavailable(
      requestIdentity,
      reason,
      reason === "OWNER_TRANSPORT_UNAVAILABLE" ? 503 : 502,
    );
  }
}

export async function resolveArtifactShadowV1({
  researchRequestIdentity,
  buildRequestIdentity,
  attemptIdentity,
  baseUrl,
  token,
  fetcher = fetch,
}: {
  researchRequestIdentity: string;
  buildRequestIdentity: string;
  attemptIdentity: string;
  baseUrl: string | undefined;
  token: string | undefined;
  fetcher?: Fetcher;
}): Promise<ArtifactShadowResponse> {
  if (![researchRequestIdentity, buildRequestIdentity, attemptIdentity].every(
    (identity) => REQUEST_IDENTITY.test(identity),
  )) {
    return artifactUnavailable(
      researchRequestIdentity, buildRequestIdentity, attemptIdentity, "INVALID_REQUEST_IDENTITY", 400,
    );
  }
  const researchOperation = operationByIdV1(RESEARCH_SHADOW_RESOLVE_OPERATION);
  const artifactOperation = operationByIdV1(ARTIFACT_SHADOW_RESOLVE_OPERATION);
  const researchEndpoint = baseUrl ? ownerOperationUrlV1({
    operationId: RESEARCH_SHADOW_RESOLVE_OPERATION,
    baseUrl,
    identities: { request_identity: researchRequestIdentity },
  }) : null;
  const artifactEndpoint = baseUrl ? ownerOperationUrlV1({
    operationId: ARTIFACT_SHADOW_RESOLVE_OPERATION,
    baseUrl,
    identities: {
      build_request_identity: buildRequestIdentity,
      attempt_identity: attemptIdentity,
    },
  }) : null;
  if (!researchEndpoint || !artifactEndpoint || !token) {
    return artifactUnavailable(
      researchRequestIdentity, buildRequestIdentity, attemptIdentity, "OWNER_CONFIGURATION_UNAVAILABLE", 503,
    );
  }

  let verifiedResearchProjection: ResearchShadowEnvelope["projection"] = unknownResearchProjectionV1(
    researchRequestIdentity,
  );
  try {
    const researchRaw = await boundedOwnerJson(await fetcher(
      researchEndpoint,
      ownerReadInit(token, researchOperation.timeout_class.milliseconds),
    ));
    const research = await projectResearchOwnerResultWithEvidenceV1(
      researchRaw,
      researchRequestIdentity,
    );
    if (!research.verified) {
      return artifactUnavailable(
        researchRequestIdentity, buildRequestIdentity, attemptIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502,
      );
    }
    verifiedResearchProjection = research.projection;
    const context = await deriveVerifiedS1ConsumerContextV1(
      research.projection,
      researchRequestIdentity,
    );
    if (!context) {
      return artifactUnavailable(
        researchRequestIdentity,
        buildRequestIdentity,
        attemptIdentity,
        "OWNER_RESPONSE_UNAVAILABLE",
        502,
        verifiedResearchProjection,
      );
    }
    const artifactRaw = await boundedOwnerJson(await fetcher(
      artifactEndpoint,
      ownerReadInit(token, artifactOperation.timeout_class.milliseconds),
    ));
    const artifact = await projectArtifactOwnerResultWithEvidenceV1(
      artifactRaw,
      buildRequestIdentity,
      attemptIdentity,
      context,
    );
    if (!artifact.verified) {
      return artifactUnavailable(
        researchRequestIdentity,
        buildRequestIdentity,
        attemptIdentity,
        "OWNER_RESPONSE_UNAVAILABLE",
        502,
        verifiedResearchProjection,
      );
    }
    return {
      status: 200,
      envelope: {
        schema_version: 1,
        operation: "artifact_build.shadow_resolve.v1",
        channel: "DASHBOARD_SHADOW_READ",
        research_request_identity: researchRequestIdentity,
        build_request_identity: buildRequestIdentity,
        attempt_identity: attemptIdentity,
        transport_observed_at: new Date().toISOString(),
        availability: "available",
        unavailable_reason: null,
        research_projection: verifiedResearchProjection,
        projection: artifact.projection,
      },
    };
  } catch (error) {
    const reason = error instanceof Error && error.message === "OWNER_RESPONSE"
      ? "OWNER_RESPONSE_UNAVAILABLE"
      : "OWNER_TRANSPORT_UNAVAILABLE";
    return artifactUnavailable(
      researchRequestIdentity,
      buildRequestIdentity,
      attemptIdentity,
      reason,
      reason === "OWNER_TRANSPORT_UNAVAILABLE" ? 503 : 502,
      verifiedResearchProjection,
    );
  }
}
