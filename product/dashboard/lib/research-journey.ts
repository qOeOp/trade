import type { ResearchReadbackProjectionV1 } from "./research-readback-gateway.ts";

export type ResearchJourneyStageV1 = Readonly<{
  id: "request" | "intent" | "artifact";
  label: "Request" | "Intent" | "Artifact";
  detail: string;
  state: "complete" | "current" | "pending" | "warning" | "blocked";
}>;

export type ResearchJourneyV1 = Readonly<{
  summary: string;
  stages: readonly ResearchJourneyStageV1[];
}>;

export function projectResearchJourneyV1(projection: ResearchReadbackProjectionV1): ResearchJourneyV1 {
  const outcome = projection.outcome;
  if (!outcome) return {
    summary: "Waiting for the R&D Owner",
    stages: [
      { id: "request", label: "Request", detail: "Awaiting Owner outcome", state: "current" },
      { id: "intent", label: "Intent", detail: "Not available yet", state: "pending" },
      { id: "artifact", label: "Artifact", detail: "Not available yet", state: "pending" },
    ],
  };
  if (outcome.resolution === "rejected") return {
    summary: "Request rejected with no Research write",
    stages: [
      { id: "request", label: "Request", detail: "Rejected", state: "blocked" },
      { id: "intent", label: "Intent", detail: "Not created", state: "pending" },
      { id: "artifact", label: "Artifact", detail: "Not created", state: "pending" },
    ],
  };
  if (outcome.resolution === "quarantined") return {
    summary: "Historical custody needs same-identity review",
    stages: [
      { id: "request", label: "Request", detail: "Historical outcome", state: "warning" },
      { id: "intent", label: "Intent", detail: "Not promoted", state: "pending" },
      { id: "artifact", label: "Artifact", detail: "Not available", state: "pending" },
    ],
  };
  if (projection.view?.availability === "stale") return {
    summary: "Refresh the same request before continuing",
    stages: [
      { id: "request", label: "Request", detail: "Owner accepted", state: "complete" },
      { id: "intent", label: "Intent", detail: "Current view expired", state: "warning" },
      { id: "artifact", label: "Artifact", detail: "Waiting for a current view", state: "pending" },
    ],
  };
  if (projection.view?.phase === "artifact_available") return {
    summary: "Artifact is ready for review",
    stages: [
      { id: "request", label: "Request", detail: "Owner accepted", state: "complete" },
      { id: "intent", label: "Intent", detail: "Frozen", state: "complete" },
      { id: "artifact", label: "Artifact", detail: "Ready for review", state: "complete" },
    ],
  };
  return {
    summary: "Intent is frozen; Artifact formation is next",
    stages: [
      { id: "request", label: "Request", detail: "Owner accepted", state: "complete" },
      { id: "intent", label: "Intent", detail: "Frozen", state: "complete" },
      { id: "artifact", label: "Artifact", detail: "Ready to form", state: "current" },
    ],
  };
}
