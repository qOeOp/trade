import { dateTime, type TimeZone } from "../lib/time";
import { useTimeZone } from "../state/timeZone";
import type { ReactNode } from "react";
import type { PaperRun } from "../lib/paperApi";
import { ACTIVE, continuable } from "../model/chain";
import { ending } from "../model/ending";
import { LAG_MS, waitingText, waitingUntil } from "../model/observation";
import { copyText } from "../lib/clipboard";
import { openSource } from "../state/editors";
import { activeRun, deleteDialog, deleting, full, startDialog, starting, startPaper, stopDialog, usePaperRuns, resumePaper, resuming } from "../state/paper";
import { usePhone } from "../state/phone";
import { useAtom } from "../state/atom";
import type { DataRole } from "../theme/roles";
import { ActionButton } from "./ActionGroup";
import { locate, Menu, MenuItem, MenuSeparator } from "./VersionMenu";

/** A run's health in words and its tone: running, data late, stopping, or how it ended (model/ending.ts),
 *  in the warning tone when its evidence is untrusted. */
export function health(run: PaperRun, now: number, zone: TimeZone = "UTC"): { tone: DataRole; text: string; late: boolean } {
  if (run.recovery) return { tone: "fail", text: "Recovery paused · account retained", late: false };
  const lastBar = run.live?.last_bar_ns != null ? run.live.last_bar_ns / 1e6 : null;
  if (run.state === "running") {
    if (run.live?.exceptions) return { tone: "fail", text: `${run.live.exceptions}+ errors`, late: false };
    const until = waitingUntil(run);
    if (until !== null) return { tone: "misses", text: waitingText(until, now, zone), late: now - until > LAG_MS };
    if (lastBar !== null && now - lastBar > LAG_MS) return { tone: "misses", text: `No bar for ${Math.round((now - lastBar) / 60_000)} min`, late: true };
    return { tone: lastBar === null ? "misses" : "meets", text: lastBar === null ? "Waiting for the first bar" : "Running", late: false };
  }
  if (run.state === "stopping") return { tone: "misses", text: "Stopping", late: false };
  if (run.state !== "sealed") return { tone: "fail", text: "Ended, not sealed yet", late: false };
  const end = ending(run);
  return { tone: end.kind === "invalid" ? "misses" : "masked", text: end.text, late: false };
}

const sealedOn = (run: PaperRun, zone: TimeZone = "UTC") => (run.seal?.stopped_ns ? dateTime(run.seal.stopped_ns / 1e6, zone, "minute") : "");

/** How a sealed run ended and when, in the warning tone when invalid, with why it is, its refusal and
 *  whether the strategy raised (`errors`, the count where it is known): Stopped 31 Oct · 3 errors. */
export function Ended({ run, errors }: { run: PaperRun; errors?: ReactNode }) {
  const zone = useTimeZone();
  const end = ending(run), invalid = end.kind === "invalid", raised = errors ?? (end.exceptions && <span className="text-misses-fg">errors</span>);
  return (
    <span><span className={invalid ? "text-misses-fg" : ""}>{end.word} {sealedOn(run, zone)}</span>
      {end.detail && <span className={invalid ? "text-misses-fg" : ""}> · {end.detail}</span>}{raised && <> · {raised}</>}</span>
  );
}

/** The ■ Stop that asks to stop and seal a run, as IntelliJ's stop button; once sealed, a ▶ that runs the
 *  same contracts again: in the accent when the new run will continue the run's chain (model/chain.ts), as
 *  it does unless the run is invalid or a later run of them stands between, Continue, or Start for a run
 *  that never started; else Run again; while that start is in flight, a turning Starting…; off, saying which,
 *  while another run of the version is not sealed (one per version). Each says what it does beside its icon
 *  (ActionGroup). */
export function RunButton({ run }: { run: PaperRun }) {
  const listing = usePaperRuns(), runs = listing?.runs ?? [], go = continuable(run, runs), limit = full(listing);
  const busy = useAtom(resuming).has(run.paper_id), pending = useAtom(starting).has(run.candidate ?? "");
  const other = run.candidate === null ? undefined : activeRun(listing, run.candidate);
  if (!ACTIVE.has(run.state)) return (
    <ActionButton icon={pending ? "loading" : "run"} spinning={pending} disabled={pending} aria-disabled={other !== undefined}
                  tone={pending || go || limit ? undefined : "meets"}
                  className={`${limit ? "text-fg-muted" : go ? "text-primary" : "text-fg"} disabled:cursor-progress`}
                  hint={pending ? undefined : other ? `Run ${other.paper_id} of this version is running; stop it first` : limit ?? undefined}
                  onClick={(e) => { e.stopPropagation(); if (!other) void startPaper(run.candidate ?? "", { symbols: run.symbols }); }}>
      {pending ? "Starting…" : ending(run).kind === "unstarted" ? "Start" : "Run again"}
    </ActionButton>
  );
  return (
    <>
      {(run.state === "ended" || run.state === "unsealed") && <ActionButton icon="run" disabled={busy} className="text-primary"
        onClick={(e) => { e.stopPropagation(); void resumePaper(run); }}>{busy ? "Resuming…" : "Resume"}</ActionButton>}
      <ActionButton icon="stop" tone="fail" className="text-fg" disabled={run.state === "stopping"} hint="Stop the run and seal its evidence"
                    onClick={(e) => { e.stopPropagation(); stopDialog.set(run); }}>{run.state === "stopping" ? "Stopping…" : "Stop"}</ActionButton>
    </>
  );
}

/** The ▶ Run paper… for a version with no paper run: a click asks first, showing the contracts (its last
 *  research replay's to start with). */
export function StartButton({ candidate }: { candidate: string }) {
  const busy = useAtom(starting).has(candidate), limit = full(usePaperRuns());
  return (
    <ActionButton icon={busy ? "loading" : "run"} spinning={busy} tone={busy || limit ? undefined : "meets"} disabled={busy} className={`${limit ? "text-fg-muted" : "text-fg"} disabled:cursor-progress`}
                  hint={limit ?? undefined}
                  onClick={() => startDialog.set(candidate)}>
      {busy ? "Starting…" : "Run paper…"}
    </ActionButton>
  );
}

/** The Delete beside the ■ or ▶ that asks to delete the run shown; a run still running or not yet sealed
 *  has to be stopped first, so it is off until then, aria-disabled rather than disabled so that its tooltip
 *  still says why. */
export function DeleteButton({ run }: { run: PaperRun }) {
  const busy = useAtom(deleting).has(run.paper_id), sealed = run.state === "sealed", off = !sealed || busy;
  return (
    <ActionButton icon="delete" className="text-fg" aria-disabled={off} hint={sealed ? "Delete this run…" : "Stop and seal the run first"}
                  onClick={(e) => { e.stopPropagation(); if (!off) deleteDialog.set(run); }}>Delete</ActionButton>
  );
}

/** A run's actions on right-click: stop, find its version in the graph, open its source, copy its id. */
export function RunMenu({ run, children }: { run: PaperRun; children: ReactNode }) {
  const id = run.candidate ?? "";
  if (usePhone()) return children;  // a phone reads: starting, stopping and deleting wait for Desktop layout
  return (
    <Menu title={`${id} · run ${run.paper_id}`} items={<>
      {ACTIVE.has(run.state) && <MenuItem icon="stop" label="Stop and seal…" run={() => stopDialog.set(run)} />}
      {(run.state === "ended" || run.state === "unsealed") && <MenuItem icon="run" label="Resume this run" run={() => void resumePaper(run)} />}
      <MenuItem icon="locate" label="Locate version in graph" run={() => locate(id)} />
      <MenuItem icon="file.python" label="Open source" run={() => openSource(id)} />
      <MenuItem icon="copy" label="Copy run id" run={() => void copyText(String(run.paper_id))} />
      {run.state === "sealed" && <><MenuSeparator /><MenuItem icon="delete" label="Delete run…" run={() => deleteDialog.set(run)} /></>}
    </>}>{children}</Menu>
  );
}
