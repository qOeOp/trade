"use client";

import { useEffect, useState } from "react";

import {
  parseRunAuxiliaryEvidenceEnvelopeV1,
  type RunAuxiliaryEvidenceEnvelopeV1,
  type RunAuxiliaryEvidenceKindV1,
} from "../lib/run-auxiliary-evidence-contract";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { RunIcons } from "./ui/iconography";

const copyByKind = {
  metrics: ["Not collected", "No metrics producer is admitted for this run. No zero or time series is inferred."],
  traces: ["Not captured", "No HTTP trace was captured for this run. No span or trace success is inferred."],
  assets: ["No operational attachments", "No run asset store is admitted. Owner artifacts remain in Owner custody."],
} as const;

export function OperationsRunAuxiliaryEvidence({
  runIdentity,
  evidenceKind,
}: {
  runIdentity: string;
  evidenceKind: RunAuxiliaryEvidenceKindV1;
}) {
  const [envelope, setEnvelope] = useState<RunAuxiliaryEvidenceEnvelopeV1 | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setEnvelope(null);
    void fetch(`/api/operations/runs/${encodeURIComponent(runIdentity)}/${evidenceKind}/`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    }).then((response) => response.json()).then((value) => {
      if (!controller.signal.aborted) setEnvelope(parseRunAuxiliaryEvidenceEnvelopeV1(value));
    }).catch(() => {
      if (!controller.signal.aborted) setEnvelope(null);
    });
    return () => controller.abort();
  }, [evidenceKind, runIdentity]);

  if (!envelope) return <UnavailableState density="compact"
    icon={<RunIcons.loaded aria-hidden="true" size={16} />}
    title="Reading auxiliary evidence" reason="AUXILIARY_EVIDENCE_PENDING_OR_UNAVAILABLE" />;
  if (envelope.availability === "unavailable") return <UnavailableState density="compact"
    icon={<RunIcons.cancelled aria-hidden="true" size={16} />}
    title="Auxiliary evidence unavailable"
    reason={envelope.unavailable_reason ?? "AUXILIARY_EVIDENCE_UNAVAILABLE"} />;
  const [title, detail] = copyByKind[evidenceKind];
  return <EmptyState icon={<RunIcons.cancelled aria-hidden="true" size={16} />} title={title}>
    {detail} Source state: {envelope.state} · {envelope.reason}.
  </EmptyState>;
}
