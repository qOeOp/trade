import {
  ARTIFACT_SHADOW_RESOLVE_OPERATION,
  EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
  RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
  RESEARCH_SHADOW_RESOLVE_OPERATION,
  SOURCE_INTAKE_SHADOW_READ_OPERATION,
  type RegisteredOperationId,
} from "./operation-registry.ts";
import { resolveExploratoryReplayShadowV2 } from "./exploratory-replay-readback-client.ts";
import type { OwnerOutcomeResolutionEnvelopeV1 } from "./owner-outcome-resolution-contract.ts";
import { resolveRdIterationTimelineShadowV1 } from "./rd-iteration-timeline-client.ts";
import { ownerApiTargetForOperationV1 } from "./owner-api-target.ts";
import { resolveArtifactShadowV1, resolveResearchShadowV1, resolveSourceIntakeShadowV1 } from "./rd-shadow-client.ts";
import { journalShadowReadV1 } from "./shadow-run-journal.ts";
import {
  configuredRunStoreV1,
  isRunIdentityV1,
  type OperationRunV1,
  type PostgresRunStoreV1,
} from "./run-store.ts";

type ShadowResponse = {
  status: number;
  envelope: {
    availability: "available" | "unavailable";
    unavailable_reason: string | null;
    projection: unknown;
  } & Record<string, unknown>;
};

type ResolutionTargetV1 = {
  operationId: RegisteredOperationId;
  recoveryIdentity: Record<string, string>;
  read: () => Promise<ShadowResponse>;
};

type ResolutionReadersV1 = {
  source: (requestIdentity: string) => Promise<ShadowResponse>;
  research: (requestIdentity: string) => Promise<ShadowResponse>;
  artifact: (
    researchRequestIdentity: string,
    buildRequestIdentity: string,
    attemptIdentity: string,
  ) => Promise<ShadowResponse>;
  iteration: (trialFamilyIdentity: string) => Promise<ShadowResponse>;
  replay: (requestIdentity: string, meaningDigest: string) => Promise<ShadowResponse>;
};

type ResolutionStoreV1 = Pick<PostgresRunStoreV1,
  "assertSchema" | "getRun" | "beginRead" | "completeRead">;

export type OwnerOutcomeResolutionGatewayResultV1 = {
  status: 200 | 400 | 404 | 409 | 503;
  envelope: OwnerOutcomeResolutionEnvelopeV1;
};

function unavailable(reason: string): OwnerOutcomeResolutionEnvelopeV1 {
  return {
    schema_version: 1,
    operation: "dashboard.owner_outcome.resolve.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: new Date().toISOString(),
    source_run_identity: null,
    source_transition_version: null,
    resolved_operation_id: null,
    owner_outcome_state: null,
    replacement_run: null,
  };
}

function defaultReaders(): ResolutionReadersV1 {
  const sourceOwner = ownerApiTargetForOperationV1(SOURCE_INTAKE_SHADOW_READ_OPERATION);
  const researchOwner = ownerApiTargetForOperationV1(RESEARCH_SHADOW_RESOLVE_OPERATION);
  const artifactOwner = ownerApiTargetForOperationV1(ARTIFACT_SHADOW_RESOLVE_OPERATION);
  const iterationOwner = ownerApiTargetForOperationV1(RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION);
  const replayOwner = ownerApiTargetForOperationV1(EXPLORATORY_REPLAY_SHADOW_READ_OPERATION);
  return {
    source: (requestIdentity) => resolveSourceIntakeShadowV1({
      requestIdentity,
      baseUrl: sourceOwner.baseUrl,
      token: sourceOwner.token,
    }),
    research: (requestIdentity) => resolveResearchShadowV1({
      requestIdentity,
      baseUrl: researchOwner.baseUrl,
      token: researchOwner.token,
    }),
    artifact: (researchRequestIdentity, buildRequestIdentity, attemptIdentity) => (
      resolveArtifactShadowV1({
        researchRequestIdentity,
        buildRequestIdentity,
        attemptIdentity,
        baseUrl: artifactOwner.baseUrl,
        token: artifactOwner.token,
      })
    ),
    iteration: (trialFamilyIdentity) => resolveRdIterationTimelineShadowV1({
      trialFamilyIdentity,
      baseUrl: iterationOwner.baseUrl,
      token: iterationOwner.token,
    }),
    replay: (requestIdentity, meaningDigest) => resolveExploratoryReplayShadowV2({
      requestIdentity,
      meaningDigest,
      baseUrl: replayOwner.baseUrl,
      token: replayOwner.token,
    }),
  };
}

function targetForRun(run: OperationRunV1, readers: ResolutionReadersV1): ResolutionTargetV1 | null {
  const identity = run.recovery_identity;
  if (run.operation_id === SOURCE_INTAKE_SHADOW_READ_OPERATION) {
    return {
      operationId: SOURCE_INTAKE_SHADOW_READ_OPERATION,
      recoveryIdentity: { request_identity: identity.request_identity },
      read: () => readers.source(identity.request_identity),
    };
  }
  if (run.operation_id === RESEARCH_SHADOW_RESOLVE_OPERATION) {
    return {
      operationId: RESEARCH_SHADOW_RESOLVE_OPERATION,
      recoveryIdentity: { request_identity: identity.request_identity },
      read: () => readers.research(identity.request_identity),
    };
  }
  if (run.operation_id === ARTIFACT_SHADOW_RESOLVE_OPERATION
    || run.operation_id === "artifact_build.formation_execute.v1") {
    return {
      operationId: ARTIFACT_SHADOW_RESOLVE_OPERATION,
      recoveryIdentity: {
        research_request_identity: identity.research_request_identity,
        build_request_identity: identity.build_request_identity,
        attempt_identity: identity.attempt_identity,
      },
      read: () => readers.artifact(
        identity.research_request_identity,
        identity.build_request_identity,
        identity.attempt_identity,
      ),
    };
  }
  if (run.operation_id === RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION) {
    return {
      operationId: RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
      recoveryIdentity: { trial_family_identity: identity.trial_family_identity },
      read: () => readers.iteration(identity.trial_family_identity),
    };
  }
  if (run.operation_id === EXPLORATORY_REPLAY_SHADOW_READ_OPERATION) {
    return {
      operationId: EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
      recoveryIdentity: {
        request_identity: identity.request_identity,
        meaning_digest: identity.meaning_digest,
      },
      read: () => readers.replay(identity.request_identity, identity.meaning_digest),
    };
  }
  return null;
}

export async function resolveRunOwnerOutcomeV1({
  runIdentity,
  expectedTransitionVersion,
  store = configuredRunStoreV1(),
  readers = defaultReaders(),
}: {
  runIdentity: string;
  expectedTransitionVersion: number;
  store?: ResolutionStoreV1 | null;
  readers?: ResolutionReadersV1;
}): Promise<OwnerOutcomeResolutionGatewayResultV1> {
  if (!isRunIdentityV1(runIdentity) || !Number.isSafeInteger(expectedTransitionVersion)
    || expectedTransitionVersion < 1) {
    return { status: 400, envelope: unavailable("OWNER_RESOLUTION_REQUEST_INVALID") };
  }
  if (!store) {
    return { status: 503, envelope: unavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE") };
  }
  try {
    await store.assertSchema();
    const sourceRun = await store.getRun(runIdentity);
    if (!sourceRun) return { status: 404, envelope: unavailable("RUN_NOT_FOUND") };
    if (sourceRun.transition_version !== expectedTransitionVersion) {
      return { status: 409, envelope: unavailable("RUN_TRANSITION_STALE") };
    }
    if (!["succeeded", "failed", "unknown"].includes(sourceRun.state)) {
      return { status: 409, envelope: unavailable("OWNER_RESOLUTION_NOT_TERMINAL") };
    }
    const target = targetForRun(sourceRun, readers);
    if (!target) return { status: 409, envelope: unavailable("OWNER_RESOLUTION_NOT_APPLICABLE") };
    const result = await journalShadowReadV1({
      operationId: target.operationId,
      recoveryIdentity: target.recoveryIdentity,
      read: target.read,
      store,
    });
    const replacement = result.envelope.operational_run;
    if (replacement.availability !== "available") {
      return {
        status: 503,
        envelope: {
          schema_version: 1,
          operation: "dashboard.owner_outcome.resolve.v1",
          availability: "unavailable",
          unavailable_reason: replacement.unavailable_reason,
          observed_at: new Date().toISOString(),
          source_run_identity: sourceRun.run_identity,
          source_transition_version: sourceRun.transition_version,
          resolved_operation_id: target.operationId,
          owner_outcome_state: null,
          replacement_run: replacement,
        },
      };
    }
    return {
      status: 200,
      envelope: {
        schema_version: 1,
        operation: "dashboard.owner_outcome.resolve.v1",
        availability: "available",
        unavailable_reason: null,
        observed_at: new Date().toISOString(),
        source_run_identity: sourceRun.run_identity,
        source_transition_version: sourceRun.transition_version,
        resolved_operation_id: target.operationId,
        owner_outcome_state: replacement.owner_outcome_state,
        replacement_run: replacement,
      },
    };
  } catch {
    return { status: 503, envelope: unavailable("RUN_STORE_UNAVAILABLE") };
  }
}
