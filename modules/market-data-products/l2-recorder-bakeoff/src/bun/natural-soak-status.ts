export type NaturalSoakObservedStatus =
  "starting" | "active" | "stale" | "completed" | "failed";

export function deriveNaturalSoakStatus(input: {
  evidenceExists: boolean;
  evidenceVerdict?: string;
  supervisorAlive: boolean;
  terminalStatus?: "completed" | "failed";
  observedAtMs: number;
  startedAtMs: number;
  latestDataModifiedAtMs?: number;
  staleAfterMs: number;
}): { status: NaturalSoakObservedStatus; freshness_ms?: number } {
  if (input.evidenceExists)
    return { status: input.evidenceVerdict === "failed" ? "failed" : "completed" };
  if (input.terminalStatus != null) return { status: input.terminalStatus };
  if (!input.supervisorAlive) return { status: "failed" };
  const latestActivity = input.latestDataModifiedAtMs ?? input.startedAtMs;
  const freshness = Math.max(0, Math.floor(input.observedAtMs - latestActivity));
  if (input.latestDataModifiedAtMs == null && freshness <= input.staleAfterMs) {
    return { status: "starting", freshness_ms: freshness };
  }
  return {
    status: freshness <= input.staleAfterMs ? "active" : "stale",
    freshness_ms: freshness,
  };
}
