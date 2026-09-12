"use client";

import { useEffect, useRef, useState } from "react";

import { deriveGeneratedArtifactIdentitiesV1 } from "../../rd-owner-client/artifact_build_v1";
import {
  parseArtifactFormationBrowserStateV1,
  parseArtifactFormationPreflightBrowserStateV1,
  type ArtifactFormationBrowserStateV1,
} from "../lib/artifact-formation-browser-contract";
import { ActionAdmissionGate } from "./ui/action-admission-gate";
import { FilterButton, FilterLink } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";

type ControlState = "IDLE" | "PREFLIGHTING" | "ADMITTING"
  | "REVALIDATION_REQUIRED" | "SUBMITTED_OR_UNKNOWN" | "TERMINAL";

type RecoveryIdentity = Readonly<{
  buildRequestIdentity: string;
  attemptIdentity: string;
}>;

function messageFor(state: ControlState, result: ArtifactFormationBrowserStateV1 | null): string {
  if (state === "PREFLIGHTING") return "Checking current Research custody";
  if (state === "ADMITTING") return "Submitting one bounded request";
  if (state === "SUBMITTED_OR_UNKNOWN") return "Delivery uncertain · resolve this attempt only";
  if (state === "TERMINAL") return result?.resolution?.toLowerCase().replaceAll("_", " ") ?? "Terminal Owner outcome";
  if (state === "REVALIDATION_REQUIRED") return result?.unavailableReason ?? "Refresh Research custody";
  return "No Artifact attempt yet";
}

export function ArtifactFormationControl({ researchRequestIdentity }: { researchRequestIdentity: string }) {
  const [state, setState] = useState<ControlState>("IDLE");
  const [capability, setCapability] = useState("");
  const [recovery, setRecovery] = useState<RecoveryIdentity | null>(null);
  const [result, setResult] = useState<ArtifactFormationBrowserStateV1 | null>(null);
  const preflightController = useRef<AbortController | null>(null);

  useEffect(() => () => preflightController.current?.abort(), []);

  async function postFormation(
    request: {
      action: "RUN" | "RESOLVE";
      build_request_identity: string;
      attempt_identity: string;
      research_request_identity: string;
      identity_mode: "GENERATE" | "EXACT";
    },
    expected: RecoveryIdentity,
    token: string,
  ) {
    const response = await fetch("/api/rd/artifacts/formations/", {
      method: "POST",
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    return parseArtifactFormationBrowserStateV1(
      await response.json(),
      expected.buildRequestIdentity,
      expected.attemptIdentity,
    );
  }

  async function checkAndRun() {
    if (capability.length < 32 || state === "PREFLIGHTING" || state === "ADMITTING") return;
    const token = capability;
    const buildSeed = `dashboard-build-generation-v1-${crypto.randomUUID()}`;
    const attemptSeed = `dashboard-attempt-generation-v1-${crypto.randomUUID()}`;
    const generated = await deriveGeneratedArtifactIdentitiesV1(
      buildSeed,
      attemptSeed,
      researchRequestIdentity,
    );
    if (!generated) {
      setState("REVALIDATION_REQUIRED");
      return;
    }
    const exact = {
      buildRequestIdentity: generated.build_request_identity,
      attemptIdentity: generated.attempt_identity,
    };
    const controller = new AbortController();
    preflightController.current = controller;
    setResult(null);
    setRecovery(null);
    setState("PREFLIGHTING");
    let dispatched = false;
    try {
      const preflightResponse = await fetch("/api/rd/artifacts/formations/preflight/", {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ research_request_identity: researchRequestIdentity }),
      });
      const preflight = parseArtifactFormationPreflightBrowserStateV1(
        await preflightResponse.json(),
        researchRequestIdentity,
      );
      if (!preflight || preflight.availability !== "available" || preflight.actionState !== "READY") {
        setResult(preflight ? {
          availability: "unavailable",
          unavailableReason: preflight.unavailableReason,
          resolution: null,
          buildRequestIdentity: null,
          attemptIdentity: null,
          nextLegalAction: null,
          runIdentity: null,
        } : null);
        setState("REVALIDATION_REQUIRED");
        return;
      }
      preflightController.current = null;
      dispatched = true;
      setRecovery(exact);
      setCapability("");
      setState("ADMITTING");
      const parsed = await postFormation({
        action: "RUN",
        build_request_identity: buildSeed,
        attempt_identity: attemptSeed,
        research_request_identity: researchRequestIdentity,
        identity_mode: "GENERATE",
      }, exact, token);
      setResult(parsed);
      if (!parsed || parsed.availability === "unavailable") {
        setState("SUBMITTED_OR_UNKNOWN");
      } else if (["SUCCESS", "FAILED_NO_ARTIFACT", "REJECTED_NO_WRITE"].includes(parsed.resolution ?? "")) {
        setState("TERMINAL");
      } else if (parsed.resolution === "SUBMITTED_OR_UNKNOWN" || parsed.resolution === "OUTCOME_UNKNOWN") {
        setState("SUBMITTED_OR_UNKNOWN");
      } else {
        setState("SUBMITTED_OR_UNKNOWN");
      }
    } catch (error) {
      if (!dispatched && error instanceof DOMException && error.name === "AbortError") {
        setState("REVALIDATION_REQUIRED");
      } else {
        setRecovery(dispatched ? exact : null);
        setState(dispatched ? "SUBMITTED_OR_UNKNOWN" : "REVALIDATION_REQUIRED");
      }
    } finally {
      preflightController.current = null;
    }
  }

  async function resolveSameAttempt() {
    if (!recovery || capability.length < 32 || state === "ADMITTING") return;
    const token = capability;
    setState("ADMITTING");
    setCapability("");
    try {
      const parsed = await postFormation({
        action: "RESOLVE",
        build_request_identity: recovery.buildRequestIdentity,
        attempt_identity: recovery.attemptIdentity,
        research_request_identity: researchRequestIdentity,
        identity_mode: "EXACT",
      }, recovery, token);
      setResult(parsed);
      if (!parsed || parsed.availability === "unavailable"
        || parsed.resolution === "SUBMITTED_OR_UNKNOWN" || parsed.resolution === "OUTCOME_UNKNOWN") {
        setState("SUBMITTED_OR_UNKNOWN");
      } else {
        setState("TERMINAL");
      }
    } catch {
      setState("SUBMITTED_OR_UNKNOWN");
    }
  }

  const needsResolve = state === "SUBMITTED_OR_UNKNOWN";
  const pending = state === "PREFLIGHTING" || state === "ADMITTING";
  const title = needsResolve ? "Resolve same attempt"
    : state === "TERMINAL" ? "Artifact outcome"
      : "Check & Run";

  return (
    <ActionAdmissionGate
      title={title}
      state={state}
      message={messageFor(state, result)}
      capability={capability}
      onCapabilityChange={setCapability}
      showCapability={state === "IDLE" || needsResolve || pending}
      capabilityDisabled={pending}
      actions={<>
        {state === "PREFLIGHTING" ? <FilterButton
          density="compact"
          variant="secondary"
          type="button"
          onClick={() => preflightController.current?.abort()}
        >Cancel</FilterButton> : null}
        {needsResolve ? <FilterButton
          density="compact"
          variant="secondary"
          type="button"
          disabled={capability.length < 32 || pending}
          onClick={() => void resolveSameAttempt()}
        ><InterfaceIcons.refresh aria-hidden="true" size={13} /> Resolve</FilterButton> : null}
        {!needsResolve && state !== "TERMINAL" ? <FilterButton
          density="compact"
          variant="primary"
          type="button"
          disabled={capability.length < 32 || pending || state === "REVALIDATION_REQUIRED"}
          onClick={() => void checkAndRun()}
        ><EvidenceIcons.run aria-hidden="true" size={13} />
          {state === "PREFLIGHTING" ? "Checking…" : state === "ADMITTING" ? "Submitting…" : "Check & Run"}
        </FilterButton> : null}
        {recovery && state === "TERMINAL" ? <FilterLink density="compact" variant="secondary"
          href={`/rd/artifacts/${encodeURIComponent(recovery.buildRequestIdentity)}/attempts/${encodeURIComponent(recovery.attemptIdentity)}`}
        >Open Artifact</FilterLink> : null}
        {result?.runIdentity ? <FilterLink density="compact" variant="ghost"
          href={`/operations/runs/${encodeURIComponent(result.runIdentity)}`}>
          Open run
        </FilterLink> : null}
      </>}
    />
  );
}
