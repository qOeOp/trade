import type { ArtifactHistoricalReadbackProjectionV1 } from "./artifact-readback-gateway.ts";

export type ArtifactJourneyStageV1 = Readonly<{
  id: "attempt" | "outcome" | "artifact";
  label: "Attempt" | "Owner outcome" | "Artifact";
  detail: string;
  state: "complete" | "pending" | "warning" | "blocked";
}>;

export type ArtifactJourneyV1 = Readonly<{
  summary: string;
  stages: readonly ArtifactJourneyStageV1[];
}>;

export function projectArtifactJourneyV1(
  projection: ArtifactHistoricalReadbackProjectionV1,
): ArtifactJourneyV1 | null {
  if (projection.availability !== "available" || !projection.outcome) return null;

  const disposition = projection.outcome.historicalDisposition;
  const unknown = disposition === "unknown";
  return {
    summary: unknown
      ? "Artifact outcome needs same-attempt review"
      : disposition === "rejected"
        ? "Build request was rejected with no write"
        : "Build ended without an Artifact",
    stages: [
      { id: "attempt", label: "Attempt", detail: "Exact identity", state: "complete" },
      {
        id: "outcome",
        label: "Owner outcome",
        detail: unknown ? "Outcome unknown" : disposition === "rejected" ? "Rejected" : "Failed",
        state: unknown ? "warning" : "blocked",
      },
      {
        id: "artifact",
        label: "Artifact",
        detail: unknown ? "Not verified" : "Not created",
        state: "pending",
      },
    ],
  };
}
