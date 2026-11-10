import { useNow } from "../../components/hooks/useNow";
import { RunRow } from "../../components/RunRow";
import { Section } from "../../components/Section";
import { chainOf } from "../../model/chain";
import { rowShows } from "../../model/paperHistory";
import { usePaperRuns, usePaperService } from "../../state/paper";
import { showRunsPage } from "../../state/shell";
import { useShown } from "../../state/shown";
import { chooseRun } from "../../state/stage";
import { runOrder } from "../paper/RunPicker";

const SHOWN = 8;  // rows before the rest are only counted

/** The paper runs trading any of `symbols`, in the run picker's order (running first, a strategy by its
 *  run that stands for it); one opens on the Runs page. Nothing without a daemon or without such a run. */
export function MarketRuns({ symbols }: { symbols: readonly string[] }) {
  const service = usePaperService(), listing = usePaperRuns(), { run: front } = useShown(), now = useNow();
  if (service !== "present" || !listing) return null;
  const wanted = new Set(symbols);
  const runs = runOrder(listing.runs, now).filter((r) => r.symbols.some((s) => wanted.has(s)));
  if (!runs.length) return null;
  const rest = runs.length - SHOWN;
  return (
    <Section title="Paper runs" aside={`${runs.length}`}>
      <div role="listbox" aria-label="Paper runs" className="-mx-3 flex flex-col gap-px">
        {runs.slice(0, SHOWN).map((r) => (
          <RunRow key={r.paper_id} run={r} chain={chainOf(r, listing.runs)} on={rowShows(r, front, listing.runs)} now={now}
                  onPick={() => { showRunsPage(); chooseRun(r); }} />
        ))}
      </div>
      {rest > 0 && <p className="pt-1 text-fg-faint">{rest} more in the run picker</p>}
    </Section>
  );
}
