import { useEffect } from "react";
import { useAtom } from "../state/atom";
import { readResearchSync, researchSync, syncError } from "../state/researchSync";
import { ActionButton } from "./ActionGroup";

/** Whether this IDE follows research from DoltHub: its server says so in the page. */
export const researchSyncEnabled = () => !!document.querySelector('meta[name="trade-research-sync"]');

/** ⟳ Sync DoltHub, in the toolbar's action group: fetches research from DoltHub now, and polls it meanwhile. */
export function ResearchSync() {
  const status = useAtom(researchSync);
  const error = useAtom(syncError);
  const enabled = researchSyncEnabled();
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
  return <ActionButton icon="sync" spinning={busy} aria-busy={busy} onClick={() => { if (!busy) void readResearchSync(true); }}
    hint={<span className="whitespace-pre-line">{failure ?? `Update research from DoltHub. Running Paper inputs stay fixed.\n${status?.origin ?? ""}`}</span>}
    tone={failure ? "fail" : undefined} className={failure ? "text-fail" : busy ? "cursor-progress text-fg-muted" : "text-fg"}>
    {busy ? "Syncing DoltHub…" : failure ? "Retry DoltHub sync" : "Sync DoltHub"}
  </ActionButton>;
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
