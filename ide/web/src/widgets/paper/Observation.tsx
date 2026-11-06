import type { PaperRun } from "../../lib/paperApi";
import { observedThrough, utcMinute, waitingText, waitingUntil, LAG_MS } from "../../model/observation";
import { useNow } from "../../components/hooks/useNow";
import type { Stream } from "../../state/paperStream";

/** Current runner state and the cutoff of the data drawn, always visible beside historical charts. */
export function Observation({ run, s }: { run: PaperRun; s: Stream }) {
  const now = useNow(), until = waitingUntil(run, s.lines), through = observedThrough(s.bars, s.closes);
  const stale = through !== null && now - through > LAG_MS;
  const restarted = s.lines.some((l) => l.kind === "restart");
  return <div role="status" className="mx-3 mb-2 flex shrink-0 flex-wrap gap-x-3 gap-y-1 text-small tabular-nums">
    {run.recovery && <span className="text-fail">Recovery paused. The original account and records are retained.</span>}
    {until !== null && <span className="text-misses">{waitingText(until, now)}</span>}
    {through !== null && <span className={stale ? "text-misses" : "text-fg-muted"}>{stale || run.state === "sealed" ? "Historical data" : "Data"} through {utcMinute(through)}</span>}
    {!s.connected && !s.seal && <span className="text-misses">Stream disconnected</span>}
    {restarted && <span className="text-fg-muted">Run {run.paper_id} starts with a fresh account; earlier positions were not carried forward</span>}
  </div>;
}
