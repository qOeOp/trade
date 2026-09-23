"use client";

import { useCallback, useRef, useState } from "react";

import {
  parseExploratoryReplayBrowserProjectionV1,
  type ExploratoryReplayBrowserProjectionV1,
} from "../lib/exploratory-replay-readback-gateway";
import {
  parseExploratoryReplayHistoricalRejectionBrowserProjectionV1,
  type ExploratoryReplayHistoricalRejectionBrowserProjectionV1,
} from "../lib/exploratory-replay-historical-rejection-gateway";
import {
  parseExploratoryReplayResultBrowserProjectionV1,
  type ExploratoryReplayResultBrowserProjectionV1,
} from "../lib/exploratory-replay-result-gateway";
import {
  encodeExploratoryReplayOpaqueIdentityV2,
  validExploratoryReplayOpaqueIdentityV2,
} from "../lib/exploratory-replay-identity";
import { BacktestRunReportReadback } from "./backtest-run-report-readback";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem } from "./ui/fact-group";
import { FilterButton } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameHeader,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
  PanelSection,
} from "./ui/panel-frame";
import { ReadbackLookup, ReadbackLookupAction, ReadbackLookupField, ReadbackLookupInput } from "./ui/readback-lookup";
import { StatusBadge } from "./ui/status-badge";
import styles from "./exploratory-replay-readback-workbench.module.css";

const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;
const LEGACY_IDENTITY = /^[A-Za-z0-9._:-]{16,200}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

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

function AvailableHistoricalRejection({
  projection,
}: {
  projection: ExploratoryReplayHistoricalRejectionBrowserProjectionV1;
}) {
  if (!projection.outcome) return null;
  return (
    <FactGroupGrid>
      <FactGroup title="Outcome">
        <FactItem label="Record"><StatusBadge tone="warning">Historical</StatusBadge></FactItem>
        <FactItem label="Result"><StatusBadge tone="danger">Rejected</StatusBadge></FactItem>
      </FactGroup>
      <FactGroup title="Custody">
        <FactItem label="Verification"><StatusBadge tone="warning">Quarantined</StatusBadge></FactItem>
        <FactItem label="Reason">Invalid replay evidence</FactItem>
      </FactGroup>
      <FactGroup title="Timing">
        <FactItem label="Committed">{new Date(projection.outcome.committedAt).toLocaleString()}</FactItem>
        <FactItem label="Observed">{new Date(projection.observedAt!).toLocaleString()}</FactItem>
      </FactGroup>
    </FactGroupGrid>
  );
}

export function ExploratoryReplayReadbackWorkbench({
  initialRequestIdentity,
  initialMeaningDigest,
  initialResultIdentity,
  initialAttemptIdentity,
  initialHistoricalRequestIdentity,
  initialHistoricalAttemptIdentity,
  initialHistoricalSemanticDigest,
}: {
  initialRequestIdentity?: string;
  initialMeaningDigest?: string;
  initialResultIdentity?: string;
  initialAttemptIdentity?: string;
  initialHistoricalRequestIdentity?: string;
  initialHistoricalAttemptIdentity?: string;
  initialHistoricalSemanticDigest?: string;
}) {
  const [requestInput, setRequestInput] = useState(initialRequestIdentity ?? "");
  const [meaningInput, setMeaningInput] = useState(initialMeaningDigest ?? "");
  const [openedSelector, setOpenedSelector] = useState<Readonly<{
    requestIdentity: string;
    meaningDigest: string;
  }> | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "available" | "unavailable">("idle");
  const [projection, setProjection] = useState<ExploratoryReplayBrowserProjectionV1 | null>(null);
  const [resultIdentity, setResultIdentity] = useState(initialResultIdentity ?? "");
  const [attemptIdentity, setAttemptIdentity] = useState(initialAttemptIdentity ?? "");
  const [resultStatus, setResultStatus] = useState<"idle" | "loading" | "available" | "unavailable">("idle");
  const [resultProjection, setResultProjection] = useState<ExploratoryReplayResultBrowserProjectionV1 | null>(null);
  const [resultValidation, setResultValidation] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [historicalRequestInput, setHistoricalRequestInput] = useState(
    initialHistoricalRequestIdentity ?? "",
  );
  const [historicalAttemptInput, setHistoricalAttemptInput] = useState(
    initialHistoricalAttemptIdentity ?? "",
  );
  const [historicalSemanticInput, setHistoricalSemanticInput] = useState(
    initialHistoricalSemanticDigest ?? "",
  );
  const [historicalOpenedSelector, setHistoricalOpenedSelector] = useState<Readonly<{
    requestIdentity: string;
    attemptIdentity: string;
    semanticDigest: string;
  }> | null>(null);
  const [historicalStatus, setHistoricalStatus] = useState<
    "idle" | "loading" | "available" | "unavailable"
  >("idle");
  const [historicalProjection, setHistoricalProjection] = useState<
    ExploratoryReplayHistoricalRejectionBrowserProjectionV1 | null
  >(null);
  const [historicalValidation, setHistoricalValidation] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const resultSequence = useRef(0);
  const historicalSequence = useRef(0);

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

  const readHistorical = useCallback(async (
    requestCandidate: string,
    attemptCandidate: string,
    semanticCandidate: string,
  ) => {
    const sequence = ++historicalSequence.current;
    setHistoricalProjection(null);
    if (!LEGACY_IDENTITY.test(requestCandidate) || !LEGACY_IDENTITY.test(attemptCandidate)
      || !SHA256.test(semanticCandidate)) {
      setHistoricalOpenedSelector(null);
      setHistoricalStatus("idle");
      setHistoricalValidation("Enter the exact historical request, attempt, and sha256 digest.");
      return;
    }
    const selector = {
      requestIdentity: requestCandidate,
      attemptIdentity: attemptCandidate,
      semanticDigest: semanticCandidate,
    };
    setHistoricalOpenedSelector(selector);
    setHistoricalValidation(null);
    setHistoricalStatus("loading");
    try {
      const requestIdentityB64 = encodeExploratoryReplayOpaqueIdentityV2(requestCandidate);
      const attemptIdentityB64 = encodeExploratoryReplayOpaqueIdentityV2(attemptCandidate);
      if (!requestIdentityB64 || !attemptIdentityB64) throw new Error("invalid historical selector");
      const query = new URLSearchParams({
        requestIdentityB64,
        attemptIdentityB64,
        semanticDigest: semanticCandidate,
      });
      const response = await fetch(`/api/backtest/rejections?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const parsed = parseExploratoryReplayHistoricalRejectionBrowserProjectionV1(
        await response.json(), requestCandidate, attemptCandidate, semanticCandidate,
      );
      if (historicalSequence.current !== sequence) return;
      setHistoricalProjection(parsed);
      setHistoricalStatus(response.ok && parsed?.availability === "available"
        ? "available" : "unavailable");
    } catch {
      if (historicalSequence.current !== sequence) return;
      setHistoricalProjection(null);
      setHistoricalStatus("unavailable");
    }
  }, []);

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
            {historicalOpenedSelector ? (
              <PanelFrameInfoList>
                <PanelFrameInfoFact label="Historical request"><code>{historicalOpenedSelector.requestIdentity}</code></PanelFrameInfoFact>
                <PanelFrameInfoFact label="Attempt"><code>{historicalOpenedSelector.attemptIdentity}</code></PanelFrameInfoFact>
                <PanelFrameInfoFact label="Semantic digest"><code>{historicalOpenedSelector.semanticDigest}</code></PanelFrameInfoFact>
                <PanelFrameInfoFact label="Owner receipt"><code>{historicalProjection?.technical?.receiptIdentity ?? "Not available"}</code></PanelFrameInfoFact>
                <PanelFrameInfoFact label="Artifact"><code>{historicalProjection?.technical?.artifactIdentity ?? "Not available"}</code></PanelFrameInfoFact>
                <PanelFrameInfoFact label="Build receipt"><code>{historicalProjection?.technical?.buildReceiptIdentity ?? "Not available"}</code></PanelFrameInfoFact>
                <PanelFrameInfoFact label="Source channel">{historicalProjection?.technical?.channel ?? "Not available"}</PanelFrameInfoFact>
              </PanelFrameInfoList>
            ) : null}
          </PanelFrameInfo>
          <FilterButton
            density="compact"
            variant="secondary"
            disabled={(!openedSelector && !historicalOpenedSelector)
              || status === "loading" || historicalStatus === "loading"}
            onClick={() => {
              if (openedSelector) void read(openedSelector.requestIdentity, openedSelector.meaningDigest);
              if (historicalOpenedSelector) void readHistorical(
                historicalOpenedSelector.requestIdentity,
                historicalOpenedSelector.attemptIdentity,
                historicalOpenedSelector.semanticDigest,
              );
            }}
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
        <PanelSection className={styles.historicalSection}>
          <h3 className={styles.sectionTitle}>Historical rejection</h3>
          <ReadbackLookup
            columns="triple"
            validation={historicalValidation}
            validationId="exploratory-replay-historical-validation"
            onSubmit={(event) => {
              event.preventDefault();
              void readHistorical(
                historicalRequestInput,
                historicalAttemptInput,
                historicalSemanticInput,
              );
            }}
          >
            <ReadbackLookupField label="Request identity">
              <ReadbackLookupInput
                aria-describedby={historicalValidation
                  ? "exploratory-replay-historical-validation" : undefined}
                aria-invalid={Boolean(historicalValidation)}
                autoComplete="off"
                onChange={(event) => {
                  setHistoricalRequestInput(event.target.value);
                  setHistoricalValidation(null);
                }}
                placeholder="historical request"
                spellCheck={false}
                typography="mono"
                value={historicalRequestInput}
              />
            </ReadbackLookupField>
            <ReadbackLookupField label="Attempt identity">
              <ReadbackLookupInput
                aria-describedby={historicalValidation
                  ? "exploratory-replay-historical-validation" : undefined}
                aria-invalid={Boolean(historicalValidation)}
                autoComplete="off"
                onChange={(event) => {
                  setHistoricalAttemptInput(event.target.value);
                  setHistoricalValidation(null);
                }}
                placeholder="historical attempt"
                spellCheck={false}
                typography="mono"
                value={historicalAttemptInput}
              />
            </ReadbackLookupField>
            <ReadbackLookupField label="Semantic digest">
              <ReadbackLookupInput
                aria-describedby={historicalValidation
                  ? "exploratory-replay-historical-validation" : undefined}
                aria-invalid={Boolean(historicalValidation)}
                autoComplete="off"
                onChange={(event) => {
                  setHistoricalSemanticInput(event.target.value);
                  setHistoricalValidation(null);
                }}
                placeholder="sha256:…"
                spellCheck={false}
                typography="mono"
                value={historicalSemanticInput}
              />
            </ReadbackLookupField>
            <ReadbackLookupAction disabled={historicalStatus === "loading"}>
              Open historical <EvidenceIcons.next aria-hidden="true" size={12} />
            </ReadbackLookupAction>
          </ReadbackLookup>
          <div className={styles.historicalResult} aria-live="polite">
            {historicalStatus === "loading" ? (
              <FactGroupSkeletonGrid
                aria-label="Loading historical Replay rejection"
                titles={["Outcome", "Custody", "Timing"]}
              />
            ) : historicalStatus === "available" && historicalProjection ? (
              <AvailableHistoricalRejection projection={historicalProjection} />
            ) : historicalStatus === "unavailable" ? (
              <UnavailableState
                density="compact"
                icon={<EvidenceIcons.warning aria-hidden="true" size={20} />}
                title="Historical rejection unavailable"
                reason={historicalProjection?.reason ?? "HISTORICAL_REPLAY_REJECTION_TRANSPORT_UNAVAILABLE"}
              />
            ) : null}
          </div>
        </PanelSection>
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
                <>
                  <AvailableResult projection={resultProjection} />
                  {/* The report is its own admitted surface, mounted only for the result this lookup
                      opened and keyed by that result's full locator. */}
                  <BacktestRunReportReadback
                    key={[
                      resultProjection.resultIdentity,
                      resultProjection.requestIdentity,
                      resultProjection.attemptIdentity,
                    ].join("\u0000")}
                    locator={{
                      result_identity: resultProjection.resultIdentity,
                      request_identity: resultProjection.requestIdentity,
                      attempt_identity: resultProjection.attemptIdentity,
                    }}
                  />
                </>
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
