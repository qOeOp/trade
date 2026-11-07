import { useEffect, useState } from "react";
import { PhoneBar, PhoneBarButton, PhonePage } from "../../components/PhoneBar";
import { Sheet } from "../../components/Sheet";
import { TextButton } from "../../components/TextButton";
import { useNow } from "../../components/hooks/useNow";
import { amount, fixed } from "../../lib/paperApi";
import { chainEquity, chainReturn } from "../../model/chain";
import { waitingUntil } from "../../model/observation";
import { pnlClass } from "../../theme/roles";
import { signedPct } from "../../components/RunTile";
import { useAtom } from "../../state/atom";
import { usePaperRuns, usePaperService } from "../../state/paper";
import { desktopLayout, useLandscape } from "../../state/phone";
import { useStream } from "../../state/paperStream";
import { useRunData } from "../../state/runData";
import { selection, useSelection } from "../../state/selection";
import { useShown, useTargets } from "../../state/shown";
import { choiceOf, choices, showRun } from "../../state/stage";
import { StageReadings } from "../../widgets/detail/Readings";
import { StagePerformance } from "../../widgets/detail/StagePerformance";
import { RunHealth, runOrder } from "../../widgets/paper/RunPicker";
import { RunMenuList } from "../../widgets/runs/RunMenuList";
import { LiveRuns } from "./LiveRuns";
import { RunsPage } from "../../widgets/paper/RunsPage";
import { TradesTools, TradesWindow } from "../../widgets/paper/TradesWindow";
import { StageSource } from "../StatusBar";

/** Keeps the tab on a run of its own: the one picked, else the first of the desktop's picker's order (a running
 *  one, the newest sealed one otherwise); a view arriving selects its version, which this undoes. */
function useTabRun() {
  const runs = usePaperRuns()?.runs ?? null, allChoices = useAtom(choices), picked = choiceOf(allChoices, null).run ?? null, selected = useSelection();
  const live = choiceOf(allChoices, selected).stage === "live";
  useEffect(() => {
    if (live || !runs?.length) return;
    const run = runs.find((r) => r.paper_id === picked) ?? runOrder(runs, Date.now())[0];
    if (run && (run.paper_id !== picked || selection.get() !== null)) showRun(run);
  }, [runs, picked, selected, live]);
}

/** The Runs tab, the phone's front page: the run in the bar, its equity at a glance as the toolbar reads it (whole
 *  part in the text colour, cents and unit faint), then the Runs page's own chart with its switches, then Details'
 *  cards and the Trades window, one under another. Turned sideways, the chart alone. */
export function RunsTab() {
  useTabRun();
  const service = usePaperService(), listing = usePaperRuns(), landscape = useLandscape(), now = useNow();
  const { run, chain, stage } = useShown(), data = useRunData(), { limit, annual } = useTargets(), stream = useStream();
  const [picking, setPicking] = useState(false);
  if (stage === "live") return <LiveRuns />;
  if (landscape) return <RunsPage />;
  const mine = data && data.run.paper_id === run?.paper_id ? data : null, all = listing?.runs ?? [], s = mine?.s ?? null;
  // The run's own stream, as the toolbar reads it: `s` is joined with the earlier runs of its chain.
  const own = run && stream?.paperId === run.paper_id ? stream : null;
  const [title = "", revision] = (run?.candidate ?? "").split("@");
  const [whole = "", cents = ""] = (run ? fixed(chainEquity(chain, amount(own?.seal?.final_equity_usdt ?? own?.readings?.final_equity_usdt ?? run.seal?.final_equity_usdt ?? run.live?.final_equity_usdt)), 2) ?? "" : "").split(".");
  const ret = run ? chainReturn(chain) : null, waiting = !!run && waitingUntil(run, s?.lines ?? []) !== null;
  return (
    <>
      <PhoneBar>
        <PhoneBarButton label={`Runs: ${all.length} paper runs`} onClick={() => setPicking(true)}>
          {run ? <span className="flex min-w-0 font-mono"><span className="truncate font-semibold">{title}</span><span className="shrink-0 text-fg-faint">@{revision}</span></span>
            : <span className="truncate text-fg-faint">{service === "absent" ? "Paper runs are not served" : "No paper run"}</span>}
        </PhoneBarButton>
      </PhoneBar>
      <PhonePage>
        {run && (
          <div className="px-3 pt-3">
            <StageSource className="block text-small leading-tight text-fg-faint" />
            {whole && (
              <p className="mt-1 whitespace-nowrap font-semibold tabular-nums leading-none tracking-tighter" style={{ fontSize: 34 }}>
                {whole}{cents && <span className="text-fg-faint">.{cents}</span>}<span className="ml-1.5 text-dense font-normal tracking-normal text-fg-faint">USDT</span>
              </p>
            )}
            {!waiting && (
              <p className="mt-1.5 flex min-w-0 items-center gap-2 whitespace-nowrap text-dense">
                <span className={`shrink-0 tabular-nums ${pnlClass(ret)}`}>{signedPct(ret)}</span>
                <span className="min-w-0 truncate"><RunHealth run={run} chain={chain} now={now} failures={s?.failures ?? null} /></span>
              </p>
            )}
          </div>
        )}
        <div className={`mt-2 overflow-hidden ${waiting ? "h-[52dvh] min-h-80" : "h-[72dvh] min-h-96"}`}><RunsPage /></div>
        <div className="@container space-y-2 px-2 pb-3 pt-1 text-dense">
          {run && <div className="rounded-card border border-card-border bg-island-alt px-3 pt-2.5"><StageReadings targets={{ annual_return: annual, max_drawdown: limit }} /></div>}
          <StagePerformance />
        </div>
        {run && (
          <section className="border-t border-line text-dense">
            <div className="flex min-h-(--header-h) flex-wrap items-center gap-x-3 gap-y-1 py-1 pl-1 pr-3"><TradesTools /></div>
            <div data-page-table className="overflow-x-auto"><TradesWindow /></div>
          </section>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-3 text-small text-fg-faint">
          <span>Run paper and Stop are in the desktop layout</span>
          <TextButton className="shrink-0 text-fg-muted underline underline-offset-3" onClick={() => desktopLayout.set(true)}>Desktop layout</TextButton>
        </div>
      </PhonePage>
      <Sheet open={picking} onClose={() => setPicking(false)} title="Runs">
        <div className="px-2 pb-3">
          <RunMenuList phone close={() => setPicking(false)} />
        </div>
      </Sheet>
    </>
  );
}
