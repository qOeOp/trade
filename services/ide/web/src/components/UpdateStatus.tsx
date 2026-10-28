import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons/Icon";
import { useUpdate, type Update } from "../state/update";
import { Tip } from "./Tip";

// Loading states follow the design spec: shown after 200ms, then kept at least 400ms, so a quick
// update never flickers. A failure shows at once and stays until a refresh succeeds.
const DELAY_MS = 200;
const MIN_MS = 400;
const STAGE = { pulling: "pulling market data", queued: "waiting to draw", computing: "drawing the graph" } as const;
const short = (commit: string | null) => commit?.slice(0, 8) ?? "the new head";

/** The status bar's background task, as IntelliJ's: a turning ring (a still clock under reduced motion)
 *  and the stage of the update to a newer ledger head while the graph on screen stays; a failed refresh
 *  marked by its icon in the failure colour, its text as quiet as the rest of the bar. */
export function UpdateStatus() {
  const wanted = useUpdate();
  const [seen, setSeen] = useState<Update | null>(null);
  const since = useRef(0);
  useEffect(() => {
    const now = performance.now();
    if (wanted && !seen) {
      const wait = wanted.stage === "failed" ? 0 : DELAY_MS;
      const t = window.setTimeout(() => { since.current = performance.now(); setSeen(wanted); }, wait);
      return () => window.clearTimeout(t);
    }
    if (wanted) { setSeen(wanted); return; }
    if (seen) {
      const t = window.setTimeout(() => setSeen(null), Math.max(0, since.current + MIN_MS - now));
      return () => window.clearTimeout(t);
    }
  }, [wanted, seen]);
  if (!seen) return null;
  if (seen.stage === "failed") {
    return (
      <Tip content={<>{seen.error?.message ?? "The refresh failed."}<br />The graph still shows {short(seen.shown)}.</>} side="top">
        <span role="status" className="flex min-w-0 items-center gap-1.5 text-fg-muted">
          <Icon name="warning" size={12} tone="fail" />
          <span className="truncate">Update failed · {seen.error?.code ?? "ERROR"}</span>
        </span>
      </Tip>
    );
  }
  return (
    <Tip content={`The graph shows ${short(seen.shown)} until ${short(seen.commit)} is drawn.`} side="top">
      <span role="status" className="flex min-w-0 items-center gap-1.5 text-fg-muted">
        <Icon name="loading" size={12} className="motion-safe:animate-spin motion-reduce:hidden" />
        <Icon name="history" size={12} className="motion-safe:hidden" />
        <span className="truncate">Updating to {short(seen.commit)} · {STAGE[seen.stage]}</span>
      </span>
    </Tip>
  );
}
