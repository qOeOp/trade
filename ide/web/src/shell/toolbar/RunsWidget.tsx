import type { ReactNode } from "react";
import { useNow } from "../../components/hooks/useNow";
import { PopoverWidget } from "../../components/Dropdown";
import { ActionButton, ActionRule } from "../../components/ActionGroup";
import { RunMenuList } from "../../widgets/runs/RunMenuList";
import { openLiveCredentials, openLiveRequests, openLiveReview } from "../../state/liveWorkspace";
import { useLiveTrading } from "../../state/liveTrading";
import { DeleteButton, health, RunButton, RunMenu, StartButton } from "../../components/RunTile";
import { Tip } from "../../components/Tip";
import { usePaperRuns, usePaperService } from "../../state/paper";
import { useStream } from "../../state/paperStream";
import { useShown } from "../../state/shown";
import { alarming, RunHealth, runOrder } from "../../widgets/paper/RunPicker";

/** Runs' shared picker follows the selected stage, with Paper's health beside it. Paper's account
 *  readings are on its chart's Equity switch; each stage's actions are in the main toolbar's action group (useRunActions). A global
 *  Paper warning is explicitly labelled as an alert outside that stage. */
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
  const [name = "", revision] = (run?.candidate ?? "").split("@");
  const widget = (
    <div className="flex min-w-0 shrink items-center">
      <PopoverWidget label={`Runs: ${order.length} paper · ${live.view.runs.length} live${trouble ? ` · Paper · ${alarm.candidate ?? ""} · ${trouble.text}` : ""}`} trigger={
        <span className="flex min-w-0 items-center gap-2">
          {stage === "live" ? <span className="truncate text-dense"><span className="font-semibold">Live</span><span className="ml-2 text-fg-muted">{liveRun?.candidate ?? "No run selected"}</span></span> : stage === "backtest" ? <span className="truncate text-dense"><span className="font-semibold">Backtest</span><span className="ml-2 text-fg-muted">{version ?? "No version selected"}{trial && ` · trial ${trial.trial_id}`}</span></span> : run ? <span className="flex min-w-0 font-mono"><span className="truncate font-semibold">{name}</span><span className="shrink-0 text-fg-faint">@{revision}</span></span>
            : <span className="truncate text-dense text-fg-faint">Select a run</span>}
          {trouble && <Tip content={`Paper · ${alarm.candidate ?? ""} · ${trouble.text}`} side="bottom">
            <span className="flex shrink-0 items-center gap-1 text-small text-fg-faint"><i aria-hidden="true" className={`size-2 shrink-0 rounded-full border-[1.5px] ${trouble.tone === "fail" ? "border-fail" : "border-misses"}`} />{stage !== "paper" && <span>Paper alert</span>}</span>
          </Tip>}
        </span>}>
        {(close) => <RunMenuList close={close} />}
      </PopoverWidget>
    </div>
  );
  if (stage !== "paper") return widget;
  if (service !== "present") return <>{widget}{service === "offline" && <span className="ml-2 truncate text-dense text-fail-fg">Paper daemon offline</span>}</>;
  if (!run) return widget;
  return (
    <>
      <RunMenu run={run}>{widget}</RunMenu>
      <div className="ml-3 flex h-(--frame-control) min-w-0 shrink-[100] flex-wrap content-start overflow-hidden whitespace-nowrap text-dense text-fg-muted">
        <span className="inline-flex h-(--frame-control) shrink-0 items-center"><RunHealth run={run} chain={chain} now={now} failures={s?.failures ?? null} /></span>
      </div>
    </>
  );
}

/** Stage-specific actions share the main toolbar's one ActionGroup. A remembered Paper run never
 *  contributes controls to Backtest or Live; a Backtest without Paper keeps its explicit Run paper. A new
 *  live run starts from the Live stage's canvas, the run picker or the command palette, not from here. */
export function useRunActions(): ReactNode {
  const service = usePaperService(), { version, run, liveRun, stage } = useShown();
  if (stage === "live") return <>
    {liveRun && <><ActionButton icon="tool.inspector" onClick={() => openLiveReview(liveRun.id)}>Review run…</ActionButton><ActionRule /></>}
    <ActionButton icon="settings" onClick={openLiveCredentials}>Settings</ActionButton>
    <ActionButton icon="history" onClick={openLiveRequests}>Requests</ActionButton>
  </>;
  return service !== "present" ? null : stage === "paper" && run ? <><RunButton run={run} /><DeleteButton run={run} /></>
    : !run && version ? <StartButton candidate={version} /> : null;
}
