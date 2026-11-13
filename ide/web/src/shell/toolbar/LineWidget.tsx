import type { SummaryWidget } from "../../model/types";
import { useView, useWidget } from "../../model/view";
import { marketDay } from "../../lib/format";
import { copyText } from "../../lib/clipboard";
import { Dropdown, DropdownFacts, DropdownItem, DropdownLabel, DropdownSeparator } from "../../components/Dropdown";
import { ResearchLines } from "./ResearchLines";
import { useResearchLines } from "../../state/researchLines";
import { useAtom } from "../../state/atom";
import { viewStatus } from "../../state/update";
import { Icon } from "../../icons/Icon";

// The gates `research state` reads before the line's next registration, in words; the message keeps the detail.
const GATES: Record<string, string> = { INTERPRETATION_REQUIRED: "Runs await interpretation", REVIEW_DUE: "Recommendation review due" };

/** The research line, as IntelliJ's project widget: its name, and in the menu first the gates its next
 *  registration meets (a dot on the name while any holds) and the direction research takes next, then the
 *  lines to switch to and what defines this one. */
export function LineWidget() {
  const { line, scope } = useView();
  const priority = useWidget<SummaryWidget>("summary")?.priority;
  const index = useResearchLines(), day = marketDay(line.market_day), gates = line.gates ?? [];
  const status = useAtom(viewStatus);
  // Before its first graph comes, the line the address names shows as on its way, not as no line.
  const asked = new URLSearchParams(window.location.search).get("line");
  if (!line.bundle && asked && status.busy) return (
    <Dropdown label="Research line" trigger={<>
      <span className="truncate font-mono font-semibold text-fg-muted">{asked}</span>
      <Icon name="loading" size={12} className="shrink-0 text-icon motion-safe:animate-spin" />
    </>}>
      <DropdownLabel>{status.text}</DropdownLabel>
      <DropdownSeparator />
      <ResearchLines index={index} />
    </Dropdown>
  );
  if (!line.bundle) return <Dropdown label="Research line" trigger={<span className="text-fg-muted">No line</span>}><ResearchLines index={index} /></Dropdown>;
  return (
    <Dropdown label="Research line" trigger={<>
      <span className="truncate font-mono font-semibold">{line.bundle}</span>
      {gates.length > 0 && <i role="img" aria-label={`${gates.length} ${gates.length === 1 ? "gate" : "gates"} before the next registration`} className="size-1.5 shrink-0 rounded-full bg-misses" />}
    </>}>
      {gates.length > 0 && <>
        <DropdownLabel>Before the next registration · {gates.length}</DropdownLabel>
        {/* As wide as the menu the line list sets, never wider; text lines up with the items' after their icon column. */}
        <ul className="flex w-0 min-w-full flex-col gap-1 px-2 pb-1.5">
          {gates.map((g) => (
            <li key={g.code} className="flex gap-2">
              <span className="grid h-[1lh] w-4 shrink-0 place-items-center"><i className="size-1.5 rounded-full bg-misses" /></span>
              <span className="min-w-0"><span className="text-fg">{GATES[g.code] ?? g.code}</span>
                <span className="block wrap-anywhere text-small text-fg-muted">{g.message}</span></span>
            </li>
          ))}
        </ul>
        <DropdownSeparator />
      </>}
      {priority && <>
        <DropdownLabel>Next direction{priority.at && ` · ${priority.at.slice(0, 10)}`}</DropdownLabel>
        <div className="flex w-0 min-w-full gap-2 px-2 pb-1.5">
          <span className="w-4 shrink-0" />
          <p title={priority.text} className="line-clamp-3 min-w-0 text-fg-muted">{priority.text}</p>
        </div>
        <DropdownSeparator />
      </>}
      <ResearchLines index={index} />
      <DropdownSeparator />
      <DropdownFacts items={[
        ["Research line", line.bundle],
        ["Start", line.start ?? "-"],
        ["Development window", line.window?.join(" → ") ?? "-"],
        day ? ["Market data through", `${day} UTC`] : ["Market day", line.market_day ?? "-"],
        ["Scope from", scope?.start ?? "All"],
      ]} />
      <DropdownSeparator />
      <DropdownItem icon="copy" onSelect={() => void copyText(line.bundle)}>Copy line name</DropdownItem>
    </Dropdown>
  );
}
