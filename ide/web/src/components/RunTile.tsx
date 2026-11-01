import type { ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import type { PaperRun } from "../lib/paperApi";
import { chainOffline, chainReturn, chainStart, runReturn } from "../model/chain";
import { duration, pct, plural } from "../lib/format";
import { copyText } from "../lib/clipboard";
import { Icon } from "../icons/Icon";
import { openSource, showLineage } from "../state/editors";
import { requestFocus } from "../state/linking";
import { ACTIVE, deleteDialog, deleting, startPaper, stopDialog } from "../state/paper";
import { select } from "../state/selection";
import { useAtom } from "../state/atom";
import { pnlClass, type DataRole } from "../theme/roles";
import { IconButton } from "./IconButton";

const LAG_MS = 2 * 60_000;  // a one-minute bar this late is news
const ITEM = "flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none data-highlighted:bg-selection";
const SEALED = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** A run's health in words and its tone: running, data late, stopping, failed or ended. */
export function health(run: PaperRun, now: number): { tone: DataRole; text: string; late: boolean } {
  const lastBar = run.live?.last_bar_ns != null ? run.live.last_bar_ns / 1e6 : null;
  if (run.state === "running") {
    if (run.live?.exceptions) return { tone: "fail", text: `${run.live.exceptions}+ exceptions`, late: false };
    if (lastBar !== null && now - lastBar > LAG_MS) return { tone: "misses", text: `No bar for ${Math.round((now - lastBar) / 60_000)} min`, late: true };
    return { tone: "meets", text: lastBar === null ? "Waiting for the first bar" : "Running", late: false };
  }
  if (run.state === "stopping") return { tone: "misses", text: "Stopping", late: false };
  if (run.state !== "sealed") return { tone: "fail", text: "Ended, not sealed yet", late: false };
  return run.status === "invalid" ? { tone: "fail", text: `Invalid: ${(run.reasons ?? []).join(", ")}`, late: false } : { tone: "masked", text: "Complete", late: false };
}

export const returnOf = runReturn;
export const sealedOn = (run: PaperRun) => (run.seal?.stopped_ns ? SEALED.format(run.seal.stopped_ns / 1e6) : "");
export const signedPct = (n: number | null) => (n != null && n > 0 ? `+${pct(n)}` : pct(n));

/** A run's version: its name, cut at the end when narrow, and its revision, which always shows. */
export function RunName({ run, strong = false }: { run: PaperRun; strong?: boolean }) {
  const [name = "", revision] = (run.candidate ?? "").split("@");
  return (
    <span className={`flex min-w-0 text-dense ${strong ? "font-medium text-fg" : ACTIVE.has(run.state) ? "text-fg" : "text-fg-muted"}`}>
      <span className="truncate">{name}</span><span className="shrink-0 font-normal text-fg-faint">@{revision}</span>
    </span>
  );
}

/** How long a run has run (since its chain's first run started), or when it was sealed, late data in amber, a failure in red. */
function State({ run, chain, now }: { run: PaperRun; chain: readonly PaperRun[]; now: number }) {
  const state = health(run, now), started = chainStart(chain) ?? run.live?.started_ns ?? null;
  if (state.late) return <span className="text-misses">{state.text}</span>;
  if (state.tone === "fail") return <span className="text-fail">{run.state === "sealed" ? "Invalid" : state.text}</span>;
  if (run.state === "sealed") return <span>Sealed {sealedOn(run)}</span>;
  if (run.state !== "running" || started === null) return <span>{state.text}</span>;
  return <span>Running {duration(now - started / 1e6)}</span>;
}

/** The red ■ that asks to stop and seal a run, or the green ▶ that runs the same contracts again once
 *  sealed, as IntelliJ's stop and run buttons on the main toolbar. */
export function RunButton({ run, className }: { run: PaperRun; className?: string }) {
  const active = ACTIVE.has(run.state), id = run.candidate ?? "";
  return (
    <IconButton icon={active ? "stop" : "run"} tone={active ? "fail" : "meets"} frame className={className} disabled={run.state === "stopping"}
                label={active ? "Stop and seal" : "Run again with the same contracts"}
                onClick={(e) => { e.stopPropagation(); if (active) stopDialog.set(run); else void startPaper(id, { symbols: run.symbols }); }} />
  );
}

/** The trash beside the ■ or ▶ that asks to delete the run shown, its outline at 16px so that it is no
 *  larger than their filled glyphs; a run still running or not yet sealed has to be stopped first, so it
 *  is off until then, aria-disabled rather than disabled so that its tooltip still says why. */
export function DeleteButton({ run, className }: { run: PaperRun; className?: string }) {
  const busy = useAtom(deleting).has(run.paper_id), sealed = run.state === "sealed", off = !sealed || busy;
  return (
    <IconButton icon="delete" frame glyph={16} className={className} aria-disabled={off}
                label={sealed ? "Delete run…" : "Delete run: stop and seal it first"}
                onClick={(e) => { e.stopPropagation(); if (!off) deleteDialog.set(run); }} />
  );
}

/** A run's actions on right-click: stop, find its version in the graph, open its source, copy its id. */
export function RunMenu({ run, children }: { run: PaperRun; children: ReactNode }) {
  const id = run.candidate ?? "";
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-52 rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup">
          <ContextMenu.Label className="truncate px-2 pb-1 pt-1.5 font-mono text-small text-fg-faint">{id} · run {run.paper_id}</ContextMenu.Label>
          {ACTIVE.has(run.state) && <ContextMenu.Item className={ITEM} onSelect={() => stopDialog.set(run)}><Icon name="stop" />Stop and seal…</ContextMenu.Item>}
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

/** One run in the run picker's list: its version, its return and how long it has run; the run shown on
 *  the inactive selection. Stopping one is in its context menu, and on the toolbar once it is picked. The
 *  latest run of a chain restarted after Docker restarts (`chain`, oldest first) stands for all of it:
 *  the chain's return and time, its restarts and how long it was offline between them. */
export function RunRow({ run, chain = [run], on, now, onPick }: { run: PaperRun; chain?: readonly PaperRun[]; on: boolean; now: number; onPick: () => void }) {
  const ret = chainReturn(chain);
  return (
    <RunMenu run={run}>
      <div role="option" aria-selected={on} tabIndex={0} onClick={onPick} onKeyDown={(e) => { if (e.key === "Enter") onPick(); }} title={`${run.candidate ?? ""} · run ${chain.length > 1 ? `${chain.map((r) => r.paper_id).join(", ")}, joined across restarts` : run.paper_id}`}
           className={`flex h-12 shrink-0 cursor-default flex-col justify-center gap-1 rounded-card px-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${on ? "bg-selection-inactive" : "hover:bg-hover"}`}>
        <RunName run={run} />
        <span className="flex min-w-0 gap-2 whitespace-nowrap text-small text-fg-muted">
          <span className={`shrink-0 tabular-nums ${pnlClass(ret)}`}>{signedPct(ret)}</span><span className="truncate"><State run={run} chain={chain} now={now} /></span>
          {chain.length > 1 && <span className="shrink-0 text-fg-faint">· {plural(chain.length - 1, "restart")} · {duration(chainOffline(chain))} offline</span>}
        </span>
      </div>
    </RunMenu>
  );
}
