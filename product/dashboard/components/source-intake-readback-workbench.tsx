"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseSourceIntakeBrowserProjectionV1,
  type SourceIntakeBrowserProjectionV1,
  type SourceIntakeTerminalReadbackV1,
} from "../lib/source-intake-readback-gateway";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem } from "./ui/fact-group";
import { FilterButton } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameHeader,
} from "./ui/panel-frame";
import { ReadbackLookup, ReadbackLookupAction, ReadbackLookupField, ReadbackLookupInput } from "./ui/readback-lookup";
import { StatusBadge } from "./ui/status-badge";
import styles from "./source-intake-readback-workbench.module.css";

const REQUEST_IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;

function TerminalReadback({ terminal }: { terminal: SourceIntakeTerminalReadbackV1 }) {
  return (
    <FactGroupGrid>
      <FactGroup title="Intake">
        <FactItem label="Request" mono title={terminal.requestIdentity}>{terminal.requestIdentity}</FactItem>
        <FactItem label="Resolution"><StatusBadge tone={terminal.resolution === "RETRIEVED" ? "success" : "neutral"}>{terminal.resolution}</StatusBadge></FactItem>
      </FactGroup>
      <FactGroup title="Custody">
        <FactItem label="Binding" mono title={terminal.bindingIdentity}>{terminal.bindingIdentity}</FactItem>
        <FactItem label="Receipt" mono title={terminal.receiptIdentity}>{terminal.receiptIdentity}</FactItem>
        <FactItem label="Committed">{new Date(terminal.committedAt).toLocaleString()}</FactItem>
      </FactGroup>
      <FactGroup title="Evidence">
        <FactItem label="Authority">{terminal.authorityClass === "LIVE_EXTERNAL" ? "Live external" : "Sealed acceptance"}</FactItem>
        <FactItem label="Content">{terminal.content ? "Retained" : "No payload"}</FactItem>
        {terminal.content ? <FactItem label="Digest" mono title={terminal.content.digest}>{terminal.content.digest}</FactItem> : null}
      </FactGroup>
    </FactGroupGrid>
  );
}

export function SourceIntakeReadbackWorkbench({
  initialRequestIdentity,
}: {
  initialRequestIdentity?: string;
}) {
  const [input, setInput] = useState(initialRequestIdentity ?? "");
  const [openedIdentity, setOpenedIdentity] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "available" | "unavailable">("idle");
  const [projection, setProjection] = useState<SourceIntakeBrowserProjectionV1 | null>(null);
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
      const response = await fetch(`/api/rd/source-intakes/${encodeURIComponent(requestIdentity)}/`, {
        cache: "no-store",
      });
      const parsed = parseSourceIntakeBrowserProjectionV1(await response.json());
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
    <PanelFrame className={styles.panel} aria-labelledby="source-intake-title">
      <PanelFrameHeader
        eyebrow="Source intake"
        title="Source intake"
        titleId="source-intake-title"
        meta="Owner point read · No submit or resolve"
        description="Open one exact Owner readback without submitting, resolving, or exposing source payload."
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
          validationId="source-intake-validation"
          onSubmit={(event) => {
            event.preventDefault();
            void read(input);
          }}
        >
          <ReadbackLookupField label="Request identity" labelHidden>
            <ReadbackLookupInput
              aria-describedby={validation ? "source-intake-validation" : undefined}
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
              aria-label="Loading Source Intake readback"
              titles={["Intake", "Custody", "Evidence"]}
            />
          )
            : status === "available" && projection?.state === "terminal" && projection.terminal
              ? <TerminalReadback terminal={projection.terminal} />
              : status === "available" && projection?.state === "no_verified_terminal"
                ? <EmptyState icon={<EvidenceIcons.pending aria-hidden="true" size={20} />} title="No verified terminal" density="compact">
                  The Owner has no terminal custody for {projection.requestIdentity}. No resolution action is exposed.
                </EmptyState>
                : status === "unavailable"
                  ? <UnavailableState
                    icon={<EvidenceIcons.warning aria-hidden="true" size={20} />}
                    title="Source Intake readback unavailable"
                    reason={projection?.reason ?? "SOURCE_INTAKE_TRANSPORT_UNAVAILABLE"}
                    detail="Previously loaded custody has been cleared. Verify the exact identity or Owner read configuration."
                    density="compact"
                  />
                  : <EmptyState icon={<InterfaceIcons.search aria-hidden="true" size={20} />} title="Open an exact request" density="compact">
                    Enter the immutable Source Intake request identity to inspect its current terminal custody.
                  </EmptyState>}
        </div>
      </PanelFrameBody>
    </PanelFrame>
  );
}
