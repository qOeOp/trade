"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseDevelopComposerBrowserProjectionV1,
  type DevelopComposerBrowserProjectionV1,
  type DevelopComposerReadbackV1,
} from "../lib/develop-composer-readback-gateway";
import styles from "./source-intake-readback-workbench.module.css";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { PanelFrame, PanelFrameBody, PanelFrameHeader } from "./ui/panel-frame";
import { StatusBadge, type StatusBadgeTone } from "./ui/status-badge";

const REQUEST_IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;

function tone(disposition: string): StatusBadgeTone {
  if (disposition === "SUCCESS") return "success";
  if (disposition === "CONFLICT" || disposition === "UNSUPPORTED") return "danger";
  if (disposition === "NEEDS_RESEARCH_REFINEMENT") return "warning";
  if (disposition === "UNAVAILABLE") return "unavailable";
  return "neutral";
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd className={mono ? styles.mono : undefined} title={value}>{value}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className={styles.group}><h3>{title}</h3><dl>{children}</dl></section>;
}

function Readback({ requestIdentity, readback }: {
  requestIdentity: string;
  readback: DevelopComposerReadbackV1;
}) {
  return (
    <div className={styles.groups}>
      <Group title="Request">
        <Fact label="Identity" value={requestIdentity} mono />
        <div className={styles.fact}>
          <dt>Disposition</dt>
          <dd><StatusBadge tone={tone(readback.disposition)}>{readback.disposition}</StatusBadge></dd>
        </div>
      </Group>
      <Group title="Custody">
        <Fact label="Receipt" value={readback.receiptIdentity ?? "Not issued"} mono={Boolean(readback.receiptIdentity)} />
      </Group>
      <Group title="Artifact">
        {readback.artifact ? (
          <>
            <Fact label="Locator" value={readback.artifact.locator} mono />
            <Fact label="Artifact" value={readback.artifact.artifactDigest} mono />
            <Fact label="Plan" value={readback.artifact.canonicalPlanDigest} mono />
            <Fact label="Design" value={readback.artifact.designDigest} mono />
          </>
        ) : (
          <>
            <Fact label="Coordinate" value={readback.coordinate ?? "Unavailable"} mono />
            <Fact label="Reason" value={readback.reason ?? "Unavailable"} />
          </>
        )}
      </Group>
    </div>
  );
}

function LoadingGroups() {
  return (
    <div className={styles.groups} aria-label="Loading Develop Composer readback">
      {["Request", "Custody", "Artifact"].map((title) => (
        <section className={styles.group} key={title}>
          <h3>{title}</h3>
          <div className={styles.skeletonLines} aria-hidden="true"><i /><i /><i /></div>
        </section>
      ))}
    </div>
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
        description="Inspect one exact sealed result without running, resolving, editing, or exposing source bytes."
        actions={(
          <button
            disabled={!openedIdentity || status === "loading"}
            onClick={() => openedIdentity && void read(openedIdentity)}
            type="button"
          >
            <InterfaceIcons.refresh aria-hidden="true" size={14} /> Refresh
          </button>
        )}
      />
      <PanelFrameBody className={styles.body}>
        <form
          className={styles.lookupRail}
          onSubmit={(event) => {
            event.preventDefault();
            void read(input);
          }}
        >
          <label className={styles.inputShell}>
            <span className="sr-only">Request identity</span>
            <InterfaceIcons.search aria-hidden="true" size={16} />
            <input
              aria-describedby={validation ? "develop-composer-validation" : undefined}
              aria-invalid={Boolean(validation)}
              autoComplete="off"
              onChange={(event) => {
                setInput(event.target.value);
                setValidation(null);
              }}
              placeholder="Request identity"
              spellCheck={false}
              value={input}
            />
          </label>
          <button className={styles.openButton} disabled={status === "loading"} type="submit">
            Open readback <EvidenceIcons.next aria-hidden="true" size={14} />
          </button>
        </form>
        {validation ? <p className={styles.validation} id="develop-composer-validation">{validation}</p> : null}
        <div className={styles.result} aria-live="polite">
          {status === "loading" ? <LoadingGroups />
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
