import { useEffect } from "react";
import { useAtom } from "../state/atom";
import { readResearchSync, researchSync, syncError } from "../state/researchSync";
import { DropdownItem } from "./Dropdown";

/** Whether this IDE follows research from DoltHub: its server says so in the page. */
export const researchSyncEnabled = () => !!document.querySelector('meta[name="trade-research-sync"]');

/** The sync's state while this IDE follows DoltHub (null otherwise), polled while it is mounted: every
 *  15 s, every second while a sync runs. */
export function useResearchSync() {
  const status = useAtom(researchSync), error = useAtom(syncError), enabled = researchSyncEnabled();
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
  const failure = error ?? status?.error?.message ?? null;
  return { origin: status?.origin ?? null, failure, busy: status?.state === "syncing" && !failure };
}

/** ⟳ Sync DoltHub in the ledger widget's menu: fetches research from DoltHub now. */
export function ResearchSyncItem({ failure, busy }: { failure: string | null; busy: boolean }) {
  return (
    <DropdownItem icon="sync" onSelect={() => { if (!busy) void readResearchSync(true); }}>
      <span className={failure ? "text-fail" : busy ? "text-fg-muted" : ""}>{busy ? "Syncing DoltHub…" : failure ? "Retry DoltHub sync" : "Sync DoltHub"}</span>
      <span className="block whitespace-pre-line text-small text-fg-faint">{failure ?? "Update research from DoltHub. Running Paper inputs stay fixed."}</span>
    </DropdownItem>
  );
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
