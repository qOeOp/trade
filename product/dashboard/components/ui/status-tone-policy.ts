import type { StatusBadgeTone } from "./status-badge";

export function evidenceStateTone(state: string): StatusBadgeTone {
  if (state === "observed") return "info";
  if (state === "partial" || state === "stale") return "warning";
  return "unavailable";
}

export function ownerOutcomeTone(value: string): StatusBadgeTone {
  if (value === "available") return "info";
  if (value === "rejected") return "danger";
  if (value === "unknown" || value === "unavailable") return "warning";
  return "neutral";
}

export function auditOutcomeTone(value: string): StatusBadgeTone {
  if (value === "rejected") return "danger";
  if (value === "unavailable" || value === "unknown") return "unavailable";
  return "neutral";
}

export function severityTone(value: string): StatusBadgeTone {
  if (value === "error") return "danger";
  if (value === "warning") return "warning";
  return "neutral";
}

export function executionStateTone(state: string): StatusBadgeTone {
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "unknown") return "danger";
  if (state === "queued" || state === "running") return "info";
  return "unavailable";
}

export function backtestDiagnosticTone(value: string): StatusBadgeTone {
  if (value.startsWith("PASSED")) return "success";
  if (value === "NOT_RUN") return "unavailable";
  return "warning";
}

export function availabilityTone(value: string): StatusBadgeTone {
  if (value === "available") return "success";
  if (value === "stale" || value === "unknown") return "warning";
  return "unavailable";
}

export function lifecycleStateTone(value: string): StatusBadgeTone {
  if (value === "active" || value === "head") return "success";
  if (value === "deleted") return "danger";
  return "unavailable";
}

export function scheduleStateTone(value: string): StatusBadgeTone {
  return value === "due" ? "warning" : "success";
}

export function deploymentStateTone(value: string): StatusBadgeTone {
  return value === "available" ? "success" : "unavailable";
}

export function coverageDriftTone(value: string): StatusBadgeTone {
  if (value === "changed") return "warning";
  if (value === "unchanged") return "success";
  return "unavailable";
}

export function dispatcherTone(value: string): StatusBadgeTone {
  return value === "WINDMILL" ? "warning" : "neutral";
}

export function replacementReadinessTone(value: string): StatusBadgeTone {
  if (value === "READY_FOR_SEPARATE_AUTHORIZATION") return "success";
  if (value === "NOT_READY") return "warning";
  return "unavailable";
}

export function implementationBasisTone(value: string): StatusBadgeTone {
  if (value === "MATCHED") return "success";
  if (value === "DRIFTED" || value === "BLOCKED_BY_DEPENDENCY") return "warning";
  return "unavailable";
}

export function firstPartyAdapterTone(value: string): StatusBadgeTone {
  if (value === "IMPLEMENTED_SOURCE_BOUND") return "success";
  if (value === "BLOCKED_BY_COMPONENT") return "warning";
  return "unavailable";
}

export function progressStateTone(value: string): StatusBadgeTone {
  if (value === "current") return "info";
  if (value === "pending") return "unavailable";
  return "neutral";
}

export function actionStateTone(value: string): StatusBadgeTone {
  if (["PREFLIGHTING", "ADMITTING", "REVALIDATION_REQUIRED", "SUBMITTED_OR_UNKNOWN"].includes(value)) return "warning";
  if (value === "TERMINAL") return "info";
  if (value === "UNAVAILABLE") return "unavailable";
  return "neutral";
}

export function researchAvailabilityTone(value: string | null | undefined): StatusBadgeTone {
  if (value === "AVAILABLE") return "info";
  if (value === "STALE") return "warning";
  return "neutral";
}

export function decisionDispositionTone(value: string): StatusBadgeTone {
  return value === "TERMINAL_STOP" ? "info" : "warning";
}

export function optionalDecisionDispositionTone(value: string | null | undefined): StatusBadgeTone {
  return value ? decisionDispositionTone(value) : "unavailable";
}

export function presenceTone(present: boolean): StatusBadgeTone {
  return present ? "info" : "unavailable";
}

export function intakeStateTone(value: string): StatusBadgeTone {
  if (value === "available") return "info";
  if (value === "unavailable") return "warning";
  return "protected";
}

export function readFreshnessTone({
  current,
  stale = false,
  terminal = false,
}: {
  current: boolean;
  stale?: boolean;
  terminal?: boolean;
}): StatusBadgeTone {
  if (current) return "info";
  if (stale || terminal) return "warning";
  return "unavailable";
}

export function catalogCompletenessTone(value: string | null | undefined): StatusBadgeTone {
  if (value === "COMPLETE") return "info";
  if (value === "PARTIAL_UNAVAILABLE") return "warning";
  return "unavailable";
}

export function formationAttemptTone({
  resolution,
  researchAvailability,
}: {
  resolution?: string | null;
  researchAvailability?: string | null;
}): StatusBadgeTone {
  if (resolution === "SUCCESS" || researchAvailability === "AVAILABLE") return "info";
  if (resolution || researchAvailability === "STALE") return "warning";
  return "unavailable";
}

export function iterationProjectionTone({
  projected,
  selected,
}: {
  projected: boolean;
  selected: boolean;
}): StatusBadgeTone {
  if (projected) return "info";
  if (selected) return "warning";
  return "unavailable";
}

export function providerBindingTone({
  providerState,
  bindingIdentity,
}: {
  providerState?: string | null;
  bindingIdentity?: string | null;
}): StatusBadgeTone {
  if (providerState) return "warning";
  return presenceTone(Boolean(bindingIdentity));
}

export function readResultTone({
  available,
  failed,
}: {
  available: boolean;
  failed: boolean;
}): StatusBadgeTone {
  if (available) return "info";
  if (failed) return "warning";
  return "unavailable";
}
