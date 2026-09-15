"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { parseRunDetailEnvelopeV1, type RunDetailEnvelopeV1 } from "../lib/run-detail-projection";
import { runOperationLabel } from "../lib/run-operation-presentation";
import {
  runDurationPresentation,
  runStateLabel,
  runTriggerLabel,
  sourceResultLabel,
} from "../lib/operations-presentation";
import { Button } from "./ui/button";
import { DetailFact, DetailFactGrid } from "./ui/detail-inspector";
import { LoadingState, UnavailableState } from "./ui/evidence-strip";
import { InterfaceIcons } from "./ui/iconography";
import { StatusBadge } from "./ui/status-badge";
import { executionStateTone, ownerOutcomeTone } from "./ui/status-tone-policy";

type PreviewState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | { status: "available"; envelope: RunDetailEnvelopeV1 };

function displayTime(value: string | null) {
  return value
    ? new Date(value).toISOString().replace("T", " ").replace("Z", " UTC")
    : "Not observed";
}

export function OperationsRunPreviewTrigger({
  runIdentity,
  children,
  className,
  onOpen,
}: {
  runIdentity: string;
  children: ReactNode;
  className?: string;
  onOpen: (runIdentity: string) => void;
}) {
  return <Button type="button" variant="link" size="xs" className={className}
    data-run-preview-trigger={runIdentity}
    onClick={() => onOpen(runIdentity)}>
    {children}<InterfaceIcons.next aria-hidden="true" size={12} />
  </Button>;
}

export function restoreRunPreviewTriggerFocus(runIdentity: string) {
  window.requestAnimationFrame(() => {
    const selector = `[data-run-preview-trigger="${CSS.escape(runIdentity)}"]`;
    const trigger = document.querySelector<HTMLButtonElement>(`dialog[open] ${selector}`)
      ?? document.querySelector<HTMLButtonElement>(selector);
    trigger?.focus();
  });
}

export function OperationsRunPreviewContent({
  runIdentity,
  onBack,
}: {
  runIdentity: string;
  onBack?: () => void;
}) {
  const requestGeneration = useRef(0);
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    setState({ status: "loading" });

    const read = async () => {
      try {
        const response = await fetch(`/api/operations/runs/${encodeURIComponent(runIdentity)}/`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        const parsed = parseRunDetailEnvelopeV1(await response.json());
        if (controller.signal.aborted || generation !== requestGeneration.current) return;
        if (!parsed || parsed.run_identity !== runIdentity) {
          setState({ status: "unavailable", reason: "RUN_DETAIL_IDENTITY_MISMATCH" });
        } else if (parsed.availability === "unavailable") {
          setState({ status: "unavailable", reason: parsed.unavailable_reason ?? "RUN_DETAIL_RESPONSE_UNAVAILABLE" });
        } else if (!response.ok || !parsed.run || parsed.run.run_identity !== runIdentity) {
          setState({ status: "unavailable", reason: "RUN_DETAIL_RESPONSE_UNAVAILABLE" });
        } else {
          setState({ status: "available", envelope: parsed });
        }
      } catch {
        if (controller.signal.aborted || generation !== requestGeneration.current) return;
        setState({ status: "unavailable", reason: "RUN_DETAIL_READ_UNAVAILABLE" });
      }
    };
    void read();
    return () => {
      ++requestGeneration.current;
      controller.abort();
    };
  }, [runIdentity]);

  return <div className="operations-run-preview-content">
    {onBack ? <Button type="button" variant="text" size="tool" onClick={onBack}>
      <InterfaceIcons.previous aria-hidden="true" size={12} />Back to schedule
    </Button> : null}
    {state.status === "loading" ? <LoadingState density="compact"
      icon={<InterfaceIcons.refresh aria-hidden="true" size={16} />}
      title="Reading related run">Checking the exact observed run.</LoadingState>
      : state.status === "unavailable" ? <UnavailableState density="compact"
        icon={<InterfaceIcons.info aria-hidden="true" size={16} />}
        title="Related run unavailable" reason={state.reason}
        detail="The observed run could not be verified from the current read." />
        : <RunPreviewFacts envelope={state.envelope} />}
  </div>;
}

function RunPreviewFacts({ envelope }: { envelope: RunDetailEnvelopeV1 }) {
  const run = envelope.run!;
  const duration = runDurationPresentation(run);
  return <>
    <DetailFactGrid>
      <DetailFact label="run"><StatusBadge tone={executionStateTone(run.state)}>{runStateLabel(run.state)}</StatusBadge></DetailFact>
      <DetailFact label="activity"><b>{runOperationLabel(run.operation_id)}</b></DetailFact>
      <DetailFact label="started by"><b>{runTriggerLabel(run.trigger_kind)}</b></DetailFact>
      <DetailFact label="started"><time dateTime={run.started_at ?? undefined}>{displayTime(run.started_at)}</time></DetailFact>
      <DetailFact label="duration"><b>{duration.duration}</b></DetailFact>
      <DetailFact label="source result"><StatusBadge tone={ownerOutcomeTone(run.owner_outcome_state)}>{sourceResultLabel(run.owner_outcome_state)}</StatusBadge></DetailFact>
    </DetailFactGrid>
    <Button asChild variant="outline" size="tool">
      <Link href={`/operations/runs/${encodeURIComponent(run.run_identity)}`}>
        Open full run details<InterfaceIcons.next aria-hidden="true" size={12} />
      </Link>
    </Button>
  </>;
}
