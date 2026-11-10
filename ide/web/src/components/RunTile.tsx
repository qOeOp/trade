import { dateTime, type TimeZone } from "../lib/time";
import { useTimeZone } from "../state/timeZone";
import type { ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import type { PaperRun } from "../lib/paperApi";
import { ACTIVE, continuable } from "../model/chain";
import { ending } from "../model/ending";
import { LAG_MS, waitingText, waitingUntil } from "../model/observation";
import { pct } from "../lib/format";
import { copyText } from "../lib/clipboard";
import { Icon } from "../icons/Icon";
import { openSource, showLineage } from "../state/editors";
import { requestFocus } from "../state/linking";
import { activeRun, deleteDialog, deleting, full, startDialog, starting, startPaper, stopDialog, usePaperRuns, resumePaper, resuming } from "../state/paper";
import { usePhone } from "../state/phone";
import { select } from "../state/selection";
import { useAtom } from "../state/atom";
import type { DataRole } from "../theme/roles";
import { ActionButton } from "./ActionGroup";

const ITEM = "flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none data-highlighted:bg-selection";

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

export const sealedOn = (run: PaperRun, zone: TimeZone = "UTC") => (run.seal?.stopped_ns ? dateTime(run.seal.stopped_ns / 1e6, zone, "minute") : "");
export const signedPct = (n: number | null) => (n == null ? "—" : n > 0 ? `+${pct(n)}` : pct(n));

/** How a sealed run ended and when, in the warning tone when invalid, with why it is, its refusal and
 *  whether the strategy raised (`errors`, the count where it is known): Stopped 31 Oct · 3 errors. */
export function Ended({ run, errors }: { run: PaperRun; errors?: ReactNode }) {
  const zone = useTimeZone();
  const end = ending(run), invalid = end.kind === "invalid", raised = errors ?? (end.exceptions && <span className="text-misses">errors</span>);
  return (
    <span><span className={invalid ? "text-misses" : ""}>{end.word} {sealedOn(run, zone)}</span>
      {end.detail && <span className={invalid ? "text-misses" : ""}> · {end.detail}</span>}{raised && <> · {raised}</>}</span>
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
                  hint={pending ? undefined : other ? `Run ${other.paper_id} of this version is running; stop it first` : limit ? `${limit}; stop one first` : undefined}
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

/** The ▶ Run paper for a version with no paper run: a click runs it on its last research replay's
 *  contracts, ⌥-click asks which. */
export function StartButton({ candidate }: { candidate: string }) {
  const busy = useAtom(starting).has(candidate), limit = full(usePaperRuns());
  return (
    <ActionButton icon={busy ? "loading" : "run"} spinning={busy} tone={busy || limit ? undefined : "meets"} disabled={busy} className={`${limit ? "text-fg-muted" : "text-fg"} disabled:cursor-progress`}
                  hint={limit ? `${limit}; stop one first` : <span>Run paper <span className="text-fg-faint">· ⌥-click: Run paper with…</span></span>}
                  onClick={(e) => { if (e.altKey) startDialog.set(candidate); else void startPaper(candidate); }}>
      {busy ? "Starting…" : "Run paper"}
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
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-52 rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup">
          <ContextMenu.Label className="truncate px-2 pb-1 pt-1.5 font-mono text-small text-fg-faint">{id} · run {run.paper_id}</ContextMenu.Label>
          {ACTIVE.has(run.state) && <ContextMenu.Item className={ITEM} onSelect={() => stopDialog.set(run)}><Icon name="stop" />Stop and seal…</ContextMenu.Item>}
          {(run.state === "ended" || run.state === "unsealed") && <ContextMenu.Item className={ITEM} onSelect={() => void resumePaper(run)}><Icon name="run" />Resume this run</ContextMenu.Item>}
          <ContextMenu.Item className={ITEM} onSelect={() => { select(id); showLineage(); requestFocus(id); }}><Icon name="locate" />Locate version in graph</ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => openSource(id)}><Icon name="file.python" />Open source</ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => void copyText(String(run.paper_id))}><Icon name="copy" />Copy run id</ContextMenu.Item>
          {run.state === "sealed" && <>
            <ContextMenu.Separator className="my-1 h-px bg-line-strong" />
            <ContextMenu.Item className={ITEM} onSelect={() => deleteDialog.set(run)}><Icon name="delete" />Delete run…</ContextMenu.Item>
          </>}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
