import type { ResearchReadbackProjectionV1 } from "./research-readback-gateway.ts";

export type ResearchJourneyStageV1 = Readonly<{
  id: "request" | "intent" | "artifact";
  label: "Request" | "Strategy" | "Artifact";
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
    summary: "Waiting for a research result",
    stages: [
      { id: "request", label: "Request", detail: "In review", state: "current" },
      { id: "intent", label: "Strategy", detail: "Not available yet", state: "pending" },
      { id: "artifact", label: "Artifact", detail: "Not available yet", state: "pending" },
    ],
  };
  if (outcome.resolution === "rejected") return {
    summary: "Research request was not accepted",
    stages: [
      { id: "request", label: "Request", detail: "Not accepted", state: "blocked" },
      { id: "intent", label: "Strategy", detail: "Not created", state: "pending" },
      { id: "artifact", label: "Artifact", detail: "Not created", state: "pending" },
    ],
  };
  if (outcome.resolution === "quarantined") return {
    summary: "Saved result needs a current review",
    stages: [
      { id: "request", label: "Request", detail: "Result recorded", state: "warning" },
      { id: "intent", label: "Strategy", detail: "Not available", state: "pending" },
      { id: "artifact", label: "Artifact", detail: "Not available", state: "pending" },
    ],
  };
  if (projection.view?.availability === "stale") return {
    summary: "Update this request before continuing",
    stages: [
      { id: "request", label: "Request", detail: "Accepted", state: "complete" },
      { id: "intent", label: "Strategy", detail: "Update needed", state: "warning" },
      { id: "artifact", label: "Artifact", detail: "Waiting for a current view", state: "pending" },
    ],
  };
  if (projection.view?.phase === "artifact_available") return {
    summary: "Artifact is ready for review",
    stages: [
      { id: "request", label: "Request", detail: "Accepted", state: "complete" },
      { id: "intent", label: "Strategy", detail: "Ready", state: "complete" },
      { id: "artifact", label: "Artifact", detail: "Ready for review", state: "complete" },
    ],
  };
  return {
    summary: "Strategy is ready for build",
    stages: [
      { id: "request", label: "Request", detail: "Accepted", state: "complete" },
      { id: "intent", label: "Strategy", detail: "Ready", state: "complete" },
      { id: "artifact", label: "Artifact", detail: "Ready to build", state: "current" },
    ],
  };
}
