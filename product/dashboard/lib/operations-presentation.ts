export type PresentationTone = "neutral" | "info" | "success" | "warning" | "danger" | "unavailable";

const runStateLabels = {
  queued: "Waiting",
  running: "Running",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "Unknown",
} as const;

const sourceResultLabels = {
  available: "Available",
  rejected: "Not accepted",
  unknown: "Pending",
  unavailable: "Unavailable",
  not_applicable: "Not applicable",
} as const;

const triggerLabels = {
  dashboard_bff: "Dashboard",
  dashboard_api: "API",
  dashboard_scheduler: "Schedule",
} as const;

const runKindLabels = {
  owner_read: "Data read",
  owner_effect: "Action",
} as const;

const workerAvailabilityLabels = {
  available: "Ready",
  expired: "Offline",
} as const;

const workerRoleLabels = {
  shadow_read: "Data reader",
  owner_effect: "Action runner",
} as const;

export type RunPresentationInput = {
  state: keyof typeof runStateLabels;
  started_at: string | null;
  duration_ms: number | null;
  terminal_code: string | null;
  owner_outcome_state: keyof typeof sourceResultLabels;
};

export function runStateLabel(state: keyof typeof runStateLabels): string {
  return runStateLabels[state];
}

export function sourceResultLabel(state: keyof typeof sourceResultLabels): string {
  return sourceResultLabels[state];
}

export function runTriggerLabel(trigger: keyof typeof triggerLabels): string {
  return triggerLabels[trigger];
}

export function runKindLabel(kind: keyof typeof runKindLabels): string {
  return runKindLabels[kind];
}

export function workerAvailabilityLabel(state: keyof typeof workerAvailabilityLabels): string {
  return workerAvailabilityLabels[state];
}

export function workerRoleLabel(kind: keyof typeof workerRoleLabels): string {
  return workerRoleLabels[kind];
}

export function workerAssignmentPresentation(
  availability: "available" | "unavailable" | "not_applicable",
  unavailableReason: string | null,
): { title: string; detail: string } {
  if (availability === "available") {
    return { title: "Worker assigned", detail: "A current worker record is linked to this run." };
  }
  if (availability === "not_applicable") {
    return { title: "Handled directly", detail: "This run does not require a background worker." };
  }
  if (unavailableReason === "RUN_DISPATCH_BINDING_UNAVAILABLE") {
    return {
      title: "Assignment not recorded",
      detail: "This historical run has no matching current worker assignment record.",
    };
  }
  return {
    title: "Assignment unavailable",
    detail: "The current worker assignment could not be verified.",
  };
}

export function summarizeRunsForPresentation(runs: readonly RunPresentationInput[]) {
  return {
    active: runs.filter(({ state }) => state === "queued" || state === "running").length,
    failed: runs.filter(({ state }) => state === "failed").length,
    ownerAvailable: runs.filter(({ owner_outcome_state }) => owner_outcome_state === "available").length,
    ownerPending: runs.filter(({ owner_outcome_state }) => owner_outcome_state === "unknown").length,
  };
}

export function runDurationPresentation(run: RunPresentationInput): {
  duration: string;
  durationTone: PresentationTone;
} {
  if (run.state === "cancelled" && run.started_at === null) {
    return {
      duration: "Not started",
      durationTone: "neutral",
    };
  }

  const duration = run.duration_ms === null
    ? "In progress"
    : run.duration_ms < 1_000
      ? `${run.duration_ms} ms`
      : `${(run.duration_ms / 1_000).toFixed(2)} s`;
  return {
    duration,
    durationTone: run.duration_ms === null ? "info" : "neutral",
  };
}

export function emptyServiceLogPresentation({
  completeness,
  filtered,
}: {
  completeness: "complete" | "partial_unavailable";
  filtered: boolean;
}) {
  if (completeness === "partial_unavailable") {
    return {
      title: filtered ? "Some matching activity unavailable" : "Some activity unavailable",
      detail: "No verified service events are available for this view. Some sources could not be read.",
    };
  }
  return {
    title: filtered ? "No matching activity" : "No recent activity",
    detail: "No services reported events in the selected time range.",
  };
}
