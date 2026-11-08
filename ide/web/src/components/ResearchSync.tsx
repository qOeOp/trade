import { useEffect, useState } from "react";
import { Popover } from "radix-ui";
import { MISSING, shortSha, when } from "../lib/format";
import { placeOf } from "../model/about";
import { useAtom } from "../state/atom";
import { readResearchSync, researchSync, syncError, type ResearchSyncMove } from "../state/researchSync";
import { columns, DataTable } from "./DataTable";
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

const utc = (at: string) => `${when(at)} UTC`;
const Commit = ({ sha }: { sha: string | null }) => sha ? <span title={sha}>{shortSha(sha)}</span> : <>{MISSING}</>;

const col = columns<ResearchSyncMove>();
const MOVES = [
  col.accessor("at", { header: "Synced", cell: (c) => utc(c.getValue()) }),
  col.accessor("previous_commit", { header: "From", enableSorting: false, cell: (c) => <Commit sha={c.getValue()} /> }),
  col.accessor("ledger_commit", { header: "To", enableSorting: false, cell: (c) => <Commit sha={c.getValue()} /> }),
];

/** The status bar's item for the research mirror's sync: its state in one line; clicking it lists the latest
 *  moves of the mirror's research head, when each was synced and from which commit to which. */
export function ResearchSyncStatus() {
  const status = useAtom(researchSync), error = useAtom(syncError);
  if (!status && !error) return null;
  const failure = error ?? status?.error?.message;
  const text = failure ?? (status?.state === "syncing" ? "Fetching research from DoltHub…"
    : status?.state === "ready" ? status.changed ? "DoltHub research updated" : "Research is up to date" : "DoltHub research");
  const moves = status?.history ?? [], place = status?.origin ? placeOf(status.origin) : null;
  return (
    <Popover.Root onOpenChange={(open) => { if (open) void readResearchSync(); }}>
      <Popover.Trigger aria-label={`${text}. Show the latest research syncs`}
        className={`-mx-1.5 max-w-72 truncate rounded-control px-1.5 transition-colors hover:bg-hover active:bg-pressed data-[state=open]:bg-pressed ${failure ? "text-fail" : "text-fg-muted"}`}>
        {text}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="end" sideOffset={4} collisionPadding={8}
          className="z-50 max-h-[min(440px,var(--radix-popover-content-available-height))] w-max max-w-[min(720px,var(--radix-popover-content-available-width))] overflow-auto rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup outline-none">
          <div className="flex flex-col gap-0.5 px-2 pt-1 pb-2 text-fg-muted">
            {place && <p>From {place.name}{status?.ledger_commit && <> · at <Commit sha={status.ledger_commit} /></>}</p>}
            {failure && <p className="text-fail">{failure}</p>}
          </div>
          {moves.length ? (
            <div className="[&_tbody_tr:last-child_td]:border-b-0">
              <DataTable data={moves} columns={MOVES} rowId={(m) => `${m.at}/${m.ledger_commit}`} sticky={false} />
            </div>
          ) : <p className="px-2 pb-1 text-fg-muted">No sync recorded</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
