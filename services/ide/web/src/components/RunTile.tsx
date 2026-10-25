import type { ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import type { PaperRun } from "../lib/paperApi";
import { pct } from "../lib/format";
import { copyText } from "../lib/clipboard";
import { Icon } from "../icons/Icon";
import { openSource, showLineage } from "../state/editors";
import { requestFocus } from "../state/linking";
import { ACTIVE, startPaper, stopDialog } from "../state/paper";
import { select } from "../state/selection";
import { pnlClass, type DataRole } from "../theme/roles";
import { Tip } from "./Tip";

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

/** 21d 4h, 3h 12m, 46m. */
export function age(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000)), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}
export const returnOf = (run: PaperRun) => (run.state === "sealed" ? run.seal?.total_return ?? run.total_return : run.live?.total_return ?? null);
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

/** How long a run has run (or when it was sealed), late data in amber, a failure in red. */
function State({ run, now }: { run: PaperRun; now: number }) {
  const state = health(run, now), started = run.seal?.started_ns ?? run.live?.started_ns ?? null;
  if (state.late) return <span className="text-misses">{state.text}</span>;
  if (state.tone === "fail") return <span className="text-fail">{run.state === "sealed" ? "Invalid" : state.text}</span>;
  if (run.state === "sealed") return <span>Sealed {sealedOn(run)}</span>;
  if (run.state !== "running" || started === null) return <span>{state.text}</span>;
  return <span>Running {age(now - started / 1e6)}</span>;
}

/** The round ⏸ that asks to stop and seal a run, or ▶ to run the same contracts again once sealed. */
export function RunButton({ run, filled = false }: { run: PaperRun; filled?: boolean }) {
  const active = ACTIVE.has(run.state), id = run.candidate ?? "";
  const label = active ? "Stop and seal" : "Run again with the same contracts";
  return (
    <Tip content={label}>
      <button type="button" aria-label={label} disabled={run.state === "stopping"}
              onClick={(e) => { e.stopPropagation(); if (active) stopDialog.set(run); else void startPaper(id, { symbols: run.symbols }); }}
              className={`grid size-7 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40 ${filled ? "bg-pressed text-fg" : "text-fg-muted ring-1 ring-inset ring-line-strong hover:bg-hover hover:text-fg"}`}>
        <Icon name={active ? "pause" : "run"} size={12} />
      </button>
    </Tip>
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
          {ACTIVE.has(run.state) && <ContextMenu.Item className={ITEM} onSelect={() => stopDialog.set(run)}><Icon name="pause" />Stop and seal…</ContextMenu.Item>}
          <ContextMenu.Item className={ITEM} onSelect={() => { select(id); showLineage(); requestFocus(id); }}><Icon name="locate" />Locate version in graph</ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => openSource(id)}><Icon name="file.python" />Open source</ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => void copyText(String(run.paper_id))}><Icon name="copy" />Copy run id</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** One run in the stack's list: its version, its return and how long it has run, its equity
 *  (`spark`) and its ⏸ or ▶; the run in front on the inactive selection. A sealed run's curve is quieter, and
 *  its ▶ shows only under the pointer or focus, so a pick does not start a run by a slip. */
export function RunRow({ run, on, now, spark, onPick }: { run: PaperRun; on: boolean; now: number; spark: ReactNode; onPick: () => void }) {
  const ret = returnOf(run);
  return (
    <RunMenu run={run}>
      <div role="option" aria-selected={on} tabIndex={0} onClick={onPick} onKeyDown={(e) => { if (e.key === "Enter") onPick(); }} title={`${run.candidate ?? ""} · run ${run.paper_id}`}
           className={`group/row grid h-12 shrink-0 cursor-default grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-card pl-3 pr-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${on ? "bg-selection-inactive" : "hover:bg-hover"}`}>
        <span className="flex min-w-0 flex-col gap-1">
          <RunName run={run} />
          <span className="flex min-w-0 gap-2 whitespace-nowrap text-small text-fg-muted">
            <span className={`shrink-0 tabular-nums ${pnlClass(ret)}`}>{signedPct(ret)}</span><span className="truncate"><State run={run} now={now} /></span>
          </span>
        </span>
        <span className={ACTIVE.has(run.state) ? "" : "opacity-45"}>{spark}</span>
        <span className={ACTIVE.has(run.state) ? "" : "opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"}>
          <RunButton run={run} filled={on} />
        </span>
      </div>
    </RunMenu>
  );
}
