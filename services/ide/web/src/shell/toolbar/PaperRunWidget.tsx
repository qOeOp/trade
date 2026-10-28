import { amount, fixed } from "../../lib/paperApi";
import { useNow } from "../../components/hooks/useNow";
import { PopoverWidget } from "../../components/Dropdown";
import { DeleteButton, health, returnOf, RunButton, RunMenu, signedPct } from "../../components/RunTile";
import { Tip } from "../../components/Tip";
import { useAtom } from "../../state/atom";
import { ACTIVE, paperTab, selectedRun, usePaperRuns, usePaperService } from "../../state/paper";
import { useStream } from "../../state/paperStream";
import { pnlClass } from "../../theme/roles";
import { alarming, RunHealth, RunList, runOrder } from "../../widgets/paper/RunPicker";

const DOT = { meets: "bg-meets", misses: "bg-misses", fail: "bg-fail" } as const;

/** The Paper page's part of the main toolbar (while the daemon does not answer, only that): where the graph has its line and ledger, the run shown, as
 *  IntelliJ's run-configuration widget (its state dot, version and revision; the menu lists every run to
 *  pick one, with a dot on the widget when a run behind it is in trouble), then its readout: equity,
 *  return since the start and its state in words; and before search, as IntelliJ's run buttons, its ■ or ▶
 *  and the delete beside them. */
export function PaperRunWidget() {
  const offline = usePaperService() === "offline";
  const listing = usePaperRuns();
  const selected = useAtom(selectedRun);
  const stream = useStream();
  const now = useNow();
  const order = runOrder(listing?.runs ?? [], now);
  const run = order.find((r) => r.paper_id === selected) ?? order[0];
  if (offline) return (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-2 text-dense">
      <i className="size-1.5 shrink-0 rounded-full bg-fail" />
      <span className="shrink-0 font-semibold">Paper daemon offline</span>
      <span className="min-w-0 truncate text-fg-faint">· retrying…</span>
    </div>
  );
  if (!run) return <div className="min-w-0 flex-1" />;
  const s = stream?.paperId === run.paper_id ? stream : null;
  const pick = (id: number) => { if (id !== selected) { selectedRun.set(id); paperTab.set(null); } };
  const state = health(run, now), alarm = order.find((r) => r !== run && alarming(r, now)), trouble = alarm && health(alarm, now);
  const [name = "", revision] = (run.candidate ?? "").split("@");
  const [whole = "", cents = ""] = (fixed(amount(s?.seal?.final_equity_usdt ?? s?.readings?.final_equity_usdt
    ?? run.seal?.final_equity_usdt ?? run.live?.final_equity_usdt), 2) ?? "").split(".");
  const ret = returnOf(run);
  return (
    <>
      <RunMenu run={run}>
        <div className="flex min-w-0 shrink items-center">
          <PopoverWidget label={`Paper runs: all ${order.length}${trouble ? ` · ${alarm.candidate ?? ""} · ${trouble.text}` : ""}`} trigger={
            <span className="flex min-w-0 items-center gap-2">
              {ACTIVE.has(run.state) && state.tone in DOT && <i className={`size-1.5 shrink-0 rounded-full ${DOT[state.tone as keyof typeof DOT]}`} />}
              <span className="flex min-w-0 font-mono"><span className="truncate font-semibold">{name}</span><span className="shrink-0 text-fg-faint">@{revision}</span></span>
              {trouble && <Tip content={`${alarm.candidate ?? ""} · ${trouble.text}`} side="bottom">
                <i className={`size-1.5 shrink-0 rounded-full ${trouble.tone === "fail" ? "bg-fail" : "bg-misses"}`} />
              </Tip>}
            </span>}>
            {(close) => <RunList order={order} front={run} now={now} pick={(r) => { pick(r.paper_id); close(); }} />}
          </PopoverWidget>
        </div>
      </RunMenu>
      <span className="mx-2 h-4 w-px shrink-0 bg-line-strong" />
      <div className="flex min-w-0 flex-1 items-center gap-x-5 whitespace-nowrap text-dense">
        <span className="shrink-0 tabular-nums">
          <span className="text-fg-faint">Equity </span><span className="text-fg">{whole || "-"}</span>
          {cents && <span className="text-fg-faint">.{cents}</span>}<span className="text-fg-faint"> USDT</span>
        </span>
        <span className="shrink-0 tabular-nums"><span className="text-fg-faint">Return </span><span className={pnlClass(ret)}>{signedPct(ret)}</span></span>
        <span className="min-w-0 truncate text-fg-muted"><RunHealth run={run} now={now} failures={s?.failures ?? null} /></span>
      </div>
      <RunButton run={run} className="ml-3" />
      <DeleteButton run={run} className="mr-2" />
    </>
  );
}
