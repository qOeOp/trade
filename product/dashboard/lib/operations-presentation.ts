export type PresentationTone = "neutral" | "info" | "success" | "warning" | "danger" | "unavailable";

export type RunPresentationInput = {
  state: string;
  started_at: string | null;
  duration_ms: number | null;
  terminal_code: string | null;
  owner_outcome_state: string;
};

export function summarizeRunsForPresentation(runs: readonly RunPresentationInput[]) {
  return {
    active: runs.filter(({ state }) => state === "queued" || state === "running").length,
    failed: runs.filter(({ state }) => state === "failed").length,
    ownerAvailable: runs.filter(({ owner_outcome_state }) => owner_outcome_state === "available").length,
    ownerPending: runs.filter(({ owner_outcome_state }) => owner_outcome_state === "unknown").length,
  };
}

export function runTerminalPresentation(run: RunPresentationInput): {
  duration: string;
  durationTone: PresentationTone;
  terminalState: string;
  terminalTone: PresentationTone;
} {
  if (run.state === "cancelled" && run.started_at === null) {
    return {
      duration: "Not started",
      durationTone: "neutral",
      terminalState: run.terminal_code ?? "Cancelled",
      terminalTone: "neutral",
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
    terminalState: run.terminal_code ?? "In progress",
    terminalTone: run.terminal_code ? "neutral" : "info",
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
