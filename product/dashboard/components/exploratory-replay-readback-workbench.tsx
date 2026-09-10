"use client";

import { useCallback, useRef, useState } from "react";

import {
  parseExploratoryReplayBrowserProjectionV1,
  type ExploratoryReplayBrowserProjectionV1,
} from "../lib/exploratory-replay-readback-gateway";
import {
  encodeExploratoryReplayOpaqueIdentityV2,
  validExploratoryReplayOpaqueIdentityV2,
} from "../lib/exploratory-replay-identity";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem } from "./ui/fact-group";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { InlineNotice } from "./ui/inline-notice";
import { PanelFrame, PanelFrameBody, PanelFrameHeader } from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import styles from "./exploratory-replay-readback-workbench.module.css";

const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;

function AvailableReadback({ projection }: { projection: ExploratoryReplayBrowserProjectionV1 }) {
  if (!projection.request || !projection.custody || !projection.replayBasis) return null;
  return (
    <>
      <FactGroupGrid layout="weighted">
        <FactGroup title="Request">
          <FactItem label="Identity" mono title={projection.requestIdentity}>{projection.requestIdentity}</FactItem>
          <FactItem label="Availability"><StatusBadge tone="success">Available</StatusBadge></FactItem>
          <FactItem label="Namespace">{projection.request.namespace}</FactItem>
          <FactItem label="Seed" mono>{String(projection.request.deterministicSeed)}</FactItem>
        </FactGroup>
        <FactGroup title="Custody">
          <FactItem label="Meaning" mono title={projection.meaningDigest}>{projection.meaningDigest}</FactItem>
          <FactItem label="Receipt" mono title={projection.custody.receiptIdentity}>{projection.custody.receiptIdentity}</FactItem>
          <FactItem label="Seal" mono title={projection.custody.sealDigest}>{projection.custody.sealDigest}</FactItem>
          <FactItem label="Committed">{new Date(projection.custody.committedAt).toLocaleString()}</FactItem>
          <FactItem label="Owner cut">{new Date(projection.custody.ownerObservedAt).toLocaleString()}</FactItem>
        </FactGroup>
        <FactGroup title="Replay basis">
          <FactItem label="Event window" mono title={`${projection.replayBasis.startEventNs} → ${projection.replayBasis.endEventNsExclusive} ns`}>
            {projection.replayBasis.startEventNs} → {projection.replayBasis.endEventNsExclusive} ns
          </FactItem>
          <FactItem label="Trial family" mono title={projection.replayBasis.trialFamilyIdentity}>{projection.replayBasis.trialFamilyIdentity}</FactItem>
          <FactItem label="Artifact" mono title={projection.replayBasis.artifactIdentity}>{projection.replayBasis.artifactIdentity}</FactItem>
          <FactItem label="Strategy design" mono title={projection.replayBasis.strategyDesignIdentity}>{projection.replayBasis.strategyDesignIdentity}</FactItem>
          <FactItem label="PIT snapshot" mono title={projection.replayBasis.pitSnapshotIdentity}>{projection.replayBasis.pitSnapshotIdentity}</FactItem>
          <FactItem label="Runtime kernel" mono title={projection.replayBasis.runtimeKernelIdentity}>{projection.replayBasis.runtimeKernelIdentity}</FactItem>
          <FactItem label="Simulator" mono title={projection.replayBasis.simulatorIdentity}>{projection.replayBasis.simulatorIdentity}</FactItem>
        </FactGroup>
      </FactGroupGrid>
      <InlineNotice
        className={styles.resultNotice}
        density="compact"
        icon={<EvidenceIcons.warning size={15} />}
        role="status"
        title="Result projection unavailable"
        tone="warning"
      >
        No admitted Owner result readback is connected.
      </InlineNotice>
    </>
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

  const read = useCallback(async (requestCandidate: string, meaningCandidate: string) => {
    const requestIdentity = requestCandidate;
    const meaningDigest = meaningCandidate;
    const sequence = ++requestSequence.current;
    setProjection(null);
    if (!validExploratoryReplayOpaqueIdentityV2(requestIdentity) || !DIGEST.test(meaningDigest)) {
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
      const requestIdentityB64 = encodeExploratoryReplayOpaqueIdentityV2(requestIdentity);
      if (!requestIdentityB64) throw new Error("invalid replay request identity");
      const query = new URLSearchParams({ requestIdentityB64, meaningDigest });
      const response = await fetch(
        `/api/backtest/replays?${query.toString()}`,
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
          {status === "loading" ? (
            <FactGroupSkeletonGrid
              aria-label="Loading Replay request readback"
              layout="weighted"
              titles={["Request", "Custody", "Replay basis"]}
            />
          )
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
