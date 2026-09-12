"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseDevelopComposerBrowserProjectionV1,
  type DevelopComposerBrowserProjectionV1,
  type DevelopComposerReadbackV1,
} from "../lib/develop-composer-readback-gateway";
import styles from "./source-intake-readback-workbench.module.css";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem } from "./ui/fact-group";
import { FilterButton } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { PanelFrame, PanelFrameBody, PanelFrameHeader } from "./ui/panel-frame";
import { ReadbackLookup, ReadbackLookupAction, ReadbackLookupField, ReadbackLookupInput } from "./ui/readback-lookup";
import { StatusBadge, type StatusBadgeTone } from "./ui/status-badge";

const REQUEST_IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;

function tone(disposition: string): StatusBadgeTone {
  if (disposition === "SUCCESS") return "success";
  if (disposition === "CONFLICT" || disposition === "UNSUPPORTED") return "danger";
  if (disposition === "NEEDS_RESEARCH_REFINEMENT") return "warning";
  if (disposition === "UNAVAILABLE") return "unavailable";
  return "neutral";
}

function Readback({ requestIdentity, readback }: {
  requestIdentity: string;
  readback: DevelopComposerReadbackV1;
}) {
  return (
    <FactGroupGrid>
      <FactGroup title="Request">
        <FactItem label="Identity" mono title={requestIdentity}>{requestIdentity}</FactItem>
        <FactItem label="Disposition"><StatusBadge tone={tone(readback.disposition)}>{readback.disposition}</StatusBadge></FactItem>
      </FactGroup>
      <FactGroup title="Custody">
        <FactItem label="Receipt" mono={Boolean(readback.receiptIdentity)} title={readback.receiptIdentity ?? undefined}>{readback.receiptIdentity ?? "Not issued"}</FactItem>
      </FactGroup>
      <FactGroup title="Artifact">
        {readback.artifact ? (
          <>
            <FactItem label="Locator" mono title={readback.artifact.locator}>{readback.artifact.locator}</FactItem>
            <FactItem label="Artifact" mono title={readback.artifact.artifactDigest}>{readback.artifact.artifactDigest}</FactItem>
            <FactItem label="Plan" mono title={readback.artifact.canonicalPlanDigest}>{readback.artifact.canonicalPlanDigest}</FactItem>
            <FactItem label="Design" mono title={readback.artifact.designDigest}>{readback.artifact.designDigest}</FactItem>
          </>
        ) : (
          <>
            <FactItem label="Coordinate" mono title={readback.coordinate ?? undefined}>{readback.coordinate ?? "Unavailable"}</FactItem>
            <FactItem label="Reason" title={readback.reason ?? undefined}>
              {readback.reason ?? "Unavailable"}
            </FactItem>
          </>
        )}
      </FactGroup>
    </FactGroupGrid>
  );
}

export function DevelopComposerReadbackWorkbench({
  initialRequestIdentity,
}: {
  initialRequestIdentity?: string;
}) {
  const [input, setInput] = useState(initialRequestIdentity ?? "");
  const [openedIdentity, setOpenedIdentity] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "available" | "unavailable">("idle");
  const [projection, setProjection] = useState<DevelopComposerBrowserProjectionV1 | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const initialReadStarted = useRef(false);

  const read = useCallback(async (candidate: string) => {
    const requestIdentity = candidate.trim();
    const sequence = ++requestSequence.current;
    setProjection(null);
    if (!REQUEST_IDENTITY.test(requestIdentity)) {
      setOpenedIdentity(null);
      setStatus("idle");
      setValidation("Use 1-192 letters, numbers, dots, slashes, colons, underscores, or hyphens.");
      return;
    }
    setInput(requestIdentity);
    setOpenedIdentity(requestIdentity);
    setValidation(null);
    setStatus("loading");
    try {
      const response = await fetch(`/api/rd/composer/${encodeURIComponent(requestIdentity)}/`, {
        cache: "no-store",
      });
      const parsed = parseDevelopComposerBrowserProjectionV1(await response.json());
      if (requestSequence.current !== sequence) return;
      if (!response.ok || !parsed || parsed.availability !== "available"
        || parsed.requestIdentity !== requestIdentity) {
        setProjection(parsed);
        setStatus("unavailable");
        return;
      }
      setProjection(parsed);
      setStatus("available");
    } catch {
      if (requestSequence.current !== sequence) return;
      setProjection(null);
      setStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    if (initialReadStarted.current || !initialRequestIdentity) return;
    initialReadStarted.current = true;
    void read(initialRequestIdentity);
  }, [initialRequestIdentity, read]);

  return (
    <PanelFrame className={styles.panel} aria-labelledby="develop-composer-title">
      <PanelFrameHeader
        eyebrow="Develop composer"
        title="Composer readback"
        titleId="develop-composer-title"
        meta="Owner point read · No run, resolve, or edit"
        description="Inspect one exact sealed result without running, resolving, editing, or exposing source bytes."
        actions={(
          <FilterButton
            density="compact"
            variant="secondary"
            disabled={!openedIdentity || status === "loading"}
            onClick={() => openedIdentity && void read(openedIdentity)}
            type="button"
          >
            <InterfaceIcons.refresh aria-hidden="true" size={14} /> Refresh
          </FilterButton>
        )}
      />
      <PanelFrameBody className={styles.body}>
        <ReadbackLookup
          validation={validation}
          validationId="develop-composer-validation"
          onSubmit={(event) => {
            event.preventDefault();
            void read(input);
          }}
        >
          <ReadbackLookupField label="Request identity" labelHidden>
            <ReadbackLookupInput
              aria-describedby={validation ? "develop-composer-validation" : undefined}
              aria-invalid={Boolean(validation)}
              autoComplete="off"
              icon={<InterfaceIcons.search aria-hidden="true" size={16} />}
              onChange={(event) => {
                setInput(event.target.value);
                setValidation(null);
              }}
              placeholder="Request identity"
              spellCheck={false}
              value={input}
            />
          </ReadbackLookupField>
          <ReadbackLookupAction disabled={status === "loading"}>
            Open readback <EvidenceIcons.next aria-hidden="true" size={14} />
          </ReadbackLookupAction>
        </ReadbackLookup>
        <div className={styles.result} aria-live="polite">
          {status === "loading" ? (
            <FactGroupSkeletonGrid
              aria-label="Loading Develop Composer readback"
              titles={["Request", "Custody", "Artifact"]}
            />
          )
            : status === "available" && projection?.state === "readback" && projection.readback
              ? <Readback requestIdentity={projection.requestIdentity} readback={projection.readback} />
              : status === "unavailable"
                ? <UnavailableState
                  icon={<EvidenceIcons.warning aria-hidden="true" size={20} />}
                  title="Composer readback unavailable"
                  reason={projection?.reason ?? "OWNER_TRANSPORT_UNAVAILABLE"}
                  detail="Previously loaded custody has been cleared. Verify the exact identity or Owner read configuration."
                  density="compact"
                />
                : <EmptyState icon={<InterfaceIcons.search aria-hidden="true" size={20} />} title="Open an exact request" density="compact">
                  Enter an immutable Develop Composer request identity to inspect its sealed result.
                </EmptyState>}
        </div>
      </PanelFrameBody>
    </PanelFrame>
  );
}
