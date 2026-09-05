import { readRunDetailGatewayV1 } from "./run-detail-gateway.ts";
import {
  availableRunAuxiliaryEvidenceEnvelopeV1,
  type RunAuxiliaryEvidenceEnvelopeV1,
  type RunAuxiliaryEvidenceKindV1,
  unavailableRunAuxiliaryEvidenceEnvelopeV1,
} from "./run-auxiliary-evidence-contract.ts";

export type RunAuxiliaryEvidenceGatewayResultV1 = {
  status: 200 | 400 | 404 | 503;
  envelope: RunAuxiliaryEvidenceEnvelopeV1;
};

export async function readRunAuxiliaryEvidenceGatewayV1(
  runIdentity: string,
  evidenceKind: RunAuxiliaryEvidenceKindV1,
  readDetail: typeof readRunDetailGatewayV1 = readRunDetailGatewayV1,
): Promise<RunAuxiliaryEvidenceGatewayResultV1> {
  const detail = await readDetail(runIdentity);
  if (detail.envelope.availability === "unavailable") {
    return {
      status: detail.status,
      envelope: unavailableRunAuxiliaryEvidenceEnvelopeV1({
        runIdentity,
        evidenceKind,
        reason: detail.envelope.unavailable_reason ?? "RUN_DETAIL_UNAVAILABLE",
        observedAt: detail.envelope.observed_at,
      }),
    };
  }
  return {
    status: 200,
    envelope: availableRunAuxiliaryEvidenceEnvelopeV1({
      runIdentity,
      evidenceKind,
      observedAt: detail.envelope.observed_at,
    }),
  };
}
