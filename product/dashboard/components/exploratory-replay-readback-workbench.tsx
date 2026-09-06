"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseExploratoryReplayBrowserProjectionV1,
  type ExploratoryReplayBrowserProjectionV1,
} from "../lib/exploratory-replay-readback-gateway";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { PanelFrame, PanelFrameBody, PanelFrameHeader } from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import styles from "./exploratory-replay-readback-workbench.module.css";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,256}$/;
const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd className={mono ? styles.mono : undefined} title={value}>{value}</dd>
    </div>
  );
}

function ReadbackGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.group}>
      <h3>{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function AvailableReadback({ projection }: { projection: ExploratoryReplayBrowserProjectionV1 }) {
  if (!projection.request || !projection.custody || !projection.replayBasis) return null;
  return (
    <>
      <div className={styles.groups}>
        <ReadbackGroup title="Request">
          <Fact label="Identity" value={projection.requestIdentity} mono />
          <div className={styles.fact}>
            <dt>Availability</dt>
            <dd><StatusBadge tone="success">Available</StatusBadge></dd>
          </div>
          <Fact label="Namespace" value={projection.request.namespace} />
          <Fact label="Seed" value={String(projection.request.deterministicSeed)} mono />
        </ReadbackGroup>
        <ReadbackGroup title="Custody">
          <Fact label="Meaning" value={projection.meaningDigest} mono />
          <Fact label="Receipt" value={projection.custody.receiptIdentity} mono />
          <Fact label="Seal" value={projection.custody.sealDigest} mono />
          <Fact label="Committed" value={new Date(projection.custody.committedAt).toLocaleString()} />
          <Fact label="Owner cut" value={new Date(projection.custody.ownerObservedAt).toLocaleString()} />
        </ReadbackGroup>
        <ReadbackGroup title="Replay basis">
          <Fact
            label="Event window"
            value={`${projection.replayBasis.startEventNs} → ${projection.replayBasis.endEventNsExclusive} ns`}
            mono
          />
          <Fact label="Trial family" value={projection.replayBasis.trialFamilyIdentity} mono />
          <Fact label="Artifact" value={projection.replayBasis.artifactIdentity} mono />
          <Fact label="Strategy design" value={projection.replayBasis.strategyDesignIdentity} mono />
          <Fact label="PIT snapshot" value={projection.replayBasis.pitSnapshotIdentity} mono />
          <Fact label="Runtime kernel" value={projection.replayBasis.runtimeKernelIdentity} mono />
          <Fact label="Simulator" value={projection.replayBasis.simulatorIdentity} mono />
        </ReadbackGroup>
      </div>
      <div className={styles.resultRail} role="status">
        <EvidenceIcons.warning aria-hidden="true" size={15} />
        <div><b>Result projection unavailable</b><span>No admitted Owner result readback is connected.</span></div>
      </div>
    </>
  );
}

function LoadingGroups() {
  return (
    <div className={styles.groups} aria-label="Loading Replay request readback">
      {["Request", "Custody", "Replay basis"].map((title) => (
        <section className={styles.group} key={title}>
          <h3>{title}</h3>
          <div className={styles.skeletonLines} aria-hidden="true"><i /><i /><i /></div>
        </section>
      ))}
    </div>
  );
}

export function ExploratoryReplayReadbackWorkbench({
  initialRequestIdentity,
  initialMeaningDigest,
}: {
  initialRequestIdentity?: string;
  initialMeaningDigest?: string;
}) {
  const [requestInput, setRequestInput] = useState(initialRequestIdentity ?? "");
  const [meaningInput, setMeaningInput] = useState(initialMeaningDigest ?? "");
  const [openedSelector, setOpenedSelector] = useState<Readonly<{
    requestIdentity: string;
    meaningDigest: string;
  }> | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "available" | "unavailable">("idle");
  const [projection, setProjection] = useState<ExploratoryReplayBrowserProjectionV1 | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const initialReadStarted = useRef(false);

  const read = useCallback(async (requestCandidate: string, meaningCandidate: string) => {
    const requestIdentity = requestCandidate.trim();
    const meaningDigest = meaningCandidate.trim();
    const sequence = ++requestSequence.current;
    setProjection(null);
    if (!IDENTITY.test(requestIdentity) || !DIGEST.test(meaningDigest)) {
      setOpenedSelector(null);
      setStatus("idle");
      setValidation("Enter one exact request identity and a sha256: or blake3: digest with 64 lowercase hex characters.");
      return;
    }
    setRequestInput(requestIdentity);
    setMeaningInput(meaningDigest);
    setOpenedSelector({ requestIdentity, meaningDigest });
    setValidation(null);
    setStatus("loading");
    try {
      const query = new URLSearchParams({ meaningDigest });
      const response = await fetch(
        `/api/backtest/replays/${encodeURIComponent(requestIdentity)}/?${query.toString()}`,
        { cache: "no-store" },
      );
      const parsed = parseExploratoryReplayBrowserProjectionV1(await response.json());
      if (requestSequence.current !== sequence) return;
      if (!response.ok || !parsed || parsed.availability !== "available"
        || parsed.requestIdentity !== requestIdentity || parsed.meaningDigest !== meaningDigest) {
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
    if (initialReadStarted.current || !initialRequestIdentity || !initialMeaningDigest) return;
    initialReadStarted.current = true;
    void read(initialRequestIdentity, initialMeaningDigest);
  }, [initialMeaningDigest, initialRequestIdentity, read]);

  return (
    <PanelFrame className={styles.panel} aria-labelledby="exploratory-replay-title">
      <PanelFrameHeader
        eyebrow="Exploratory replay"
        title="Replay request"
        titleId="exploratory-replay-title"
        description="Inspect one sealed Owner request without composing, running, resolving, or inferring a result."
        actions={(
          <button
            disabled={!openedSelector || status === "loading"}
            onClick={() => openedSelector
              && void read(openedSelector.requestIdentity, openedSelector.meaningDigest)}
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
            void read(requestInput, meaningInput);
          }}
        >
          <label className={styles.lookupField}>
            <span>Request identity</span>
            <input
              aria-describedby={validation ? "exploratory-replay-validation" : undefined}
              aria-invalid={Boolean(validation)}
              autoComplete="off"
              onChange={(event) => {
                setRequestInput(event.target.value);
                setValidation(null);
              }}
              placeholder="request identity"
              spellCheck={false}
              value={requestInput}
            />
          </label>
          <label className={`${styles.lookupField} ${styles.digestField}`}>
            <span>Meaning digest</span>
            <input
              aria-describedby={validation ? "exploratory-replay-validation" : undefined}
              aria-invalid={Boolean(validation)}
              autoComplete="off"
              onChange={(event) => {
                setMeaningInput(event.target.value);
                setValidation(null);
              }}
              placeholder="blake3:…"
              spellCheck={false}
              value={meaningInput}
            />
          </label>
          <button className={styles.openButton} disabled={status === "loading"} type="submit">
            Open readback <EvidenceIcons.next aria-hidden="true" size={14} />
          </button>
        </form>
        {validation ? <p className={styles.validation} id="exploratory-replay-validation">{validation}</p> : null}
        <div className={styles.result} aria-live="polite">
          {status === "loading" ? <LoadingGroups />
            : status === "available" && projection
              ? <AvailableReadback projection={projection} />
              : status === "unavailable"
                ? <UnavailableState
                  icon={<EvidenceIcons.warning aria-hidden="true" size={20} />}
                  title="Replay request unavailable"
                  reason={projection?.reason ?? "EXPLORATORY_REPLAY_TRANSPORT_UNAVAILABLE"}
                  detail="Previously loaded custody has been cleared. Verify both immutable selector fields and Owner read configuration."
                  density="compact"
                />
                : <EmptyState icon={<EvidenceIcons.replay aria-hidden="true" size={20} />} title="Open an exact Replay request" density="compact">
                  Enter the immutable request identity and meaning digest to inspect its sealed request basis.
                </EmptyState>}
        </div>
      </PanelFrameBody>
    </PanelFrame>
  );
}
