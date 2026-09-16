import type { ArtifactHistoricalReadbackProjectionV1 } from "./artifact-readback-gateway.ts";

export type ArtifactJourneyStageV1 = Readonly<{
  id: "attempt" | "outcome" | "artifact";
  label: "Attempt" | "Result" | "Artifact";
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
      ? "Build result needs review"
      : disposition === "rejected"
        ? "Build request was not accepted"
        : "Build did not produce an artifact",
    stages: [
      { id: "attempt", label: "Attempt", detail: "Recorded", state: "complete" },
      {
        id: "outcome",
        label: "Result",
        detail: unknown ? "Needs review" : disposition === "rejected" ? "Not accepted" : "Failed",
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
