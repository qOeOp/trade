export type NaturalSoakObservedStatus =
  "starting" | "active" | "stale" | "completed";

export function deriveNaturalSoakStatus(input: {
  evidenceExists: boolean;
  observedAtMs: number;
  startedAtMs: number;
  latestDataModifiedAtMs?: number;
  staleAfterMs: number;
}): { status: NaturalSoakObservedStatus; freshness_ms?: number } {
  if (input.evidenceExists) return { status: "completed" };
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
