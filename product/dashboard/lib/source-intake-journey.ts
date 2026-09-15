import type {
  SourceIntakeBrowserProjectionV1,
  SourceIntakeTerminalReadbackV1,
  SourceIntakeTerminalResolutionV1,
} from "./source-intake-readback-gateway.ts";

export type SourceIntakeJourneyStageV1 = Readonly<{
  id: "request" | "terminal" | "evidence";
  label: "Request" | "Owner result" | "Evidence";
  detail: string;
  state: "complete" | "current" | "pending" | "warning" | "blocked";
}>;

export type SourceIntakeJourneyV1 = Readonly<{
  summary: string;
  stages: readonly SourceIntakeJourneyStageV1[];
}>;

const RESOLUTION_COPY: Readonly<Record<SourceIntakeTerminalResolutionV1, string>> = {
  RETRIEVED: "Source evidence is sealed and ready",
  NOT_FOUND: "Source was not found",
  AUTH_REQUIRED: "Source requires authentication",
  ACCESS_DENIED: "Source access was denied",
  RATE_LIMITED: "Source is rate limited",
  TERMS_OR_LICENSE_BLOCKED: "Source terms or license blocked retrieval",
  MALFORMED: "Source content could not be accepted",
  UNAVAILABLE: "Source was unavailable at retrieval",
};

function negativeTone(resolution: SourceIntakeTerminalResolutionV1): "warning" | "blocked" {
  return resolution === "RATE_LIMITED" || resolution === "UNAVAILABLE" ? "warning" : "blocked";
}

function terminalJourney(terminal: SourceIntakeTerminalReadbackV1): SourceIntakeJourneyV1 {
  const retrieved = terminal.resolution === "RETRIEVED";
  return {
    summary: RESOLUTION_COPY[terminal.resolution],
    stages: [
      { id: "request", label: "Request", detail: "Exact identity", state: "complete" },
      {
        id: "terminal",
        label: "Owner result",
        detail: retrieved ? "Retrieved" : terminal.resolution.replaceAll("_", " ").toLowerCase(),
        state: retrieved ? "complete" : negativeTone(terminal.resolution),
      },
      {
        id: "evidence",
        label: "Evidence",
        detail: retrieved ? "Content retained" : "No content retained",
        state: retrieved ? "complete" : "pending",
      },
    ],
  };
}

export function projectSourceIntakeJourneyV1(
  projection: SourceIntakeBrowserProjectionV1,
): SourceIntakeJourneyV1 | null {
  if (projection.availability !== "available") return null;
  if (projection.state === "terminal" && projection.terminal) {
    return terminalJourney(projection.terminal);
  }
  if (projection.state === "no_verified_terminal") return {
    summary: "Waiting for a verified Owner result",
    stages: [
      { id: "request", label: "Request", detail: "Exact identity", state: "complete" },
      { id: "terminal", label: "Owner result", detail: "Not available yet", state: "current" },
      { id: "evidence", label: "Evidence", detail: "Not available yet", state: "pending" },
    ],
  };
  return null;
}
