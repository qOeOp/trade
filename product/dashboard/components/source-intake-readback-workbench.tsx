"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseSourceIntakeBrowserProjectionV1,
  type SourceIntakeBrowserProjectionV1,
  type SourceIntakeTerminalReadbackV1,
} from "../lib/source-intake-readback-gateway";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameHeader,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import styles from "./source-intake-readback-workbench.module.css";

const REQUEST_IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd className={mono ? styles.mono : undefined} title={value}>{value}</dd>
    </div>
  );
}

function ReadbackGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.group}>
      <h3>{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function TerminalReadback({ terminal }: { terminal: SourceIntakeTerminalReadbackV1 }) {
  return (
    <div className={styles.groups}>
      <ReadbackGroup title="Intake">
        <Fact label="Request" value={terminal.requestIdentity} mono />
        <div className={styles.fact}>
          <dt>Resolution</dt>
          <dd><StatusBadge tone={terminal.resolution === "RETRIEVED" ? "success" : "neutral"}>{terminal.resolution}</StatusBadge></dd>
        </div>
      </ReadbackGroup>
      <ReadbackGroup title="Custody">
        <Fact label="Binding" value={terminal.bindingIdentity} mono />
        <Fact label="Receipt" value={terminal.receiptIdentity} mono />
        <Fact label="Committed" value={new Date(terminal.committedAt).toLocaleString()} />
      </ReadbackGroup>
      <ReadbackGroup title="Evidence">
        <Fact label="Authority" value={terminal.authorityClass === "LIVE_EXTERNAL" ? "Live external" : "Sealed acceptance"} />
        <Fact label="Content" value={terminal.content ? "Retained" : "No payload"} />
        {terminal.content ? <Fact label="Digest" value={terminal.content.digest} mono /> : null}
      </ReadbackGroup>
    </div>
  );
}

function LoadingGroups() {
  return (
    <div className={styles.groups} aria-label="Loading Source Intake readback">
      {["Intake", "Custody", "Evidence"].map((title) => (
        <section className={styles.group} key={title}>
          <h3>{title}</h3>
          <div className={styles.skeletonLines} aria-hidden="true"><i /><i /><i /></div>
        </section>
      ))}
    </div>
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
        description="Open one exact Owner readback without submitting, resolving, or exposing source payload."
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
              aria-describedby={validation ? "source-intake-validation" : undefined}
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
        {validation ? <p className={styles.validation} id="source-intake-validation">{validation}</p> : null}
        <div className={styles.result} aria-live="polite">
          {status === "loading" ? <LoadingGroups />
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
