import { useView } from "../../model/view";
import { shortSha } from "../../lib/format";
import { copyText } from "../../lib/clipboard";
import { Icon } from "../../icons/Icon";
import { Dropdown, DropdownFacts, DropdownItem, DropdownSeparator } from "../../components/Dropdown";

/** Where the graph was read, as IntelliJ's branch widget: the ledger commit it was read at. */
export function LedgerWidget() {
  const { source, scope } = useView();
  const commit = scope?.ledger_commit ?? null;
  return (
    <Dropdown label="账本提交" trigger={<span className="inline-flex items-center gap-1.5 text-fg-muted"><Icon name="ledger" />
      <span className="font-mono">{shortSha(commit)}</span></span>}>
      <DropdownFacts items={[["来源", source === "ledger" ? "研究账本" : "会话"], ["账本提交", commit ?? "-"]]} />
      {commit && <><DropdownSeparator /><DropdownItem icon="copy" onSelect={() => void copyText(commit)}>复制账本提交</DropdownItem></>}
    </Dropdown>
  );
}
