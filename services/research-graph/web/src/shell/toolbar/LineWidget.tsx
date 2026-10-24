import { useView } from "../../model/view";
import { shortSha } from "../../lib/format";
import { copyText } from "../../lib/clipboard";
import { requestFocus } from "../../state/linking";
import { Dropdown, DropdownFacts, DropdownItem, DropdownSeparator } from "../../components/Dropdown";

/** The research line, as IntelliJ's project widget: its name, and in the menu what defines it. */
export function LineWidget() {
  const { line, scope } = useView();
  return (
    <Dropdown label="研究线" trigger={<span className="truncate font-mono font-semibold">{line.bundle.replace(/^research-line-/, "")}</span>}>
      <DropdownFacts items={[
        ["研究线", line.bundle],
        ["起点", line.start ?? "-"],
        ["开发窗口", line.window?.join(" → ") ?? "-"],
        ["市场提交", shortSha(line.market_commit)],
        ["研究范围起", scope?.start ?? "全部"],
      ]} />
      <DropdownSeparator />
      <DropdownItem icon="copy" onSelect={() => void copyText(line.bundle)}>复制研究线名</DropdownItem>
      <DropdownItem onSelect={() => requestFocus("")} hint="Home">回到横轴起点</DropdownItem>
    </Dropdown>
  );
}
