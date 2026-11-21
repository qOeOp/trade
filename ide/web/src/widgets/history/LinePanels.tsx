import type { HistoryLine } from "../../lib/historyApi";
import { pickedWay, validationAsk } from "../../model/history";
import { agentPane, chatControl, useAgentService } from "../../state/agent";
import { useAtom } from "../../state/atom";
import { openSource } from "../../state/editors";
import { activeRun, startDialog, starting, usePaperRuns, usePaperService } from "../../state/paper";
import { useSelection } from "../../state/selection";
import { useShown } from "../../state/shown";
import { showRunsPage, showToolWindow } from "../../state/shell";
import { ProseBlocks } from "../../ui/Prose";
import { Section } from "../../ui/Section";
import { TextButton } from "../../ui/TextButton";

/** The replay Details shows, as the History page marks its cell: its version and trial. */
export type Picked = { version: string | null; trial: number | null };

/** The replay Details shows when its version is a participant on this page: the backtest's trial (the version's last
 *  research run when the one picked cannot be drawn), else none. */
export function usePicked(lines: readonly HistoryLine[]): Picked {
  const version = useSelection(), { trial } = useShown();
  const participant = version !== null && lines.some((l) => l.rows.some((r) => r.candidate === version));
  return participant ? { version, trial: trial?.trial_id ?? null } : { version: null, trial: null };
}

/** A closed line's closing summary (`line list --all`), folded under its header: the strip's width, sticking left as it does,
 *  its paragraphs and lists as written, scrolling within a bounded height. */
export function LineSummary({ text, colSpan }: { text: string; colSpan: number }) {
  return (
    <tr className="bg-island-alt">
      <td colSpan={colSpan} className="sticky left-0 px-0 pb-1.5">
        <div className="sticky left-0 max-w-[min(calc(100vw-6rem),72rem)] px-2">
          <Section title="Closing summary" open={false}>
            <div className="max-h-96 overflow-auto pr-2 text-dense"><ProseBlocks text={text} /></div>
          </Section>
        </div>
      </td>
    </tr>
  );
}

/** The picked replay's way on from the page's header: its version's source, the Runs page and Run paper… (the start
 *  ⌘K and the graph's ▶ ask with, while the page reaches a paper daemon and the version has no run on paper); and,
 *  when its row's verdict meets the targets and the page has an Agent, Validate…, which opens a new chat holding the
 *  ask for the user to send: registering a validation is the Agent's (Details and the breadcrumb already name it). */
export function PickedBar({ lines, picked }: { lines: readonly HistoryLine[]; picked: Picked }) {
  const paper = usePaperService() === "present", listing = usePaperRuns(), agent = useAgentService() === "present";
  const way = pickedWay(lines, picked), pending = useAtom(starting).has(way?.version ?? "");
  if (!way) return null;
  const { line, version } = way;
  const validate = () => {
    agentPane.set("chat");
    showToolWindow("agent", "right");
    void chatControl.get()?.draft(validationAsk(line, version));
  };
  return (
    <span className="flex shrink-0 items-center gap-1">
      <TextButton aria-label={`Source of ${version}`} onClick={() => openSource(version)}>Source</TextButton>
      <TextButton aria-label={`Runs of ${version}`} onClick={showRunsPage}>Runs</TextButton>
      {paper && !activeRun(listing, version) &&
        <TextButton aria-label={`Run ${version} on paper`} disabled={pending} onClick={() => startDialog.set(version)}>{pending ? "Starting paper…" : "Run paper…"}</TextButton>}
      {way.validate && agent && <TextButton aria-label={`Validate ${version} out of sample`} onClick={validate}>Validate…</TextButton>}
    </span>
  );
}
