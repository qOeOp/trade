import type { ReactNode } from "react";
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
import { useLineState } from "../../state/lineState";

// The gates `research state` reads before the line's next registration, in words; the message keeps the detail.
const GATES: Record<string, string> = {
  INTERPRETATION_REQUIRED: "Runs await interpretation", REVIEW_DUE: "Recommendation review due",
  MARKET_DAY_UNRESOLVED: "Market day not in the market",
};
const trialList = (ids: number[]) => `${ids.length === 1 ? "trial" : "trials"} ${ids.join(", ")}`;

/** A row of the menu's lists: a dot in the items' icon column while it holds, its words and value, a muted line under. */
function Row({ held, label, value, detail, title, mark }: {
  held: boolean; label: string; value?: string; detail?: string; title?: string; mark?: ReactNode;
}) {
  return (
    <li className="flex gap-2" title={title}>
      <span className="grid h-[1lh] w-4 shrink-0 place-items-center">{mark ?? (held && <i className="size-1.5 rounded-full bg-misses" />)}</span>
      <span className="min-w-0 flex-1"><span className="flex gap-3"><span className="text-fg">{label}</span>
        {value && <span className={`ml-auto shrink-0 font-mono tabular-nums ${held ? "text-fg" : "text-fg-muted"}`}>{value}</span>}</span>
        {detail && <span className="block wrap-anywhere text-small text-fg-muted">{detail}</span>}</span>
    </li>
  );
}

/** What the line menu reads on opening (`research state`): every gate before the next registration, the graph's two
 *  until it answers, and how near the line is to a recommendation review and to a due change of approach. */
function LineState({ line, drawn }: { line: string; drawn: { code: string; message: string }[] }) {
  const read = useLineState(line);
  const state = read?.kind === "ready" ? read.state : null, gates = state?.gates ?? drawn;
  const every = state?.review_every, runs = state?.undistinguished_runs, unreviewed = state?.unreviewed_trials ?? [];
  return <>
    {gates.length > 0 && <>
      <DropdownLabel>Before the next registration · {gates.length}</DropdownLabel>
      {/* As wide as the menu the line list sets, never wider; text lines up with the items' after their icon column. */}
      <ul className="flex w-0 min-w-full flex-col gap-1 px-2 pb-1.5">
        {gates.map((g) => <Row key={g.code} held label={GATES[g.code] ?? g.code} detail={g.message} />)}
      </ul>
      <DropdownSeparator />
    </>}
    <DropdownLabel>Review{every ? ` · every ${every} runs` : ""}</DropdownLabel>
    <ul className="flex w-0 min-w-full flex-col gap-1 px-2 pb-1.5">
      {read?.kind === "reading" && <li className="flex gap-2 text-fg-muted">
        <span className="grid h-[1lh] w-4 shrink-0 place-items-center"><Icon name="loading" size={12} className="text-icon motion-safe:animate-spin" /></span>
        Comparing the latest runs…</li>}
      {read?.kind === "failed" && <Row held={false} mark={<Icon name="warning" size={12} className="text-misses" />}
        label="Could not read the review" detail={`${read.message} · reopen the menu to try again`} />}
      {state && every && <>
        {/* The REVIEW_DUE gate above already warns; this row then gives only the count. */}
        <Row held={unreviewed.length >= every && !gates.some((g) => g.code === "REVIEW_DUE")}
          label={unreviewed.length >= every ? "Review due" : "Runs since the last review"} value={`${unreviewed.length} of ${every}`}
          title="Research runs of the line's execution identity since its latest recommendation, or since it started."
          detail={unreviewed.length ? trialList(unreviewed) : undefined} />
        {runs && <Row held={runs.trials.length >= every}
          label={runs.trials.length >= every ? "Change of approach due" : "Undistinguished runs in a row"}
          value={`${runs.trials.length} of ${every}`}
          title="Every run counts here; the Agent leaves out scale-only runs and those a recorded change of approach answered."
          detail={[runs.trials.length ? trialList(runs.trials) : runs.distinguished !== null ? `trial ${runs.distinguished} told candidate and control apart` : "",
                   runs.uncompared.length ? `${runs.uncompared.length} ${runs.uncompared.length === 1 ? "run" : "runs"} without a comparison` : ""].filter(Boolean).join(" · ") || undefined} />}
      </>}
    </ul>
    <DropdownSeparator />
  </>;
}

/** The research line, as IntelliJ's project widget: its name, and in the menu first the gates its next
 *  registration meets (a dot on the name while any the graph knows holds), how near a review and a change of
 *  approach are, and the direction research takes next, then the lines to switch to and what defines this one. */
export function LineWidget() {
  const { line, scope } = useView();
  const priority = useWidget<SummaryWidget>("summary")?.priority;
  const index = useResearchLines(), day = marketDay(line.market_day), gates = line.gates ?? [];
  const status = useAtom(viewStatus);
  // Before its first graph comes, the line the address names shows as on its way, not as no line.
  const asked = new URLSearchParams(window.location.search).get("line");
  if (!line.name && asked && status.busy) return (
    <Dropdown label="Research line" trigger={<>
      <span className="truncate font-mono font-semibold text-fg-muted">{asked}</span>
      <Icon name="loading" size={12} className="shrink-0 text-icon motion-safe:animate-spin" />
    </>}>
      <DropdownLabel>{status.text}</DropdownLabel>
      <DropdownSeparator />
      <ResearchLines index={index} />
    </Dropdown>
  );
  if (!line.name) return <Dropdown label="Research line" trigger={<span className="text-fg-muted">No line</span>}><ResearchLines index={index} /></Dropdown>;
  return (
    <Dropdown label="Research line" trigger={<>
      <span className="truncate font-mono font-semibold">{line.name}</span>
      {gates.length > 0 && <i role="img" aria-label={`${gates.length} ${gates.length === 1 ? "gate" : "gates"} before the next registration`} className="size-1.5 shrink-0 rounded-full bg-misses" />}
    </>}>
      <LineState line={line.name} drawn={gates} />
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
        ["Research line", line.name],
        ["Start", line.start ?? "-"],
        ["Development window", line.window?.join(" → ") ?? "-"],
        day ? ["Market data through", `${day} UTC`] : ["Market day", line.market_day ?? "-"],
        ["Scope from", scope?.start ?? "All"],
      ]} />
      <DropdownSeparator />
      <DropdownItem icon="copy" onSelect={() => void copyText(line.name)}>Copy line name</DropdownItem>
    </Dropdown>
  );
}
