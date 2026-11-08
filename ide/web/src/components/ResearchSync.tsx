import { useEffect, useState } from "react";
import { useAtom } from "../state/atom";
import { readResearchSync, researchSync, syncError } from "../state/researchSync";
import { DropdownItem } from "./Dropdown";
import { Retype } from "./Typing";

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

/** ⟳ Sync DoltHub in the ledger widget's menu, one line as the menu's other items: fetches research from
 *  DoltHub now. Highlighted, its name types over into what it does (or why the last sync failed). */
export function ResearchSyncItem({ failure, busy }: { failure: string | null; busy: boolean }) {
  const [on, highlight] = useState(false);
  const name = busy ? "Syncing DoltHub…" : failure ? "Retry DoltHub sync" : "Sync DoltHub";
  const what = busy ? name : failure ?? "Update research from DoltHub. Running Paper inputs stay fixed.";
  return (
    <DropdownItem icon="sync" name={name} description={what === name ? undefined : what} onHighlight={highlight}
      onSelect={() => { if (!busy) void readResearchSync(true); }}>
      <Retype text={on ? what : name} holds={what.length > name.length ? what : name}
        className={`max-w-[30rem] ${failure ? "text-fail" : busy || on ? "text-fg-muted" : ""}`} />
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
