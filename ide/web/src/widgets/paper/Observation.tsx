import { useTimeZone } from "../../state/timeZone";
import type { PaperRun } from "../../lib/paperApi";
import { observedThrough, utcMinute, waitingText, waitingUntil, LAG_MS } from "../../model/observation";
import { useNow } from "../../components/hooks/useNow";
import type { Stream } from "../../state/paperStream";

/** Current runner state and the cutoff of the data drawn, always visible beside historical charts:
 *  above them, or split (`part`) into its short facts ending a row and its sentences above. */
export function Observation({ run, s, part }: { run: PaperRun; s: Stream; part?: "facts" | "sentences" }) {
  const zone = useTimeZone();
  const now = useNow(), until = waitingUntil(run, s.lines), through = observedThrough(s.bars, s.closes);
  const stale = through !== null && now - through > LAG_MS;
  const restarted = s.lines.some((l) => l.kind === "restart");
  const facts = part !== "sentences", sentences = part !== "facts";
  if (!sentences && through === null && (s.connected || s.seal)) return null;
  if (!facts && !run.recovery && until === null && !restarted) return null;
  return <div role="status" className={`flex shrink-0 flex-wrap gap-x-3 gap-y-1 text-small tabular-nums ${sentences ? "mx-3 mb-2" : ""}`}>
    {sentences && run.recovery && <span className="text-fail">Recovery paused. The original account and records are retained.</span>}
    {sentences && until !== null && <span className="text-misses-fg">{waitingText(until, now, zone)}</span>}
    {facts && through !== null && <span className={stale ? "text-misses-fg" : "text-fg-muted"}>{stale || run.state === "sealed" ? "Historical data" : "Data"} through {utcMinute(through, zone)}</span>}
    {facts && !s.connected && !s.seal && <span className="text-misses-fg">Stream disconnected</span>}
    {sentences && restarted && <span className="text-fg-muted">Run {run.paper_id} starts with a fresh account; earlier positions were not carried forward</span>}
  </div>;
}
