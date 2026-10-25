import { useView } from "../../model/view";
import { shortSha } from "../../lib/format";
import { copyText } from "../../lib/clipboard";
import { requestFocus } from "../../state/linking";
import { Dropdown, DropdownFacts, DropdownItem, DropdownSeparator } from "../../components/Dropdown";

/** The research line, as IntelliJ's project widget: its name, and in the menu what defines it. */
export function LineWidget() {
  const { line, scope } = useView();
  return (
    <Dropdown label="Research line" trigger={<span className="truncate font-mono font-semibold">{line.bundle.replace(/^research-line-/, "")}</span>}>
      <DropdownFacts items={[
        ["Research line", line.bundle],
        ["Start", line.start ?? "-"],
        ["Development window", line.window?.join(" → ") ?? "-"],
        ["Market commit", shortSha(line.market_commit)],
        ["Scope from", scope?.start ?? "All"],
      ]} />
      <DropdownSeparator />
      <DropdownItem icon="copy" onSelect={() => void copyText(line.bundle)}>Copy line name</DropdownItem>
      <DropdownItem onSelect={() => requestFocus("")} hint="Home">Back to the axis start</DropdownItem>
    </Dropdown>
  );
}
