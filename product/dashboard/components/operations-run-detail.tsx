"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  parseRunDetailEnvelopeV1,
  serializeBoundedRunResultV1,
  type RunDetailEnvelopeV1,
} from "../lib/run-detail-projection";
import {
  parseOwnerOutcomeResolutionEnvelopeV1,
  type OwnerOutcomeResolutionEnvelopeV1,
} from "../lib/owner-outcome-resolution-contract";
import {
  parseOperationalCacheDeletionEnvelopeV1,
  type OperationalCacheDeletionEnvelopeV1,
} from "../lib/run-cache-deletion-contract";
import {
  AggregateSummary,
  AggregateSummaryFact,
  AggregateSummaryGroup,
} from "./ui/aggregate-summary";
import {
  DetailFact,
  DetailFactGrid,
  DetailInspector,
  DetailInspectorFooter,
  DetailInspectorHeader,
  DetailNotice,
  DetailSection,
} from "./ui/detail-inspector";
import { EmptyState, EvidenceActions, EvidenceField, EvidenceStrip, UnavailableState } from "./ui/evidence-strip";
import { FilterLink, FilterTabs } from "./ui/filter-toolbar";
import { InterfaceIcons, ModuleIcons, RunIcons } from "./ui/iconography";
import { PanelFrame, PanelFrameBody, PanelFrameFooter, PanelFrameHeader } from "./ui/panel-frame";
import { PageStack } from "./ui/page-stack";
import { SplitBento } from "./ui/split-bento";
import { StatusBadge } from "./ui/status-badge";
import { availabilityTone } from "./ui/status-tone-policy";
import { OperationsRunLogs } from "./operations-run-logs";
import { OperationsRunAuxiliaryEvidence } from "./operations-run-auxiliary-evidence";

const tabs = ["Logs", "Metrics", "Traces", "Assets"] as const;
type DetailTab = typeof tabs[number];

function displayTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not started";
}
function displayDuration(value: number | null) {
  if (value === null) return "Not complete";
  return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(2)} s`;
}

const ownerLabels = {
  source_intake_owner: "Source Intake Owner",
  research_owner: "Research Owner",
  artifact_owner: "Artifact Owner",
  formation_catalog_owner: "Formation Catalog Owner",
  iteration_decision_owner: "Iteration Decision Owner",
  exploratory_replay_owner: "Exploratory Replay Owner",
  develop_composer_owner: "Develop Composer Owner",
} as const;

export function OperationsRunDetail({ runIdentity }: { runIdentity: string }) {
  const [result, setResult] = useState<RunDetailEnvelopeV1 | null>(null);
  const [pending, setPending] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("Logs");
  const [logRefreshVersion, setLogRefreshVersion] = useState(0);
  const [resolvingOwner, setResolvingOwner] = useState(false);
  const [ownerResolution, setOwnerResolution] = useState<OwnerOutcomeResolutionEnvelopeV1 | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteCapability, setDeleteCapability] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletionResult, setDeletionResult] = useState<OperationalCacheDeletionEnvelopeV1 | null>(null);

  const refresh = useCallback(async () => {
    setPending(true);
    try {
      const response = await fetch(`/api/operations/runs/${encodeURIComponent(runIdentity)}/`, {
        method: "GET",
        cache: "no-store",
      });
      const parsed = parseRunDetailEnvelopeV1(await response.json());
      setResult(parsed ?? {
        schema_version: 1,
        operation: "dashboard.run_store.detail.v1",
        availability: "unavailable",
        unavailable_reason: "RUN_DETAIL_RESPONSE_UNAVAILABLE",
        observed_at: new Date().toISOString(),
        run_identity: runIdentity,
        run: null,
        bounded_result: null,
        logs: [],
        operational_cache: null,
      });
    } catch {
      setResult({
        schema_version: 1,
        operation: "dashboard.run_store.detail.v1",
        availability: "unavailable",
        unavailable_reason: "RUN_DETAIL_TRANSPORT_UNAVAILABLE",
        observed_at: new Date().toISOString(),
        run_identity: runIdentity,
        run: null,
        bounded_result: null,
        logs: [],
        operational_cache: null,
      });
    } finally {
      setPending(false);
      setLogRefreshVersion((current) => current + 1);
    }
  }, [runIdentity]);

  useEffect(() => { void refresh(); }, [refresh]);

  const copyLocator = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`dashboard://operations/runs/${runIdentity}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch { setCopied(false); }
  }, [runIdentity]);

  const copyResult = useCallback(async () => {
    const serialized = serializeBoundedRunResultV1(result?.bounded_result);
    if (!serialized) return;
    try {
      await navigator.clipboard.writeText(serialized);
      setCopiedResult(true);
      window.setTimeout(() => setCopiedResult(false), 1_500);
    } catch { setCopiedResult(false); }
  }, [result?.bounded_result]);

  const resolveOwnerOutcome = useCallback(async () => {
    const run = result?.run;
    if (!run || resolvingOwner || run.owner_view.action_label !== "Resolve same identity") return;
    setResolvingOwner(true);
    setOwnerResolution(null);
    try {
      const response = await fetch(
        `/api/operations/runs/${encodeURIComponent(runIdentity)}/resolve-owner-outcome/`,
        {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_transition_version: run.transition_version }),
        },
      );
      const parsed = parseOwnerOutcomeResolutionEnvelopeV1(await response.json());
      setOwnerResolution(parsed ?? {
        schema_version: 1,
        operation: "dashboard.owner_outcome.resolve.v1",
        availability: "unavailable",
        unavailable_reason: "OWNER_RESOLUTION_RESPONSE_UNAVAILABLE",
        observed_at: new Date().toISOString(),
        source_run_identity: null,
        source_transition_version: null,
        resolved_operation_id: null,
        owner_outcome_state: null,
        replacement_run: null,
      });
    } catch {
      setOwnerResolution({
        schema_version: 1,
        operation: "dashboard.owner_outcome.resolve.v1",
        availability: "unavailable",
        unavailable_reason: "OWNER_RESOLUTION_TRANSPORT_UNAVAILABLE",
        observed_at: new Date().toISOString(),
        source_run_identity: null,
        source_transition_version: null,
        resolved_operation_id: null,
        owner_outcome_state: null,
        replacement_run: null,
      });
    } finally {
      setResolvingOwner(false);
    }
  }, [result?.run, resolvingOwner, runIdentity]);

  const deleteOperationalCache = useCallback(async () => {
    const run = result?.run;
    if (!run || deleting || !deleteConfirmed || deleteCapability.length < 32
      || result?.operational_cache?.state !== "retained") return;
    setDeleting(true);
    setDeletionResult(null);
    try {
      const response = await fetch(`/api/operations/runs/${encodeURIComponent(runIdentity)}/cache/`, {
        method: "DELETE",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${deleteCapability}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          confirmation: "DELETE_OPERATIONAL_CACHE",
          expected_transition_version: run.transition_version,
        }),
      });
      const parsed = parseOperationalCacheDeletionEnvelopeV1(await response.json());
      setDeletionResult(parsed);
      if (parsed?.availability === "available") {
        setDeleteCapability("");
        setDeleteConfirmed(false);
        setDeleteOpen(false);
        await refresh();
      }
    } catch {
      setDeletionResult(null);
    } finally {
      setDeleting(false);
    }
  }, [deleteCapability, deleteConfirmed, deleting, refresh, result, runIdentity]);

  if (result?.availability !== "available" || !result.run || !result.operational_cache) {
    return (
      <PanelFrame variant="flat" className="run-detail-panel" aria-labelledby="run-detail-title">
        <PanelFrameHeader eyebrow="Exact operational readback" title="Run detail" titleId="run-detail-title" actions={
          <button type="button" onClick={() => void refresh()} disabled={pending}>
            <InterfaceIcons.refresh aria-hidden="true" size={12} /> {pending ? "Reading…" : "Refresh"}
          </button>
        } />
        <UnavailableState density="compact" icon={<RunIcons.loaded aria-hidden="true" size={17} />}
          title="Run detail unavailable" reason={result?.unavailable_reason ?? "READING_RUN_DETAIL"} />
      </PanelFrame>
    );
  }

  const { run } = result;
  const boundedResult = result.bounded_result;
  const dispatch = run.dispatch_binding;
  const worker = run.worker_compatibility;
  return (
    <PageStack className="run-detail-page">
    <PanelFrame variant="flat" className="run-detail-panel bento-page-frame" aria-labelledby="run-detail-title">
      <PanelFrameHeader
        eyebrow={<>Exact operational readback · {new Date(result.observed_at).toLocaleString()}</>}
        title={run.operation_id}
        titleId="run-detail-title"
        meta={<code>{run.run_identity}</code>}
        actions={<>
          <button type="button" onClick={() => void copyLocator()}>
            <InterfaceIcons.copy aria-hidden="true" size={12} /> {copied ? "Copied" : "Copy locator"}
          </button>
          <button type="button" onClick={() => void refresh()} disabled={pending}>
            <InterfaceIcons.refresh aria-hidden="true" size={12} /> {pending ? "Reading…" : "Refresh"}
          </button>
          {result.operational_cache.state === "retained"
            && ["succeeded", "failed", "cancelled", "unknown"].includes(run.state) ? <button
              type="button" onClick={() => setDeleteOpen((open) => !open)}
            >
              <InterfaceIcons.delete aria-hidden="true" size={12} /> Delete cache
            </button> : null}
          {run.owner_view.action_label === "Resolve same identity" ? <button
            type="button"
            onClick={() => void resolveOwnerOutcome()}
            disabled={resolvingOwner}
          >
            <InterfaceIcons.autoRefresh aria-hidden="true" size={12} />
            {resolvingOwner ? "Resolving…" : "Resolve same identity"}
          </button> : null}
          <Link href={run.owner_view.href}>
            Open Owner view <InterfaceIcons.open aria-hidden="true" size={12} />
          </Link>
        </>}
      />
      <PanelFrameBody>
      <AggregateSummary className="run-detail-summaries" aria-label="Run summary">
        <AggregateSummaryGroup eyebrow="Semantic boundary" label="Semantic"
          value={run.owner_outcome_state} detail="Owner outcome class; never inferred from execution">
          <AggregateSummaryFact label="Operational" value={run.state} />
          <AggregateSummaryFact label="Terminal code" value={run.terminal_code ?? "Not terminal"} />
          <AggregateSummaryFact label="Transition" value={run.transition_version} />
        </AggregateSummaryGroup>
        <AggregateSummaryGroup eyebrow="RunStore timing" label="Duration"
          value={displayDuration(run.duration_ms)} detail="Operational timing only">
          <AggregateSummaryFact label="Timing / received" value={displayTime(run.received_at)} />
          <AggregateSummaryFact label="Started" value={displayTime(run.started_at)} />
          <AggregateSummaryFact label="Completed" value={displayTime(run.completed_at)} />
        </AggregateSummaryGroup>
      </AggregateSummary>

      <SplitBento className="run-detail-columns"
        columns="minmax(560px, 1.4fr) minmax(320px, 1fr)">
        <DetailInspector as="section" aria-label="Allowlisted operational input">
          <DetailInspectorHeader eyebrow="Allowlisted operational input" title="Metadata and inputs" />
          <DetailFactGrid>
            <DetailFact label="Trigger / kind"><b>{run.trigger_kind} · {run.run_kind}</b></DetailFact>
            <DetailFact label="Channel"><b>{run.channel}</b></DetailFact>
            <DetailFact label="Transition"><b>{run.transition_version}</b></DetailFact>
            <DetailFact label="Retained until"><time dateTime={run.retained_until}>{displayTime(run.retained_until)}</time></DetailFact>
            {run.input_fields.map(({ key, value }) => <DetailFact key={key} label={key}><b>{value}</b></DetailFact>)}
          </DetailFactGrid>
          <DetailNotice icon={<RunIcons.loaded aria-hidden="true" size={14} />} title="Owner-custodied fields withheld">
            {run.withheld_fields.length} fields · {run.withheld_fields.map(({ field, reason }) => `${field}: ${reason}`).join(" · ")}
          </DetailNotice>
        </DetailInspector>
        <DetailInspector aria-label="Exact-run worker and dispatch evidence">
          <DetailInspectorHeader
            eyebrow="Exact-run worker compatibility"
            title={worker.availability}
            status={<StatusBadge tone={availabilityTone(worker.availability)}>{worker.availability}</StatusBadge>}
          />
          {worker.availability === "available" ? <DetailFactGrid>
            <DetailFact label="Worker"><b>{worker.worker_identity}</b></DetailFact>
            <DetailFact label="Lease now"><b>{worker.worker_lease_state}</b></DetailFact>
            <DetailFact label="Claim attempt"><b>{worker.claim_attempt}</b></DetailFact>
            <DetailFact label="Artifact"><b>{worker.worker_artifact_digest}</b></DetailFact>
          </DetailFactGrid> : <DetailNotice icon={<RunIcons.cancelled aria-hidden="true" size={14} />} title="Worker evidence unavailable">
            {worker.unavailable_reason ?? "No worker is required for this run kind."}
          </DetailNotice>}
          <DetailSection label="Immutable dispatch binding" meta={dispatch.availability}>
            {dispatch.availability === "available" ? <DetailFactGrid>
              <DetailFact label="Operation"><b>{dispatch.required_operation_id}</b></DetailFact>
              <DetailFact label="Dependencies"><b>{dispatch.dependency_operation_ids.length
                ? dispatch.dependency_operation_ids.join(" → ") : "None"}</b></DetailFact>
              <DetailFact label="Registry cut"><b>{dispatch.registry_entry_digest}</b></DetailFact>
              <DetailFact label="Compatibility set"><b>{dispatch.compatibility_envelope_set_digest}</b></DetailFact>
            </DetailFactGrid> : <p className="detail-section-copy">
              {dispatch.unavailable_reason ?? "No dispatch binding is required for this run kind."}
            </p>}
          </DetailSection>
          <DetailNotice icon={<ModuleIcons.shield aria-hidden="true" size={14} />} title="Historical submission evidence only">
            Compatibility cannot promote Owner outcome, service health, deployment approval, dependency execution, or queue authority.
          </DetailNotice>
        </DetailInspector>
      </SplitBento>

      <DetailInspector as="section" className="run-detail-owner-view" aria-label="Owner view locator">
        <DetailInspectorHeader eyebrow="Same-identity Owner view" title={ownerLabels[run.owner_view.source_owner]} />
        <p className="detail-inspector-lede">
          RunStore retains no Owner payload. The linked typed GET-only view resolves the exact identities again from the source Owner.
        </p>
        <DetailFactGrid>
          <DetailFact label="Availability"><b>Owner read required</b></DetailFact>
          <DetailFact label="Source Owner"><b>{run.owner_view.source_owner}</b></DetailFact>
          <DetailFact label="Next legal action"><b>{run.owner_view.action_label}</b></DetailFact>
          <DetailFact label="Receipt / source cut"><b>Resolved only by the linked Owner projection</b></DetailFact>
          {run.owner_view.identity_fields.map(({ key, value }) => (
            <DetailFact key={key} label={key}><b>{value}</b></DetailFact>
          ))}
        </DetailFactGrid>
        {ownerResolution ? <DetailNotice
          icon={<InterfaceIcons.autoRefresh aria-hidden="true" size={14} />}
          title={ownerResolution.availability === "available"
            ? `Resolution readback · Owner outcome · ${ownerResolution.owner_outcome_state}`
            : `Resolution readback · ${ownerResolution.unavailable_reason}`}
        >
          {ownerResolution.replacement_run?.run_identity ? <Link
            href={`/operations/runs/${encodeURIComponent(ownerResolution.replacement_run.run_identity)}`}
          >
            Open replacement run <InterfaceIcons.open aria-hidden="true" size={12} />
          </Link> : "No retry or replacement effect was inferred."}
        </DetailNotice> : null}
        <DetailInspectorFooter>
          <span>Owner payload, receipt bytes and source authority remain outside RunStore.</span>
          <FilterLink href={run.owner_view.href}>
            Open Owner view <InterfaceIcons.open aria-hidden="true" size={13} />
          </FilterLink>
        </DetailInspectorFooter>
      </DetailInspector>

      {deleteOpen && result.operational_cache.state === "retained" ? <DetailInspector
        as="section" className="run-cache-delete-panel" aria-label="Delete disposable operational cache"
      >
        <DetailInspectorHeader eyebrow="Dashboard-owned disposable data" title="Delete operational cache" />
        <p className="detail-inspector-lede">
          This removes the bounded result and log viewport for this terminal run only. The run tombstone,
          Owner locator and append-only audit codes remain. Windmill jobs and Owner facts are never touched.
        </p>
        <label className="run-cache-delete-field">
          <span>Operator capability</span>
          <input type="password" autoComplete="off" value={deleteCapability}
            onChange={(event) => setDeleteCapability(event.target.value)} />
        </label>
        <label className="run-cache-delete-confirmation">
          <input type="checkbox" checked={deleteConfirmed}
            onChange={(event) => setDeleteConfirmed(event.target.checked)} />
          <span>I understand only Dashboard operational cache is deleted.</span>
        </label>
        {deletionResult?.availability === "unavailable" ? <DetailNotice icon={<RunIcons.cancelled aria-hidden="true" size={14} />}
          title="Cache deletion unavailable">{deletionResult.unavailable_reason}</DetailNotice> : null}
        <DetailInspectorFooter>
          <span>Exact transition {run.transition_version} · no generic delete or batch action</span>
          <button type="button" disabled={!deleteConfirmed || deleteCapability.length < 32 || deleting}
            onClick={() => void deleteOperationalCache()}>
            <InterfaceIcons.delete aria-hidden="true" size={12} /> {deleting ? "Deleting…" : "Delete operational cache"}
          </button>
        </DetailInspectorFooter>
      </DetailInspector> : null}

      <section className="run-detail-result" aria-labelledby="run-detail-result-title">
        <header>
          <div><span>Bounded operational evidence</span><h3 id="run-detail-result-title">Run result</h3></div>
          <FilterTabs label="Run result views" items={tabs.map((tab) => ({ value: tab, label: tab }))}
            selected={activeTab} onSelect={(tab) => setActiveTab(tab as DetailTab)} variant="rail" />
        </header>
        {result.operational_cache.state !== "retained" ? <EmptyState icon={<InterfaceIcons.delete aria-hidden="true" size={16} />}
          title={result.operational_cache.state === "deleted"
            ? "Operational cache deleted" : "Operational data expired"}>
          {result.operational_cache.state === "deleted"
            ? `Receipt ${result.operational_cache.deletion_receipt?.receipt_identity} · deleted ${displayTime(
              result.operational_cache.deletion_receipt?.deleted_at ?? null,
            )}. Run tombstone and Owner locator remain available.`
            : `Retention ended ${displayTime(run.retained_until)}. Run tombstone and Owner locator remain available; no deletion receipt is invented.`}
        </EmptyState> : boundedResult ? <><EvidenceStrip layout="result" aria-label="Bounded run result">
          <EvidenceField label="Allowlisted operational result"><b>{boundedResult.operational_state}</b>
            <small>Owner outcome · {boundedResult.owner_outcome_state}</small></EvidenceField>
          <EvidenceField label="Terminal code"><b>{boundedResult.terminal_code ?? "Not terminal"}</b></EvidenceField>
          <EvidenceField label="Transition"><b>{boundedResult.transition_version}</b></EvidenceField>
          <EvidenceField label="Completed"><b>{displayTime(boundedResult.completed_at)}</b></EvidenceField>
          <EvidenceField label="Retention"><b>{displayTime(boundedResult.retained_until)}</b></EvidenceField>
          <EvidenceActions>
            <button type="button" onClick={() => void copyResult()}>
              <InterfaceIcons.copy aria-hidden="true" size={12} /> {copiedResult ? "Copied JSON" : "Copy result JSON"}
            </button>
            <a href={`/api/operations/runs/${encodeURIComponent(runIdentity)}/result/download/`} download>
              <InterfaceIcons.download aria-hidden="true" size={12} /> Download bounded result
            </a>
          </EvidenceActions>
        </EvidenceStrip>
        <PanelFrameFooter>{boundedResult.withheld_fields.length} fields withheld · {boundedResult.withheld_fields
          .map(({ field, reason }) => `${field}: ${reason}`).join(" · ")}</PanelFrameFooter>
        {activeTab === "Logs" ? <OperationsRunLogs runIdentity={runIdentity} refreshVersion={logRefreshVersion} />
          : <OperationsRunAuxiliaryEvidence runIdentity={runIdentity}
              evidenceKind={activeTab === "Metrics" ? "metrics" : activeTab === "Traces" ? "traces" : "assets"} />}</>
          : <UnavailableState density="compact" icon={<RunIcons.loaded aria-hidden="true" size={16} />}
            title="Bounded result unavailable" reason="RUN_RESULT_PROJECTION_UNAVAILABLE" />}
      </section>
      </PanelFrameBody>
    </PanelFrame>
    </PageStack>
  );
}
