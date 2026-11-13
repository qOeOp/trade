import type { LiveImageDto, LivePairedDto, LiveRunDto } from "../lib/liveTradingDto";
import type { LiveFact, LiveRun } from "./liveTrading";

const fact = (label: string, value: string | null): LiveFact => ({ label, value });

/** A build by the first 12 characters of its revision, else of its digest. */
export const build = (image: LiveImageDto | null | undefined) =>
  image?.build_revision?.slice(0, 12) ?? (image?.digest ? image.digest.replace("sha256:", "").slice(0, 12) : null);
// Whether the replay the run first armed on runs on the offered image's replay code (live/control.py _offered).
const EVIDENCE_TEXT: Record<string, string> = { found: "Passes", missing: "Missing", checking: "Checking", unknown: "Unknown" };

/** The paired replay of the latest compared day on the offered image beside that day's own comparison (live/daily.py
 *  pair_run): shown only, it never refuses a switch. */
function pairedText(run: LiveRunDto, paired: LivePairedDto | null): string | null {
  if (!paired) return run.compare?.state === "done" ? "Waiting for the next comparison pass" : "After the first daily comparison";
  const own = run.compare, decisions = paired.measures?.groups;
  switch (paired.state) {
    case "done": return `${paired.day} · ${paired.unexplained_week ?? 0}${decisions === undefined ? "" : ` of ${decisions}`} unexplained`
      + (own?.day === paired.day && own.unexplained_week !== undefined ? ` (current build ${own.unexplained_week})` : "");
    case "running": return `${paired.day} · replaying`;
    case "empty": return `${paired.day} · nothing traded`;
    default: return `${paired.day} · failed (${paired.code ?? "unknown"})`;
  }
}

/** The runtime image a running run could switch to, or the switch it waits for (design §3.8). */
export function runtimeOf(run: LiveRunDto): LiveRun["runtime"] {
  const facts = run.switch, offered = facts?.offered ?? null, pending = facts?.pending ?? null;
  if (!facts || (!offered && !pending) || run.host.state !== "running" || run.host.mode !== "run") return null;
  return {
    current: build(facts.current),
    offered: offered ? { build: build(offered), ready: offered.evidence !== "missing", facts: [
      fact("Build", build(offered)), { ...fact("Start replay on it", EVIDENCE_TEXT[offered.evidence] ?? offered.evidence), attention: offered.evidence === "missing" },
      fact("Paired replay", pairedText(run, offered.paired))] } : null,
    pending: pending ? { build: build(pending), sinceNs: pending.requested_ns } : null,
  };
}

/** How the latest runtime switch ended, when it did not complete (live/views.py _switch). */
export function lastSwitch(run: LiveRunDto): LiveFact | null {
  const last = run.switch?.events.at(-1);
  if (!last || last.event === "runtime_switch_requested") return null;
  const text = last.event === "runtime_switched" ? "Switched" : last.event === "runtime_switch_failed"
    ? `Failed (${last.code ?? "unknown"}), kept the previous image` : last.reason === "user" ? "Canceled" : "Canceled, the run ended";
  return { ...fact("Last switch", text), attention: last.event === "runtime_switch_failed" };
}
