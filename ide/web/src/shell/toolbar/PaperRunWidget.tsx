import { amount, fixed } from "../../lib/paperApi";
import { useNow } from "../../components/hooks/useNow";
import { PopoverWidget } from "../../components/Dropdown";
import { DeleteButton, health, RunButton, RunMenu, signedPct, StartButton } from "../../components/RunTile";
import { ACTIVE, chainEquity, chainReturn } from "../../model/chain";
import { Tip } from "../../components/Tip";
import { usePaperRuns, usePaperService } from "../../state/paper";
import { useStream } from "../../state/paperStream";
import { useShown } from "../../state/shown";
import { chooseRun } from "../../state/stage";
import { pnlClass } from "../../theme/roles";
import { alarming, RunHealth, RunList, runOrder } from "../../widgets/paper/RunPicker";

const DOT = { meets: "bg-meets", misses: "bg-misses", fail: "bg-fail" } as const;
// A reading takes the toolbar's height, so one that does not fit wraps out of sight whole, never cut.
const READING = "inline-flex h-(--frame-control) shrink-0 items-center tabular-nums";

/** The Runs page's part of the main toolbar, after the line and ledger (while the daemon does not answer,
 *  only that): the selected version's paper run (state/shown.ts), as IntelliJ's run-configuration widget
 *  (its state dot, version and revision; the menu lists every run by version to pick one, with a ring on the
 *  widget, apart from its own filled dot, when another run is in trouble) and, as IntelliJ's run buttons, its ■ or ▶; then its readout:
 *  equity, return since the start and its state in words, dropped whole from the right when narrow; and
 *  the delete. A version with no run offers ▶ to start one. */
export function PaperRunWidget() {
  const service = usePaperService();
  const listing = usePaperRuns();
  const { version, run, chain } = useShown();
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
  if (!run) return <>{widget}{version && <StartButton candidate={version} className="ml-1" />}</>;
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
    </>
  );
}
