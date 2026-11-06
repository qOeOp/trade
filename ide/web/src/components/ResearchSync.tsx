import { useEffect } from "react";
import { useAtom } from "../state/atom";
import { readResearchSync, researchSync, syncError } from "../state/researchSync";

export function ResearchSync() {
  const status = useAtom(researchSync);
  const error = useAtom(syncError);
  const enabled = !!document.querySelector('meta[name="trade-research-sync"]');
  useEffect(() => {
    if (!enabled) return;
    let closed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await readResearchSync();
      if (!closed) timer = setTimeout(() => void poll(), researchSync.get()?.state === "syncing" ? 1000 : 15000);
    };
    void poll();
    return () => { closed = true; clearTimeout(timer); };
  }, [enabled, status?.state === "syncing"]);
  if (!enabled) return null;
  const failure = error ?? status?.error?.message;
  const busy = status?.state === "syncing" && !failure;
  return <button type="button" disabled={busy} aria-busy={busy} onClick={() => void readResearchSync(true)}
    title={failure ?? `Update research from DoltHub. Running Paper inputs stay fixed.\n${status?.origin ?? ""}`}
    className={`h-(--frame-control) shrink-0 rounded-control px-2 text-small hover:bg-hover disabled:opacity-60 ${failure ? "text-fail" : "text-fg-muted"}`}>
    {busy ? "Syncing DoltHub…" : failure ? "Retry DoltHub sync" : "Sync DoltHub"}
  </button>;
}

export function ResearchSyncStatus() {
  const status = useAtom(researchSync), error = useAtom(syncError);
  if (!status && !error) return null;
  const failure = error ?? status?.error?.message;
  const text = failure ?? (status?.state === "syncing" ? "Fetching research from DoltHub…"
    : status?.state === "ready" ? status.changed ? "DoltHub research updated" : "Research is up to date" : "DoltHub research");
  return <span role="status" title={failure ?? status?.ledger_commit}
    className={`max-w-72 truncate ${failure ? "text-fail" : "text-fg-muted"}`}>{text}</span>;
}
