import type { ReactNode } from "react";
import { useNow } from "../../components/hooks/useNow";
import { PopoverWidget } from "../../components/Dropdown";
import { DeleteButton, health, RunButton, RunMenu, StartButton } from "../../components/RunTile";
import { ACTIVE } from "../../model/chain";
import { Tip } from "../../components/Tip";
import { usePaperRuns, usePaperService } from "../../state/paper";
import { useStream } from "../../state/paperStream";
import { useShown } from "../../state/shown";
import { chooseRun } from "../../state/stage";
import { alarming, RunHealth, RunList, runOrder } from "../../widgets/paper/RunPicker";

const DOT = { meets: "bg-meets", misses: "bg-misses", fail: "bg-fail" } as const;

/** The Runs page's part of the main toolbar, after the line and ledger (while the daemon does not answer,
 *  only that): the selected version's paper run (state/shown.ts), as IntelliJ's run-configuration widget
 *  (its state dot, version and revision; the menu lists every run by version to pick one, with a ring on the
 *  widget, apart from its own filled dot, when another run is in trouble), then its state in words, dropped
 *  when narrow. Its equity and return are on the chart's Equity switch (widgets/paper/EquityReading.tsx);
 *  its ■ or ▶ and Delete in the toolbar's action group (usePaperRunActions). */
export function PaperRunWidget() {
  const service = usePaperService();
  const listing = usePaperRuns();
  const { run, chain } = useShown();
  const stream = useStream();
  const now = useNow();
  if (service === "offline") return (
    <div className="flex min-w-0 items-center gap-2 px-2 text-dense">
      <i className="size-1.5 shrink-0 rounded-full bg-fail" />
      <span className="shrink-0 font-semibold">Paper daemon offline</span>
      <span className="min-w-0 truncate text-fg-faint">· retrying…</span>
    </div>
  );
  if (service !== "present") return null;
  const runs = listing?.runs ?? [], order = runOrder(runs, now);
  const alarm = order.find((r) => r !== run && alarming(r, now)), trouble = alarm && health(alarm, now);
  const s = run && stream?.paperId === run.paper_id ? stream : null;
  const state = run && health(run, now);
  const [name = "", revision] = (run?.candidate ?? "").split("@");
  const widget = (
    <div className="flex min-w-0 shrink items-center">
      <PopoverWidget label={`Paper runs: all ${order.length}${trouble ? ` · ${alarm.candidate ?? ""} · ${trouble.text}` : ""}`} trigger={
        <span className="flex min-w-0 items-center gap-2">
          {run && state && ACTIVE.has(run.state) && state.tone in DOT && <i className={`size-1.5 shrink-0 rounded-full ${DOT[state.tone as keyof typeof DOT]}`} />}
          {run ? <span className="flex min-w-0 font-mono"><span className="truncate font-semibold">{name}</span><span className="shrink-0 text-fg-faint">@{revision}</span></span>
            : <span className="truncate text-dense text-fg-faint">No paper run</span>}
          {trouble && <Tip content={`${alarm.candidate ?? ""} · ${trouble.text}`} side="bottom">
            <i className={`size-2 shrink-0 rounded-full border-[1.5px] ${trouble.tone === "fail" ? "border-fail" : "border-misses"}`} />
          </Tip>}
        </span>}>
        {(close) => <RunList order={order} runs={runs} front={run} now={now} pick={(r) => { chooseRun(r); close(); }} />}
      </PopoverWidget>
    </div>
  );
  if (!run) return widget;
  return (
    <>
      <RunMenu run={run}>{widget}</RunMenu>
      {/* Takes the toolbar's height, so that when it does not fit it wraps out of sight whole, never cut. */}
      <div className="ml-3 flex h-(--frame-control) min-w-0 shrink-[100] flex-wrap content-start overflow-hidden whitespace-nowrap text-dense text-fg-muted">
        <span className="inline-flex h-(--frame-control) shrink-0 items-center"><RunHealth run={run} chain={chain} now={now} failures={s?.failures ?? null} /></span>
      </div>
    </>
  );
}

/** The shown version's paper actions for the toolbar's action group: ■ Stop or ▶ Run again and Delete for
 *  its run, ▶ Run paper for a version with none; nothing while the daemon does not answer. */
export function usePaperRunActions(): ReactNode {
  const service = usePaperService(), { version, run } = useShown();
  if (service !== "present") return null;
  if (!run) return version && <StartButton candidate={version} />;
  return <><RunButton run={run} /><DeleteButton run={run} /></>;
}
