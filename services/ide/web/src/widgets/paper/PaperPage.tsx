import { useEffect, useMemo } from "react";
import { symbolOf } from "../../lib/paperApi";
import { account, tradeStats } from "../../model/account";
import { fills as fillsOf } from "../../model/paper";
import type { LineageWidget } from "../../model/types";
import { useView, useWidget } from "../../model/view";
import { useAtom } from "../../state/atom";
import { paperTab, selectedRun, usePaperRuns } from "../../state/paper";
import { follow, pickedDay, useStream } from "../../state/paperStream";
import { followReconciliation } from "../../state/reconcile";
import { Calendar } from "./Calendar";
import { ChartCard } from "./ChartCard";
import { Performance } from "./Performance";
import { TradesCard } from "./TradesCard";

const Empty = ({ children }: { children: string }) => <p className="grid h-full place-items-center text-dense text-fg-faint">{children}</p>;

/** The Paper page, laid out on the frame as four cards in two columns that share their bottom row:
 *  the chart with the trades under it; at the right the run's performance against the line's targets,
 *  and its calendar beside the trades. The run is picked in the main toolbar. The chart picks
 *  what the rest follows: a contract, or Equity for all of them. Until the user picks, it opens on a
 *  contract holding a position, else on Equity. Short, the page scrolls. */
export function PaperPage() {
  const listing = usePaperRuns();
  const selected = useAtom(selectedRun);
  const tab = useAtom(paperTab);
  const view = useView();
  const lineage = useWidget<LineageWidget>("lineage@2");
  const run = listing?.runs.find((r) => r.paper_id === selected) ?? null;
  const shown = tab === "equity" || (tab && run?.symbols.includes(tab)) ? tab : "equity";
  useEffect(() => { follow(run?.paper_id ?? null, shown === "equity" ? null : shown); }, [run?.paper_id, shown]);
  useEffect(() => { pickedDay.set(null); }, [run?.paper_id]);
  useEffect(() => { followReconciliation(run?.state === "sealed" ? run.paper_id : null); }, [run?.paper_id, run?.state]);
  const stream = useStream();
  const s = stream && stream.paperId === run?.paper_id ? stream : null;
  // The first view of a run: the contract it holds, once its state says which.
  useEffect(() => {
    if (tab !== null || !s?.state) return;
    const held = s.seal ? undefined : s.state.positions[0];
    paperTab.set(held ? symbolOf(held.instrument_id) : "equity");
  }, [tab, !!s?.state]);
  // The account once the run's readings (or its seal) arrive: before them every figure would read as zero.
  const a = useMemo(() => (s && (s.readings || s.seal) ? account(s.lines, s.state, s.readings, s.seal) : null), [s?.lines, s?.state, s?.readings, s?.seal]);
  const stats = useMemo(() => (a && s ? tradeStats(a, s.lines) : null), [a]);
  const fills = useMemo(() => fillsOf(s?.lines ?? []), [s?.lines]);
  const t = view.targets ?? lineage?.targets ?? null;
  const targets = { limit: t?.max_drawdown ?? null, annual: t?.annual_return ?? null };

  if (!listing) return <Empty>Reading the paper runs…</Empty>;
  if (!listing.runs.length) return <Empty>No paper runs yet: hover a version in the graph and press ▶ to start one.</Empty>;
  if (!run) return <Empty>Pick a run</Empty>;
  const only = shown === "equity" ? null : shown;
  return (
    <div className="@container/page h-full overflow-auto p-(--half-gap)">
      <div className="grid h-full min-h-[812px] grid-cols-[minmax(0,1fr)_360px] grid-rows-[minmax(0,1fr)_280px] gap-2">
        <div className="col-start-1 row-start-1 grid min-h-0"><ChartCard run={run} view={shown} s={s} a={a} fills={fills} targets={targets} /></div>
        <aside className="col-start-2 row-span-2 row-start-1 grid min-h-0 grid-rows-subgrid">
          <div className="flex min-h-0 flex-col">
            {a && stats ? <Performance key={run.paper_id} a={a} stats={stats} targets={targets} /> : <section className="min-h-0 flex-1 rounded-island bg-island" />}
          </div>
          <Calendar s={s} a={a} />
        </aside>
        <div className="col-start-1 row-start-2 grid min-h-0"><TradesCard s={s} only={only} candidate={run.candidate} /></div>
      </div>
    </div>
  );
}
