import { useTimeZone } from "../../state/timeZone";
// The paper runs as the toolbar's run picker lists them, and the shown run's state in words.
import type { KeyboardEvent } from "react";
import type { PaperRun, RuntimeFailure } from "../../lib/paperApi";
import { duration, plural } from "../../lib/format";
import { waitingText, waitingUntil } from "../../model/observation";
import { ACTIVE, chainOf, chainStart } from "../../model/chain";
import { contracts } from "../../model/stage";
import { rowShows, strategyKey, strategyRows, strategyRuns } from "../../model/paperHistory";
import { Ended, health } from "../../components/RunTile";
import { RunRow } from "../../components/RunRow";
import { PaperHistory } from "./PaperHistory";
import { useNow } from "../../components/hooks/useNow";
import { TextButton } from "../../components/TextButton";
import { lineOf } from "../../lib/lines";
import { useResearchLines } from "../../state/researchLines";
import { isKnown } from "../../state/selection";
import { tradesTab } from "../../state/paperStream";
import { exceptionsText, raised } from "./Exceptions";

export const alarming = (run: PaperRun, now: number) => { const h = health(run, now); return ACTIVE.has(run.state) && (h.late || h.tone === "fail"); };

/** How long ago the last bar closed, read every second: 12s, 3m. */
function Ago({ ns }: { ns: number }) {
  const s = Math.max(0, Math.round((useNow(1000) - ns / 1e6) / 1000));
  return <>{s < 90 ? `${s}s` : `${Math.round(s / 60)}m`}</>;
}

/** The shown run's state, in the toolbar after its readings: how long it has run (from its chain's first
 *  run, `chain`, oldest first) and when its last bar came, gaps in amber; or how and when it ended. The
 *  errors the strategy raised show in the warning tone, leading in the place of how long it has run or
 *  following how it ended, and open the Trades window's Exceptions. */
export function RunHealth({ run, chain, now, failures }: { run: PaperRun; chain: readonly PaperRun[]; now: number; failures: readonly RuntimeFailure[] | null }) {
  const zone = useTimeZone();
  const state = health(run, now, zone), lastBar = run.live?.last_bar_ns ?? null, started = chainStart(chain) ?? run.live?.started_ns ?? null;
  const gaps = (run.live?.missing_bars ?? 0) + (run.live?.protection_gaps ?? 0);
  const sealed = run.state === "sealed", n = failures?.length ? raised(failures) : sealed ? 0 : run.live?.exceptions ?? 0;
  const raisedLink = n > 0 && <TextButton className="-mx-1 text-misses! underline underline-offset-3" onClick={() => tradesTab.set("exceptions")}>{exceptionsText(n, sealed)}</TextButton>;
  if (sealed) return <Ended run={run} errors={raisedLink || undefined} />;
  const until = waitingUntil(run);
  if (until !== null) return <span className="text-misses">{raisedLink && <>{raisedLink} · </>}{waitingText(until, now, zone)}</span>;
  if (run.state !== "running" || state.late) return <span className={state.tone === "fail" ? "text-fail" : "text-misses"}>{raisedLink && <>{raisedLink} · </>}{state.text}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
      {raisedLink && <span>{raisedLink} ·</span>}
      {gaps > 0 && <span className="text-misses">{plural(gaps, run.live?.missing_bars ? "missing bar" : "protection gap")} ·</span>}
      {started !== null && !raisedLink && <span>{duration(now - started / 1e6)} ·</span>}
      {lastBar === null ? "waiting for a bar" : <><i className="size-1.5 shrink-0 rounded-full bg-meets" />last bar <Ago ns={lastBar} /> ago</>}
    </span>
  );
}

// Why a run of no version on this line is listed; one of another line names it, and picking it opens that line.
const OTHER_LINE = "Not a version of this line";

/** Every strategy in the caller's `order`, one row each, its version naming it (RunRow) and its record of
 *  runs, stops and failed starts beside it (PaperHistory); its contracts too where its version runs on other
 *  contracts as well; a strategy whose version is not on this line says which line it is on; only those whose
 *  version or the number of one of its runs holds the caller's `query`, picking that run when the query is its number.
 *  ↑ ↓ move between rows. `anyLine`: no line is named (a phone's list, which draws no line). */
export function RunList({ order, runs: all, front, now, pick, query, anyLine = false }: { order: readonly PaperRun[]; runs: readonly PaperRun[]; front: PaperRun | null; now: number; pick: (r: PaperRun) => void; query: string; anyLine?: boolean }) {
  const { lines } = useResearchLines();
  const note = (r: PaperRun) => {
    const twin = order.some((o) => o.candidate === r.candidate && strategyKey(o) !== strategyKey(r)) ? contracts(r.symbols) : null;
    if (r.candidate === null || anyLine || isKnown(r.candidate)) return twin ?? undefined;
    const line = lineOf(lines, r.candidate), on = line ? `On ${line.bundle.replace(/^research-line-/, "")}` : OTHER_LINE;
    return twin ? `${twin} · ${on}` : on;
  };
  const q = query.trim().toLowerCase();
  const shown = order.filter((r) => `${r.candidate ?? ""} ${strategyRuns(r, all).map((s) => s.paper_id).join(" ")}`.toLowerCase().includes(q));
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=option]")], i = rows.indexOf(document.activeElement as HTMLElement);
    rows[e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
    e.preventDefault();
  };
  return (
    <div role="listbox" aria-label="Paper runs" onKeyDown={move} className="flex flex-col gap-px">
      {shown.map((r) => {
        const runs = strategyRuns(r, all), exact = runs.find((s) => String(s.paper_id) === q);
        return <RunRow key={r.paper_id} run={r} chain={chainOf(r, all)} on={rowShows(r, front, all)} now={now} note={note(r)}
          onPick={() => pick(exact ?? r)} history={<PaperHistory runs={runs} all={all} now={now} pick={pick} />} />;
      })}
      {!shown.length && <p className="px-3 py-2 text-dense text-fg-faint">No paper run matches</p>}
    </div>
  );
}

/** The strategies in the picker's order, each through the run that stands for it, and the runs of one not
 *  sealed yet beside it (model/paperHistory.ts strategyRows): running ones (any in trouble first, else newest
 *  first), then stopped ones newest first. */
export function runOrder(all: readonly PaperRun[], now: number): PaperRun[] {
  const runs = strategyRows(all), active = runs.filter((r) => ACTIVE.has(r.state)).reverse();
  return [...active.filter((r) => alarming(r, now)), ...active.filter((r) => !alarming(r, now)), ...runs.filter((r) => !ACTIVE.has(r.state)).reverse()];
}
