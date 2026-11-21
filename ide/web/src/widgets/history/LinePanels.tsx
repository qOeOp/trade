import type { HistoryLine } from "../../lib/historyApi";
import { openSource } from "../../state/editors";
import { useSelection } from "../../state/selection";
import { useShown } from "../../state/shown";
import { showRunsPage } from "../../state/shell";
import { ProseBlocks } from "../../components/Prose";
import { Section } from "../../components/Section";
import { TextButton } from "../../components/TextButton";

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
          <Section title="Closing summary" open={false} aside={`${Math.round(new Blob([text]).size / 1024)} KB`}>
            <div className="max-h-96 overflow-auto pr-2 text-dense"><ProseBlocks text={text} /></div>
          </Section>
        </div>
      </td>
    </tr>
  );
}

/** The replay picked from a cell, named in the page's header with its source and the Runs page to go on to. */
export function PickedBar({ picked }: { picked: Picked }) {
  if (!picked.version || picked.trial === null) return null;
  const version = picked.version;
  return (
    <span className="flex shrink-0 items-center gap-1 text-fg-muted">
      <span className="max-w-40 truncate font-mono">{version}</span><span className="whitespace-nowrap">· trial {picked.trial}</span>
      <TextButton onClick={() => openSource(version)}>Source</TextButton>
      <TextButton onClick={showRunsPage}>Runs</TextButton>
    </span>
  );
}
