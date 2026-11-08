import { useView } from "../../model/view";
import { shortSha } from "../../lib/format";
import { copyText } from "../../lib/clipboard";
import { Icon } from "../../icons/Icon";
import { Dropdown, DropdownFacts, DropdownItem, DropdownSeparator } from "../../components/Dropdown";
import { ResearchSyncItem, useResearchSync } from "../../components/ResearchSync";

/** Where the graph was read, as IntelliJ's branch widget holds the branch's update: the ledger commit it
 *  was read at, and where this IDE follows DoltHub, the sync, its icon turning on the widget while it runs
 *  and in the failure colour after it failed. */
export function LedgerWidget() {
  const { source, scope, line } = useView();
  const sync = useResearchSync();
  const commit = scope?.ledger_commit ?? null;
  if (!line.bundle && !sync) return null;
  const icon = sync?.busy ? <Icon name="sync" className="motion-safe:animate-spin" /> : <Icon name="ledger" tone={sync?.failure ? "fail" : undefined} />;
  return (
    <Dropdown label="Ledger commit" trigger={<span className="inline-flex items-center gap-1.5 text-fg-muted">{icon}
      <span className="font-mono">{shortSha(commit)}</span></span>}>
      <DropdownFacts items={[["Source", source === "ledger" ? "Research ledger" : "Session"], ["Ledger commit", commit ?? "-"],
        ...(sync?.origin ? [["DoltHub", sync.origin] as const] : [])]} />
      {(commit || sync) && <DropdownSeparator />}
      {sync && <ResearchSyncItem failure={sync.failure} busy={sync.busy} />}
      {commit && <DropdownItem icon="copy" onSelect={() => void copyText(commit)}>Copy ledger commit</DropdownItem>}
    </Dropdown>
  );
}
