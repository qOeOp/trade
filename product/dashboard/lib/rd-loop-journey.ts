import type { RdFormationCatalogFamilyV1 } from "./rd-formation-catalog-client.ts";
import type { RdIterationTimelineProjectionV1 } from "./rd-iteration-timeline-client.ts";

export type RdLoopJourneyV1 = Readonly<{
  summary: string;
  stages: readonly Readonly<{
    id: string;
    label: string;
    detail: string;
    state: "complete" | "current" | "pending" | "warning" | "blocked";
  }>[];
}>;

export function projectRdLoopJourneyV1(
  family: RdFormationCatalogFamilyV1,
  timeline: RdIterationTimelineProjectionV1,
): RdLoopJourneyV1 | null {
  if (family.trialFamilyIdentity !== timeline.trialFamilyIdentity) return null;
  const hasArtifact = family.attemptHistory.length > 0;
  const hasDecision = timeline.decisions.length > 0;
  const terminal = timeline.state === "TERMINAL" || timeline.state === "READY_FOR_QUALIFICATION";
  const nextDetail = timeline.state === "REPAIR_REQUIRED" ? "Repair the verified input"
    : timeline.state === "SUCCESSOR_REQUIRED" ? "Author the next experiment"
      : timeline.state === "TERMINAL" ? "Family stopped by Owner policy"
        : timeline.state === "READY_FOR_QUALIFICATION" ? "Candidate ready for qualification"
          : "Waiting for a committed Decision";
  const summary = !hasArtifact ? "Intent is ready for Artifact formation"
    : !hasDecision ? "Artifact is ready; waiting for the first replay result"
      : nextDetail;
  return {
    summary,
    stages: [
      { id: "research", label: "Research", detail: "Intent frozen", state: "complete" },
      { id: "artifact", label: "Artifact", detail: hasArtifact ? "Verified build" : "Formation next",
        state: hasArtifact ? "complete" : "current" },
      { id: "explore", label: "Explore", detail: hasDecision ? "Result evaluated" : "Replay result pending",
        state: hasDecision ? "complete" : hasArtifact ? "current" : "pending" },
      { id: "decision", label: "Decide", detail: hasDecision ? `Round ${timeline.decisions.length}` : "No Decision yet",
        state: hasDecision ? (terminal ? "complete" : "current") : "pending" },
      { id: "next", label: "Next", detail: nextDetail,
        state: terminal ? "complete" : hasDecision ? "current" : "pending" },
    ],
  };
}
