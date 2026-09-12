"use client";

import { useEffect, useState, type ChangeEvent } from "react";

import {
  validSourceResearchOperationRequestV1,
  type SourceResearchOperationRequestV1,
  type SourceResearchResolveRequestV1,
  type SourceResearchRunRequestV1,
} from "../lib/source-research-input-contract";
import {
  parseSourceResearchActionEnvelopeV1,
  type SourceResearchActionEnvelopeV1,
} from "../lib/source-research-action-contract";
import { ActionAdmissionGate } from "./ui/action-admission-gate";
import { DetailInspector, DetailInspectorBody, DetailInspectorHeader } from "./ui/detail-inspector";
import { FactGroup, FactGroupGrid, FactItem } from "./ui/fact-group";
import { FilterButton, FilterLink } from "./ui/filter-toolbar";
import { FormField } from "./ui/form-field";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { Input } from "./ui/input";
import { PanelFrame, PanelFrameBody, PanelFrameHeader } from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import { Textarea } from "./ui/textarea";
import styles from "./source-research-control.module.css";

type State = "IDLE" | "SUBMITTING" | "REVALIDATION_REQUIRED" | "SUBMITTED_OR_UNKNOWN" | "TERMINAL";

type Draft = {
  sourceRequestIdentity: string;
  researchRequestIdentity: string;
  normalizedDoi: string;
  boundedExplanation: string;
  plausibleAlternatives: string;
  differentiatingPrediction: string;
  sourceFalsifier: string;
  hypothesis: string;
  mechanism: string;
  falsificationQuestion: string;
  expectedObservation: string;
  requiredData: string;
  costAssumption: string;
  capacityAssumption: string;
  trialBudget: string;
  stopRule: string;
  pitRuleIdentity: string;
  costModelIdentity: string;
  slippageModelIdentity: string;
  capacityModelIdentity: string;
  independenceRationale: string;
};

const initialDraft: Draft = {
  sourceRequestIdentity: "",
  researchRequestIdentity: "",
  normalizedDoi: "",
  boundedExplanation: "",
  plausibleAlternatives: "",
  differentiatingPrediction: "",
  sourceFalsifier: "",
  hypothesis: "",
  mechanism: "",
  falsificationQuestion: "",
  expectedObservation: "",
  requiredData: "",
  costAssumption: "",
  capacityAssumption: "",
  trialBudget: "1",
  stopRule: "",
  pitRuleIdentity: "",
  costModelIdentity: "",
  slippageModelIdentity: "",
  capacityModelIdentity: "",
  independenceRationale: "",
};

function compareUtf8(left: string, right: string): number {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function lines(value: string, canonical = false) {
  const parsed = value.split("\n").map((entry) => entry.trim()).filter(Boolean);
  return canonical ? [...new Set(parsed)].sort(compareUtf8) : parsed;
}

function requestFor(draft: Draft): SourceResearchRunRequestV1 {
  return {
    action: "RUN",
    source: {
      request_identity: draft.sourceRequestIdentity,
      normalized_doi: draft.normalizedDoi.trim().toLowerCase(),
      interpretation: {
        bounded_explanation: draft.boundedExplanation.trim(),
        plausible_alternatives: lines(draft.plausibleAlternatives, true),
        differentiating_prediction: draft.differentiatingPrediction.trim(),
        falsifier: draft.sourceFalsifier.trim(),
      },
    },
    research: {
      request_identity: draft.researchRequestIdentity,
      goal: {
        hypothesis: draft.hypothesis.trim(),
        mechanism: draft.mechanism.trim(),
        falsification_question: draft.falsificationQuestion.trim(),
        expected_observation: draft.expectedObservation.trim(),
        required_data: lines(draft.requiredData),
        cost_assumption: draft.costAssumption.trim(),
        capacity_assumption: draft.capacityAssumption.trim(),
      },
      trial_family_proposal: {
        trial_budget: Number(draft.trialBudget),
        stop_rule: draft.stopRule.trim(),
        pit_rule_identity: draft.pitRuleIdentity.trim(),
        cost_model_identity: draft.costModelIdentity.trim(),
        slippage_model_identity: draft.slippageModelIdentity.trim(),
        capacity_model_identity: draft.capacityModelIdentity.trim(),
        independence_rationale: draft.independenceRationale.trim(),
      },
    },
  };
}

function recoveryFor(request: SourceResearchOperationRequestV1): SourceResearchResolveRequestV1 {
  return request.action === "RUN" ? {
    action: "RESOLVE",
    source_request_identity: request.source.request_identity,
    research_request_identity: request.research.request_identity,
  } : request;
}

function recoveryForDraft(draft: Draft): SourceResearchResolveRequestV1 {
  return {
    action: "RESOLVE",
    source_request_identity: draft.sourceRequestIdentity.trim(),
    research_request_identity: draft.researchRequestIdentity.trim(),
  };
}

function messageFor(state: State, result: SourceResearchActionEnvelopeV1 | null) {
  if (state === "SUBMITTING") return "Submitting one ordered Source Intake and Research request";
  if (state === "SUBMITTED_OR_UNKNOWN") return "Delivery uncertain · resolve these exact identities only";
  if (state === "REVALIDATION_REQUIRED") return result?.unavailable_reason ?? "Review the request and current admission";
  if (state === "TERMINAL") return result?.research?.resolution === "ACCEPTED"
    ? "Research goal accepted" : "Request rejected without changes";
  return "Complete the proposal, then submit once";
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function SourceResearchControl() {
  const [draft, setDraft] = useState(initialDraft);
  const [state, setState] = useState<State>("IDLE");
  const [capability, setCapability] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [locked, setLocked] = useState<SourceResearchOperationRequestV1 | null>(null);
  const [result, setResult] = useState<SourceResearchActionEnvelopeV1 | null>(null);

  useEffect(() => {
    setDraft((current) => current.sourceRequestIdentity ? current : {
      ...current,
      sourceRequestIdentity: id("dashboard-source-request-v1"),
      researchRequestIdentity: id("dashboard-research-request-v2"),
    });
  }, []);

  const busy = state === "SUBMITTING";
  const frozen = Boolean(locked) || busy || state === "TERMINAL" || state === "SUBMITTED_OR_UNKNOWN";

  function update(key: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setValidation(null);
  }

  async function post(request: SourceResearchOperationRequestV1, token: string) {
    const response = await fetch("/api/rd/source-research", {
      method: "POST",
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const recovery = recoveryFor(request);
    return parseSourceResearchActionEnvelopeV1(
      await response.json(),
      recovery.source_request_identity,
      recovery.research_request_identity,
    );
  }

  async function submit() {
    const request = requestFor(draft);
    if (!validSourceResearchOperationRequestV1(request)) {
      setValidation("Complete every field with a valid DOI, 1-64 trial budget, and one item per line where requested.");
      return;
    }
    if (capability.length < 32 || busy) return;
    const token = capability;
    setLocked(request);
    setCapability("");
    setResult(null);
    setState("SUBMITTING");
    try {
      const parsed = await post(request, token);
      setResult(parsed);
      if (!parsed) {
        setState("SUBMITTED_OR_UNKNOWN");
      } else if (parsed.availability === "available") {
        setState("TERMINAL");
      } else if (parsed.operational_run.run_identity) {
        setState("SUBMITTED_OR_UNKNOWN");
      } else {
        setLocked(null);
        setState("REVALIDATION_REQUIRED");
      }
    } catch {
      setState("SUBMITTED_OR_UNKNOWN");
    }
  }

  async function resolveExisting() {
    const request = locked ? recoveryFor(locked) : recoveryForDraft(draft);
    if (!validSourceResearchOperationRequestV1(request)
      || capability.length < 32 || busy) return;
    const token = capability;
    setLocked(request);
    setResult(null);
    setCapability("");
    setState("SUBMITTING");
    try {
      const parsed = await post(request, token);
      setResult(parsed);
      if (!parsed) {
        setState("SUBMITTED_OR_UNKNOWN");
      } else if (parsed.availability === "available") {
        setState("TERMINAL");
      } else if (parsed.operational_run.run_identity) {
        setState("SUBMITTED_OR_UNKNOWN");
      } else {
        setLocked(null);
        setState("REVALIDATION_REQUIRED");
      }
    } catch {
      setState("SUBMITTED_OR_UNKNOWN");
    }
  }

  const field = (key: keyof Draft, label: string, options: {
    area?: boolean; wide?: boolean; type?: string; min?: number; max?: number; hint?: string;
  } = {}) => {
    const fieldId = `source-research-${key}`;
    const common = {
      id: fieldId,
      disabled: frozen,
      value: draft[key],
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(key, event.target.value),
    };
    return <FormField label={label} htmlFor={fieldId} wide={options.wide} hint={options.hint}>
      {options.area
        ? <Textarea {...common} className={styles.textarea} />
        : <Input {...common} variant="surface" type={options.type} min={options.min} max={options.max} />}
    </FormField>;
  };

  const accepted = state === "TERMINAL" && result?.availability === "available";
  const needsResolve = state === "SUBMITTED_OR_UNKNOWN";

  return (
    <PanelFrame className={styles.panel} aria-labelledby="source-research-title">
      <PanelFrameHeader
        eyebrow="Sourced research"
        title="New sourced research"
        titleId="source-research-title"
        description="Submit one source, then its bound Research Goal V2."
        actions={<FilterLink href="/rd" density="compact" variant="secondary">
          <InterfaceIcons.previous aria-hidden="true" size={13} /> Open readback
        </FilterLink>}
      />
      <PanelFrameBody className={styles.body}>
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className={styles.identityRail}>
            {field("sourceRequestIdentity", "Source request identity")}
            {field("researchRequestIdentity", "Research request identity")}
          </div>
          <div className={styles.sections}>
            <DetailInspector as="section" className={styles.section}>
              <DetailInspectorHeader eyebrow="01" title="Source evidence" />
              <DetailInspectorBody className={styles.sectionBody}>
                {field("normalizedDoi", "Normalized DOI", { wide: true, hint: "For example: 10.5555/example" })}
                {field("boundedExplanation", "Bounded explanation", { area: true, wide: true })}
                {field("plausibleAlternatives", "Plausible alternatives", { area: true, hint: "One per line" })}
                {field("differentiatingPrediction", "Differentiating prediction", { area: true })}
                {field("sourceFalsifier", "Source falsifier", { area: true, wide: true })}
              </DetailInspectorBody>
            </DetailInspector>
            <DetailInspector as="section" className={styles.section}>
              <DetailInspectorHeader eyebrow="02" title="Falsifiable goal" />
              <DetailInspectorBody className={styles.sectionBody}>
                {field("hypothesis", "Hypothesis", { area: true })}
                {field("mechanism", "Mechanism", { area: true })}
                {field("falsificationQuestion", "Falsification question", { area: true })}
                {field("expectedObservation", "Expected observation", { area: true })}
                {field("requiredData", "Required data", { area: true, hint: "One dataset per line" })}
                {field("costAssumption", "Cost assumption", { area: true })}
                {field("capacityAssumption", "Capacity assumption", { area: true, wide: true })}
              </DetailInspectorBody>
            </DetailInspector>
            <DetailInspector as="section" className={`${styles.section} ${styles.policy}`}>
              <DetailInspectorHeader eyebrow="03" title="Trial family policy" />
              <DetailInspectorBody className={`${styles.sectionBody} ${styles.policyBody}`}>
                {field("trialBudget", "Trial budget", { type: "number", min: 1, max: 64 })}
                {field("pitRuleIdentity", "PIT rule identity")}
                {field("costModelIdentity", "Cost model identity")}
                {field("slippageModelIdentity", "Slippage model identity")}
                {field("capacityModelIdentity", "Capacity model identity")}
                {field("stopRule", "Precommitted stop rule", { area: true })}
                {field("independenceRationale", "Independence rationale", { area: true, wide: true })}
              </DetailInspectorBody>
            </DetailInspector>
          </div>
          {validation ? <p className={styles.validation} role="alert">{validation}</p> : null}
          <ActionAdmissionGate
            eyebrow="Source → Research"
            ariaLabel="Source to Research action"
            title={needsResolve ? "Resolve exact request" : accepted ? "Owner outcome" : "Submit once"}
            state={state}
            message={messageFor(state, result)}
            capability={capability}
            onCapabilityChange={setCapability}
            showCapability={!accepted}
            capabilityDisabled={busy}
            actions={<>
              {needsResolve ? <FilterButton density="compact" variant="secondary" type="button"
                disabled={capability.length < 32 || busy} onClick={() => void resolveExisting()}>
                <InterfaceIcons.refresh aria-hidden="true" size={13} /> Resolve
              </FilterButton> : null}
              {!needsResolve && !accepted ? <FilterButton density="compact" variant="secondary" type="button"
                disabled={capability.length < 32 || busy
                  || !validSourceResearchOperationRequestV1(recoveryForDraft(draft))}
                onClick={() => void resolveExisting()}>
                <InterfaceIcons.refresh aria-hidden="true" size={13} /> Recover existing
              </FilterButton> : null}
              {!needsResolve && !accepted ? <FilterButton density="compact" variant="primary" type="submit"
                disabled={capability.length < 32 || busy || frozen}>
                <EvidenceIcons.run aria-hidden="true" size={13} />
                {busy ? "Submitting…" : state === "REVALIDATION_REQUIRED" ? "Revalidate & submit" : "Submit once"}
              </FilterButton> : null}
              {result?.research?.resolution === "ACCEPTED" ? <FilterLink density="compact" variant="secondary"
                href={`/rd/research/${encodeURIComponent(result.research.request_identity)}`}>
                Open Research
              </FilterLink> : null}
              {result?.operational_run.run_identity ? <FilterLink density="compact" variant="ghost"
                href={`/operations/runs/${encodeURIComponent(result.operational_run.run_identity)}`}>
                Open run
              </FilterLink> : null}
            </>}
          />
        </form>
        {accepted && result?.source && result.research ? <FactGroupGrid>
          <FactGroup title="Source">
            <FactItem label="Request" mono>{result.source.request_identity}</FactItem>
            <FactItem label="Resolution"><StatusBadge tone="success">retrieved</StatusBadge></FactItem>
            <FactItem label="Receipt" mono>{result.source.receipt_identity}</FactItem>
          </FactGroup>
          <FactGroup title="Research">
            <FactItem label="Request" mono>{result.research.request_identity}</FactItem>
            <FactItem label="Resolution"><StatusBadge tone={result.research.resolution === "ACCEPTED" ? "success" : "danger"}>{result.research.resolution.toLowerCase()}</StatusBadge></FactItem>
            <FactItem label="Next action">{result.research.next_legal_action.toLowerCase().replaceAll("_", " ")}</FactItem>
          </FactGroup>
          <FactGroup title="Run">
            <FactItem label="Identity" mono>{result.operational_run.run_identity}</FactItem>
            <FactItem label="State">{result.operational_run.state}</FactItem>
            <FactItem label="Owner outcome">{result.operational_run.owner_outcome_state}</FactItem>
          </FactGroup>
        </FactGroupGrid> : null}
      </PanelFrameBody>
    </PanelFrame>
  );
}
