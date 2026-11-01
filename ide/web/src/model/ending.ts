// How a sealed paper run ended, in plain words. A run is running or stopped; how it stopped is read from its
// seal (ledger/paper.py readings): its stop reason, reasons, runner exit code and bars. Only the daemon's
// current verdict, the listing's top-level `status` (not seal.status, which keeps what it was sealed with),
// makes a run Invalid: its evidence is untrusted. Every other run ended one of the ways below, however its
// seal was graded then. A chain (chain.ts) is paused while the user's own stop (or the run's set duration)
// holds it, and offline after a crash, a failed start or a Docker or host restart.
import type { PaperRun, Seal } from "../lib/paperApi";

export type EndKind = "invalid" | "out-of-memory" | "refused" | "unstarted" | "stopped" | "finished" | "interrupted" | "crashed" | "ended";
export type Gap = "paused" | "offline";
/** `word`: the run's state in a word or two, `detail` what it says no more of (why it is invalid, the
 *  refusal) and `text` both; `exceptions`: the strategy raised. The gap its chain had after it: `gap`, what
 *  happened at the stop, after the gap's own word on a chart (`lead`), how the next run took over (`resumed`)
 *  and the Events line there, given the gap's length (`again`). */
export type Ending = {
  kind: EndKind; word: string; detail: string | null; text: string; exceptions: boolean;
  gap: Gap; lead: string; resumed: string; again: (span: string) => string;
};

const KILLED_EXIT = 137;  // 128 + SIGKILL: a Docker or host restart when not at the memory limit
const RESTART = new Set(["SIGTERM", "KILLED", "SIGINT"]);
const UNTRUSTED: [string, string][] = [["SOURCE_MISMATCH", "ran other code"], ["EGRESS_DENIED", "tried to reach a blocked host"], ["JOURNAL_MISSING", "no journal"]];

/** How `run` ended: its top-level `status` and its seal. */
export function ending(run: { status: PaperRun["status"]; seal?: Seal | null }): Ending {
  const seal = run.seal, reasons = seal?.reasons ?? [], has = (r: string) => reasons.includes(r);
  const exceptions = has("RUNTIME_FAILURES"), stop = seal?.stop_reason ?? "";
  const offline = (kind: EndKind, word: string, detail: string | null = null, lead?: string): Ending => {
    const text = detail ? `${word}: ${detail}` : word, at = lead ?? text;
    return { kind, word, detail, text, exceptions, gap: "offline", lead: at, resumed: "restarted", again: (span) => `${at}, started again after ${span} offline` };
  };
  const paused = (kind: EndKind, word: string, lead: string, again: (span: string) => string): Ending =>
    ({ kind, word, detail: null, text: word, exceptions, gap: "paused", lead, resumed: "continued", again });
  if (run.status === "invalid") return offline("invalid", "Invalid", UNTRUSTED.filter(([r]) => has(r)).map(([, w]) => w).join(", ") || reasons.join(", "));
  if (has("OUT_OF_MEMORY")) return offline("out-of-memory", "Out of memory");
  const refused = reasons.filter((r) => r.startsWith("REFUSED:")).map((r) => r.slice(8)).join(", ");
  if (refused) return offline("refused", "Refused", refused);
  const bars = seal?.bars ?? (has("STOPPED_BEFORE_START") ? 0 : null);
  if (has("START_FAILED") || (bars === 0 && stop !== "STOP_FILE")) return offline("unstarted", "Didn't start");
  if (stop === "STOP_FILE") return paused("stopped", "Stopped", "by you", (span) => `Continued after you paused it for ${span}`);
  if (stop === "DURATION") return paused("finished", "Finished", "at its set duration", (span) => `Continued ${span} after its set duration`);
  if (RESTART.has(stop) || seal?.runner_exit_code === KILLED_EXIT) return offline("interrupted", "Interrupted", null, "Docker or host restart");
  if (reasons.some((r) => /^(RUNNER_EXIT_|SUMMARY_MISSING|STOPPED:)/.test(r))) return offline("crashed", "Crashed");
  return offline("ended", "Ended");
}

/** Whether a sealed run has a return to show: it ran on data and its seal has a final equity. */
export const hasReturn = (seal: Seal | null | undefined) => seal?.final_equity_usdt != null && seal.bars !== 0;
