import {
  enqueueDisposableArtifactFormationV1,
  executeDisposableArtifactFormationV1,
  type ArtifactFormationRequestV1,
  type ArtifactFormationResponseV1,
} from "./artifact-formation-client.ts";
import type { ControlPlaneAdmissionContextV1 } from "./control-plane-admission-contract.ts";
import type { DevelopComposerRunRequestV2 } from "./develop-composer-action-contract.ts";
import {
  enqueueDevelopComposerOperationV2,
  type DevelopComposerOperationEnvelopeV2,
} from "./develop-composer-operation-client.ts";
import type { ExploratoryReplayRunRequestV2 } from "./exploratory-replay-action-contract.ts";
import {
  enqueueExploratoryReplayOperationV2,
  type ExploratoryReplayOperationResponseV2,
} from "./exploratory-replay-operation-client.ts";
import { projectSourceResearchBrowserEnvelopeV1 } from "./source-research-browser-projection.ts";
import type { SourceResearchActionEnvelopeV1 } from "./source-research-action-contract.ts";
import type { SourceResearchOperationRequestV1 } from "./source-research-input-contract.ts";
import {
  enqueueSourceResearchOperationV1,
  executeSourceResearchOperationV1,
} from "./source-research-operation.ts";

export async function handleArtifactFormationActionV1({
  request,
  actionContext,
}: {
  request: ArtifactFormationRequestV1;
  actionContext: ControlPlaneAdmissionContextV1;
}): Promise<ArtifactFormationResponseV1> {
  return request.action === "RUN"
    ? enqueueDisposableArtifactFormationV1({ request, actionContext })
    : executeDisposableArtifactFormationV1({ request, actionContext });
}

export async function handleDevelopComposerActionV2({
  request,
  actionContext,
}: {
  request: DevelopComposerRunRequestV2;
  actionContext: ControlPlaneAdmissionContextV1;
}): Promise<DevelopComposerOperationEnvelopeV2> {
  return enqueueDevelopComposerOperationV2({ request, actionContext });
}

export async function handleExploratoryReplayActionV2({
  request,
  actionContext,
}: {
  request: ExploratoryReplayRunRequestV2;
  actionContext: ControlPlaneAdmissionContextV1;
}): Promise<ExploratoryReplayOperationResponseV2> {
  return enqueueExploratoryReplayOperationV2({ request, actionContext });
}

export async function handleSourceResearchActionV1({
  request,
  actionContext,
}: {
  request: SourceResearchOperationRequestV1;
  actionContext: ControlPlaneAdmissionContextV1;
}): Promise<{ status: number; envelope: SourceResearchActionEnvelopeV1 }> {
  const result = request.action === "RUN"
    ? await enqueueSourceResearchOperationV1({ request, actionContext })
    : await executeSourceResearchOperationV1({ request, actionContext });
  const sourceRequestIdentity = request.action === "RUN"
    ? request.source.request_identity : request.source_request_identity;
  const researchRequestIdentity = request.action === "RUN"
    ? request.research.request_identity : request.research_request_identity;
  const envelope = result.envelope.availability === "available"
    && ["queued", "running"].includes(result.envelope.operational_run.state ?? "")
    && result.envelope.source === null && result.envelope.research === null
    ? {
      schema_version: 1 as const,
      operation: "source_intake.research.submit_or_resolve.v1" as const,
      channel: "DASHBOARD_DISPOSABLE_EXECUTION" as const,
      availability: "available" as const,
      unavailable_reason: null,
      source: null,
      research: null,
      operational_run: result.envelope.operational_run,
    }
    : await projectSourceResearchBrowserEnvelopeV1({
      result,
      sourceRequestIdentity,
      researchRequestIdentity,
    });
  return {
    status: result.status === 200 && envelope.availability === "unavailable" ? 502 : result.status,
    envelope,
  };
}
