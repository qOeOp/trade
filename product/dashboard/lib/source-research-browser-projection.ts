import { projectResearchOwnerResultWithEvidenceV1 } from "../../rd-owner-client/consumer_projection_v1.ts";
import { projectOwnerReadbackV1 as projectSourceOwnerReadbackV1 } from "../../rd-owner-client/source_intake_v1.ts";

import type { SourceResearchOperationResponseV1 } from "./source-research-operation.ts";
import type { SourceResearchActionEnvelopeV1 } from "./source-research-action-contract.ts";
import {
  operationalRunUnavailableV1,
  type OperationalRunReferenceV1,
} from "./operational-run-reference.ts";

type Json = Record<string, unknown>;

function object(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unavailable(
  reason: string,
  operationalRun: OperationalRunReferenceV1 = operationalRunUnavailableV1("RUN_NOT_STARTED"),
): SourceResearchActionEnvelopeV1 {
  return {
    schema_version: 1,
    operation: "source_intake.research.submit_or_resolve.v1",
    channel: "DASHBOARD_DISPOSABLE_EXECUTION",
    availability: "unavailable",
    unavailable_reason: reason,
    source: null,
    research: null,
    operational_run: operationalRun,
  };
}

export async function projectSourceResearchBrowserEnvelopeV1({
  result,
  sourceRequestIdentity,
  researchRequestIdentity,
}: {
  result: SourceResearchOperationResponseV1;
  sourceRequestIdentity: string;
  researchRequestIdentity: string;
}): Promise<SourceResearchActionEnvelopeV1> {
  if (result.envelope.availability !== "available") {
    return unavailable(
      result.envelope.unavailable_reason ?? "SOURCE_RESEARCH_OPERATION_UNAVAILABLE",
      result.envelope.operational_run,
    );
  }
  const source = projectSourceOwnerReadbackV1(result.envelope.source, sourceRequestIdentity) as Json;
  const sourceReceipt = object(source.receipt) ? source.receipt : null;
  if (source.resolution !== "RETRIEVED" || source.request_identity !== sourceRequestIdentity
    || typeof source.binding_identity !== "string" || typeof source.content_digest !== "string"
    || typeof sourceReceipt?.receipt_identity !== "string") {
    return unavailable("SOURCE_OWNER_PROJECTION_UNAVAILABLE", result.envelope.operational_run);
  }
  const projected = await projectResearchOwnerResultWithEvidenceV1(
    result.envelope.research,
    researchRequestIdentity,
  );
  const research = projected.projection as Json;
  const resolution = research.resolution;
  const nextLegalAction = research.next_legal_action;
  if (!projected.verified || (resolution !== "ACCEPTED" && resolution !== "REJECTED_NO_WRITE")
    || research.request_identity !== researchRequestIdentity || typeof nextLegalAction !== "string") {
    return unavailable("RESEARCH_OWNER_PROJECTION_UNAVAILABLE", result.envelope.operational_run);
  }
  const accepted = resolution === "ACCEPTED";
  const ownerReceipt = object(research.owner_receipt) ? research.owner_receipt : null;
  const trialFamily = object(research.trial_family) ? research.trial_family : null;
  const trialFamilyRoot = object(trialFamily?.root) ? trialFamily.root : null;
  const projectedIntentIdentity = ownerReceipt?.resulting_research_intent_identity;
  const projectedFamilyIdentity = trialFamilyRoot?.trial_family_identity;
  if (accepted && (typeof projectedIntentIdentity !== "string"
    || typeof projectedFamilyIdentity !== "string")) {
    return unavailable("RESEARCH_OWNER_PROJECTION_UNAVAILABLE", result.envelope.operational_run);
  }
  return {
    schema_version: 1,
    operation: "source_intake.research.submit_or_resolve.v1",
    channel: "DASHBOARD_DISPOSABLE_EXECUTION",
    availability: "available",
    unavailable_reason: null,
    source: {
      schema_version: 1,
      request_identity: sourceRequestIdentity,
      resolution: "RETRIEVED",
      binding_identity: source.binding_identity as string,
      receipt_identity: sourceReceipt.receipt_identity as string,
      content_digest: source.content_digest as string,
    },
    research: {
      schema_version: 1,
      request_identity: researchRequestIdentity,
      resolution,
      intent_identity: accepted ? projectedIntentIdentity as string : null,
      trial_family_identity: accepted ? projectedFamilyIdentity as string : null,
      next_legal_action: nextLegalAction,
    },
    operational_run: result.envelope.operational_run,
  };
}
