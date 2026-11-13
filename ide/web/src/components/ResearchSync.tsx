import { useEffect, useState } from "react";
import { MISSING, shortSha, when } from "../lib/format";
import { placeOf } from "../model/about";
import { useAtom } from "../state/atom";
import { readResearchSync, researchSync, syncError, type ResearchSyncMove } from "../state/researchSync";
import { columns, DataTable } from "./DataTable";
import { DropdownItem } from "./Dropdown";
import { StatusPopover, StatusTable } from "./StatusPopover";
import { Retype } from "./Typing";

type Status = ReturnType<typeof researchSync.get>;
/** Why the last sync failed, from the page's own request or the sync's state; null when it did not. */
const failureOf = (status: Status, error: string | null) => error ?? status?.error?.message ?? null;

/** Whether this IDE follows research from DoltHub: its server says so in the page. */
const researchSyncEnabled = () => !!document.querySelector('meta[name="trade-research-sync"]');

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
  const failure = failureOf(status, error);
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
        className={`max-w-[30rem] ${failure ? "text-fail-fg" : busy || on ? "text-fg-muted" : ""}`} />
    </DropdownItem>
  );
}

const Commit = ({ sha }: { sha: string | null }) => sha ? <span title={sha}>{shortSha(sha)}</span> : <>{MISSING}</>;

const col = columns<ResearchSyncMove>();
const MOVES = [
  col.accessor("at", { header: "Synced", cell: (c) => when(c.getValue()) }),
  col.accessor("previous_commit", { header: "From", enableSorting: false, cell: (c) => <Commit sha={c.getValue()} /> }),
  col.accessor("ledger_commit", { header: "To", enableSorting: false, cell: (c) => <Commit sha={c.getValue()} /> }),
];

/** The sync's state in one line: its failure when it failed. */
const syncText = (status: Status, failure: string | null) => failure ?? (status?.state === "syncing" ? "Fetching research from DoltHub…"
  : status?.state === "ready" ? status.changed ? "DoltHub research updated" : "Research is up to date" : "DoltHub research");

/** The phone's Research tab line for the research mirror's sync (CF-31): the same state as the status bar's, the
 *  commit it is at and when it last moved, read only (the phone starts no sync). Polls as the desktop's widget does;
 *  nothing without a mirror. */
export function ResearchSyncLine() {
  const sync = useResearchSync(), status = useAtom(researchSync), error = useAtom(syncError);
  if (!sync || (!status && !error)) return null;
  const { failure } = sync, text = syncText(status, failure), last = status?.history?.[0]?.at;
  return (
    <p role="status" className={`flex flex-wrap justify-between gap-x-3 border-b border-line px-3 py-1.5 text-small ${failure ? "text-fail-fg" : "text-fg-muted"}`}>
      <span>{text}</span>
      <span className="tabular-nums text-fg-faint">{status?.ledger_commit && <Commit sha={status.ledger_commit} />}{last && ` · ${when(last)}`}</span>
    </p>
  );
}

/** The status bar's item for the research mirror's sync: its state in one line; clicking it lists the latest
 *  moves of the mirror's research head, when each was synced and from which commit to which. */
export function ResearchSyncStatus() {
  const status = useAtom(researchSync), error = useAtom(syncError);
  if (!status && !error) return null;
  const failure = failureOf(status, error), text = syncText(status, failure);
  const moves = status?.history ?? [], place = status?.origin ? placeOf(status.origin) : null;
  return (
    <StatusPopover label={`${text}. Show the latest research syncs`} onOpen={() => void readResearchSync()}
      className={`max-w-72 truncate ${failure ? "text-fail-fg" : "text-fg-muted"}`} trigger={text}>
      <div className="flex flex-col gap-0.5 px-2 pt-1 pb-2 text-fg-muted">
        {place && <p>From {place.name}{status?.ledger_commit && <> · at <Commit sha={status.ledger_commit} /></>}</p>}
        {failure && <p className="text-fail-fg">{failure}</p>}
      </div>
      {moves.length ? <StatusTable><DataTable data={moves} columns={MOVES} rowId={(m) => `${m.at}/${m.ledger_commit}`} sticky={false} /></StatusTable>
        : <p className="px-2 pb-1 text-fg-muted">No sync recorded</p>}
    </StatusPopover>
  );
}
