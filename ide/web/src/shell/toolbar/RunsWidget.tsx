import { amount, fixed } from "../../lib/paperApi";
import { useNow } from "../../components/hooks/useNow";
import { PopoverWidget } from "../../components/Dropdown";
import { TextButton } from "../../components/TextButton";
import { RunMenuList } from "../../widgets/runs/RunMenuList";
import { openLiveCredentials, openLiveRequests, openLiveWizard } from "../../state/liveWorkspace";
import { useLiveTrading } from "../../state/liveTrading";
import { DeleteButton, health, RunButton, RunMenu, signedPct, StartButton } from "../../components/RunTile";
import { ACTIVE, chainEquity, chainReturn } from "../../model/chain";
import { Tip } from "../../components/Tip";
import { usePaperRuns, usePaperService } from "../../state/paper";
import { useStream } from "../../state/paperStream";
import { useShown } from "../../state/shown";
import { pnlClass } from "../../theme/roles";
import { alarming, RunHealth, runOrder } from "../../widgets/paper/RunPicker";

const DOT = { meets: "bg-meets", misses: "bg-misses", fail: "bg-fail" } as const;
// A reading takes the toolbar's height, so one that does not fit wraps out of sight whole, never cut.
const READING = "inline-flex h-(--frame-control) shrink-0 items-center tabular-nums";

/** Runs' toolbar follows the selected stage: Backtest names its version and trial; Live offers its
 *  review and management actions; Paper alone shows account readings, lifecycle controls and deletion.
 *  The shared picker still lists every run. A global Paper warning is labelled as Paper outside that
 *  stage. A Backtest version with no Paper run keeps its explicit Run paper action when served. */
export function RunsWidget() {
  const service = usePaperService();
  const listing = usePaperRuns();
  const { version, run, liveRun, stage, chain, trial } = useShown();
  const live = useLiveTrading();
  const stream = useStream();
  const now = useNow();
  const runs = listing?.runs ?? [], order = runOrder(runs, now);
  const alarm = order.find((r) => r !== run && alarming(r, now)), trouble = alarm && health(alarm, now);
  const s = run && stream?.paperId === run.paper_id ? stream : null;
  const state = stage === "paper" && run && health(run, now);
  const [name = "", revision] = (run?.candidate ?? "").split("@");
  const widget = (
    <div className="flex min-w-0 shrink items-center">
      <PopoverWidget label={`Runs: ${order.length} paper · ${live.view.runs.length} live${trouble ? ` · Paper · ${alarm.candidate ?? ""} · ${trouble.text}` : ""}`} trigger={
        <span className="flex min-w-0 items-center gap-2">
          {run && state && ACTIVE.has(run.state) && state.tone in DOT && <i className={`size-1.5 shrink-0 rounded-full ${DOT[state.tone as keyof typeof DOT]}`} />}
          {stage === "live" ? <span className="truncate text-dense"><span className="font-semibold">Live</span><span className="ml-2 text-fg-muted">{liveRun?.candidate ?? "No run selected"}</span></span> : stage === "backtest" ? <span className="truncate text-dense"><span className="font-semibold">Backtest</span><span className="ml-2 text-fg-muted">{version ?? "No version selected"}{trial && ` · trial ${trial.trial_id}`}</span></span> : run ? <span className="flex min-w-0 font-mono"><span className="truncate font-semibold">{name}</span><span className="shrink-0 text-fg-faint">@{revision}</span></span>
            : <span className="truncate text-dense text-fg-faint">Select a run</span>}
          {trouble && <Tip content={`Paper · ${alarm.candidate ?? ""} · ${trouble.text}`} side="bottom">
            <span className="flex shrink-0 items-center gap-1 text-small text-fg-faint"><i aria-hidden="true" className={`size-2 shrink-0 rounded-full border-[1.5px] ${trouble.tone === "fail" ? "border-fail" : "border-misses"}`} />{stage !== "paper" && <span>Paper</span>}</span>
          </Tip>}
        </span>}>
        {(close) => <RunMenuList close={close} />}
      </PopoverWidget>
    </div>
  );
  const liveMenu = <TextButton className="ml-1 shrink-0 whitespace-nowrap text-dense" onClick={() => openLiveWizard()}>New live run…</TextButton>;
  if (stage === "live") return <>{widget}
    {liveRun && <TextButton className="shrink-0 whitespace-nowrap text-dense" onClick={() => openLiveWizard(liveRun.id)}>Review run…</TextButton>}
    {liveMenu}
    <TextButton className="shrink-0 text-dense" onClick={openLiveCredentials}>Credentials</TextButton>
    <TextButton className="shrink-0 text-dense" onClick={openLiveRequests}>Requests</TextButton>
  </>;
  if (stage === "backtest") return <>{widget}{service === "present" && !run && version && <StartButton candidate={version} className="ml-1" />}{liveMenu}</>;
  if (service !== "present") return <>{widget}{liveMenu}{service === "offline" && <span className="ml-2 truncate text-dense text-fail">Paper daemon offline</span>}</>;
  if (!run) return <>{widget}{version && <StartButton candidate={version} className="ml-1" />}{liveMenu}</>;
  // A chain of runs reads as one account: its equity and return carry on from run to run.
  const [whole = "", cents = ""] = (fixed(chainEquity(chain, amount(s?.seal?.final_equity_usdt ?? s?.readings?.final_equity_usdt
    ?? run.seal?.final_equity_usdt ?? run.live?.final_equity_usdt)), 2) ?? "").split(".");
  const ret = chainReturn(chain);
  return (
    <>
      <RunMenu run={run}>{widget}</RunMenu>
      <RunButton run={run} className="ml-1" />
      <div className="ml-3 flex h-(--frame-control) min-w-0 shrink-[100] flex-wrap content-start gap-x-5 overflow-hidden whitespace-nowrap text-dense">
        <span className={READING}>
          <span className="text-fg-faint">Equity&nbsp;</span><span className="text-fg">{whole || "-"}</span>
          {cents && <span className="text-fg-faint">.{cents}</span>}<span className="text-fg-faint">&nbsp;USDT</span>
        </span>
        <span className={READING}><span className="text-fg-faint">Return&nbsp;</span><span className={pnlClass(ret)}>{signedPct(ret)}</span></span>
        <span className={`${READING} text-fg-muted`}><RunHealth run={run} chain={chain} now={now} failures={s?.failures ?? null} /></span>
      </div>
      <DeleteButton run={run} className="ml-2" />
      {liveMenu}
    </>
  );
}
