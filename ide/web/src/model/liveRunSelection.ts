import type { LiveRun } from "./liveTrading";

/** A retained user choice wins. Otherwise choose this version's most recently observed lifecycle. */
export function shownLiveRun(runs: readonly LiveRun[], version: string | null, chosen?: string): LiveRun | null {
  const selected = runs.find((run) => run.id === chosen && (version === null || run.candidate === version));
  if (selected) return selected;
  if (version === null) return null;
  const observed = (run: LiveRun) => Number(run.evidence.find((item) => item.source === "lifecycle")?.observedNs ?? 0);
  return runs.filter((run) => run.candidate === version).reduce<LiveRun | null>((latest, run) =>
    !latest || observed(run) > observed(latest) ? run : latest, null);
}
