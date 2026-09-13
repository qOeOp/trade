"use client";

import { useCallback, useRef, useState } from "react";

import {
  parseExploratoryReplayBrowserProjectionV1,
  type ExploratoryReplayBrowserProjectionV1,
} from "../lib/exploratory-replay-readback-gateway";
import {
  parseExploratoryReplayResultBrowserProjectionV1,
  type ExploratoryReplayResultBrowserProjectionV1,
} from "../lib/exploratory-replay-result-gateway";
import {
  encodeExploratoryReplayOpaqueIdentityV2,
  validExploratoryReplayOpaqueIdentityV2,
} from "../lib/exploratory-replay-identity";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem } from "./ui/fact-group";
import { FilterButton } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { PanelFrame, PanelFrameBody, PanelFrameHeader, PanelFrameInfo } from "./ui/panel-frame";
import { ReadbackLookup, ReadbackLookupAction, ReadbackLookupField, ReadbackLookupInput } from "./ui/readback-lookup";
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
    </>
  );
}

const diagnosticLabels = {
  NO_EXECUTION_DEFECT: "no execution defect",
  MARKET_DATA: "market data",
  ARTIFACT: "artifact",
  RUNTIME_KERNEL: "runtime kernel",
  BACKTEST_OPERATIONAL: "backtest operational",
  SIMULATOR: "simulator",
  REPLAY_CONFIGURATION: "replay configuration",
  VALID_ECONOMIC_FAILURE: "valid economic failure",
  UNRESOLVED_FAILURE: "unresolved failure",
} as const;

function AvailableResult({ projection }: { projection: ExploratoryReplayResultBrowserProjectionV1 }) {
  if (!projection.result) return null;
  const terminal = projection.result.terminal;
  const terminalLabel = terminal === "TERMINAL_RESULT" ? "complete"
    : terminal === "RUN_REJECTED" ? "rejected"
      : terminal === "INVALID_REPLAY_EVIDENCE" ? "invalid evidence" : "in progress";
  const tone = terminal === "TERMINAL_RESULT" ? "success"
    : terminal === "INVALID_REPLAY_EVIDENCE" ? "danger"
      : terminal === "RUN_REJECTED" ? "warning" : "neutral";
  const diagnosis = projection.result.diagnostics.length === 0
    ? "pending"
    : projection.result.diagnostics.map((item) => diagnosticLabels[item]).join(", ");
  return (
    <FactGroupGrid className={styles.resultCard}>
      <FactGroup title="Result">
        <FactItem label="Status"><StatusBadge tone={tone}>{terminalLabel}</StatusBadge></FactItem>
        <FactItem label="Diagnosis">{diagnosis}</FactItem>
        <FactItem label="Reconciled">{projection.result.exactComponents} / {projection.result.totalComponents}</FactItem>
        <FactItem label="Trace">{projection.result.semanticTraceAvailable ? "available" : "not available"}</FactItem>
        <FactItem label="Identity" mono title={projection.resultIdentity}>{projection.resultIdentity}</FactItem>
      </FactGroup>
    </FactGroupGrid>
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
  const [resultIdentity, setResultIdentity] = useState("");
  const [attemptIdentity, setAttemptIdentity] = useState("");
  const [resultStatus, setResultStatus] = useState<"idle" | "loading" | "available" | "unavailable">("idle");
  const [resultProjection, setResultProjection] = useState<ExploratoryReplayResultBrowserProjectionV1 | null>(null);
  const [resultValidation, setResultValidation] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const resultSequence = useRef(0);

  const read = useCallback(async (requestCandidate: string, meaningCandidate: string) => {
    const requestIdentity = requestCandidate;
    const meaningDigest = meaningCandidate;
    const sequence = ++requestSequence.current;
    setProjection(null);
    setResultProjection(null);
    setResultStatus("idle");
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

  const readResult = useCallback(async () => {
    const selector = openedSelector;
    const sequence = ++resultSequence.current;
    setResultProjection(null);
    if (!selector || !validExploratoryReplayOpaqueIdentityV2(resultIdentity)
      || !validExploratoryReplayOpaqueIdentityV2(attemptIdentity)) {
      setResultStatus("idle");
      setResultValidation("Enter the exact result identity and attempt identity.");
      return;
    }
    setResultValidation(null);
    setResultStatus("loading");
    try {
      const encoded = [selector.requestIdentity, attemptIdentity, resultIdentity]
        .map(encodeExploratoryReplayOpaqueIdentityV2);
      if (encoded.some((value) => !value)) throw new Error("invalid result selector");
      const query = new URLSearchParams({
        requestIdentityB64: encoded[0]!,
        meaningDigest: selector.meaningDigest,
        attemptIdentityB64: encoded[1]!,
        resultIdentityB64: encoded[2]!,
      });
      const response = await fetch(`/api/backtest/results?${query.toString()}`, { cache: "no-store" });
      const parsed = parseExploratoryReplayResultBrowserProjectionV1(await response.json());
      if (resultSequence.current !== sequence) return;
      if (!response.ok || !parsed || parsed.availability !== "available"
        || parsed.requestIdentity !== selector.requestIdentity
        || parsed.meaningDigest !== selector.meaningDigest
        || parsed.attemptIdentity !== attemptIdentity || parsed.resultIdentity !== resultIdentity) {
        setResultProjection(parsed);
        setResultStatus("unavailable");
        return;
      }
      setResultProjection(parsed);
      setResultStatus("available");
    } catch {
      if (resultSequence.current !== sequence) return;
      setResultStatus("unavailable");
    }
  }, [attemptIdentity, openedSelector, resultIdentity]);

  return (
    <PanelFrame className={styles.panel} aria-labelledby="exploratory-replay-title">
      <PanelFrameHeader
        eyebrow="Exploratory replay"
        title="Replay request"
        titleId="exploratory-replay-title"
        actions={<>
          <PanelFrameInfo label="View Replay read boundary">
            <b>Read boundary</b>
            <p>Opens one sealed request and one exact Owner-verified result. Run and Resolve remain unavailable.</p>
          </PanelFrameInfo>
          <FilterButton
            density="compact"
            variant="secondary"
            disabled={!openedSelector || status === "loading"}
            onClick={() => openedSelector
              && void read(openedSelector.requestIdentity, openedSelector.meaningDigest)}
            type="button"
          >
            <InterfaceIcons.refresh aria-hidden="true" size={14} /> Refresh
          </FilterButton>
        </>}
      />
      <PanelFrameBody className={styles.body}>
        <ReadbackLookup
          columns="double"
          validation={validation}
          validationId="exploratory-replay-validation"
          onSubmit={(event) => {
            event.preventDefault();
            void read(requestInput, meaningInput);
          }}
        >
          <ReadbackLookupField label="Request identity">
            <ReadbackLookupInput
              aria-describedby={validation ? "exploratory-replay-validation" : undefined}
              aria-invalid={Boolean(validation)}
              autoComplete="off"
              onChange={(event) => {
                setRequestInput(event.target.value);
                setValidation(null);
              }}
              placeholder="request identity"
              spellCheck={false}
              typography="mono"
              value={requestInput}
            />
          </ReadbackLookupField>
          <ReadbackLookupField label="Meaning digest">
            <ReadbackLookupInput
              aria-describedby={validation ? "exploratory-replay-validation" : undefined}
              aria-invalid={Boolean(validation)}
              autoComplete="off"
              onChange={(event) => {
                setMeaningInput(event.target.value);
                setValidation(null);
              }}
              placeholder="blake3:…"
              spellCheck={false}
              typography="mono"
              value={meaningInput}
            />
          </ReadbackLookupField>
          <ReadbackLookupAction disabled={status === "loading"}>
            Open readback <EvidenceIcons.next aria-hidden="true" size={12} />
          </ReadbackLookupAction>
        </ReadbackLookup>
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
        {status === "available" && openedSelector ? (
          <div className={styles.resultLookup}>
            <ReadbackLookup
              columns="double"
              validation={resultValidation}
              validationId="exploratory-replay-result-validation"
              onSubmit={(event) => {
                event.preventDefault();
                void readResult();
              }}
            >
              <ReadbackLookupField label="Result identity">
                <ReadbackLookupInput
                  aria-describedby={resultValidation ? "exploratory-replay-result-validation" : undefined}
                  aria-invalid={Boolean(resultValidation)}
                  autoComplete="off"
                  onChange={(event) => {
                    setResultIdentity(event.target.value);
                    setResultValidation(null);
                  }}
                  placeholder="result identity"
                  spellCheck={false}
                  typography="mono"
                  value={resultIdentity}
                />
              </ReadbackLookupField>
              <ReadbackLookupField label="Attempt identity">
                <ReadbackLookupInput
                  aria-describedby={resultValidation ? "exploratory-replay-result-validation" : undefined}
                  aria-invalid={Boolean(resultValidation)}
                  autoComplete="off"
                  onChange={(event) => {
                    setAttemptIdentity(event.target.value);
                    setResultValidation(null);
                  }}
                  placeholder="attempt identity"
                  spellCheck={false}
                  typography="mono"
                  value={attemptIdentity}
                />
              </ReadbackLookupField>
              <ReadbackLookupAction disabled={resultStatus === "loading"}>
                Open result <EvidenceIcons.next aria-hidden="true" size={12} />
              </ReadbackLookupAction>
            </ReadbackLookup>
            <div className={styles.resultReadback} aria-live="polite">
              {resultStatus === "loading" ? (
                <FactGroupSkeletonGrid aria-label="Loading Replay result" titles={["Result"]} />
              ) : resultStatus === "available" && resultProjection ? (
                <AvailableResult projection={resultProjection} />
              ) : resultStatus === "unavailable" ? (
                <UnavailableState
                  density="compact"
                  icon={<EvidenceIcons.warning aria-hidden="true" size={20} />}
                  title="Replay result unavailable"
                  reason={resultProjection?.reason ?? "EXPLORATORY_REPLAY_RESULT_TRANSPORT_UNAVAILABLE"}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </PanelFrameBody>
    </PanelFrame>
  );
}
