// The paper runs as the toolbar's run picker lists them, and the selected run's state in words.
import { useState, type KeyboardEvent } from "react";
import type { PaperRun, RuntimeFailure } from "../../lib/paperApi";
import { duration, plural } from "../../lib/format";
import { chainOf, chainStart, isContinued } from "../../model/chain";
import { health, RunRow, sealedOn } from "../../components/RunTile";
import { useNow } from "../../components/hooks/useNow";
import { TextButton } from "../../components/TextButton";
import { ACTIVE } from "../../state/paper";
import { tradesTab } from "../../state/paperStream";
import { exceptionsText, raised } from "./Exceptions";

const FIND = 8;  // a list longer than this opens with a box to find a version by name
export const alarming = (run: PaperRun, now: number) => { const h = health(run, now); return ACTIVE.has(run.state) && (h.late || h.tone === "fail"); };

/** How long ago the last bar closed, read every second: 12s, 3m. */
function Ago({ ns }: { ns: number }) {
  const s = Math.max(0, Math.round((useNow(1000) - ns / 1e6) / 1000));
  return <>{s < 90 ? `${s}s` : `${Math.round(s / 60)}m`}</>;
}

/** The selected run's state, in the toolbar after its readings: how long it has run (from its chain's first
 *  run, `chain`, oldest first) and when its last bar came, gaps in
 *  amber; or when it was sealed and how it ended. Exceptions the strategy raised lead in red, in the
 *  place of how long it has run (once sealed, of "invalid" when they are its one reason), and open the
 *  trades card's Exceptions. */
export function RunHealth({ run, chain, now, failures }: { run: PaperRun; chain: readonly PaperRun[]; now: number; failures: readonly RuntimeFailure[] | null }) {
  const state = health(run, now), lastBar = run.live?.last_bar_ns ?? null, started = chainStart(chain) ?? run.live?.started_ns ?? null;
  const gaps = (run.live?.missing_bars ?? 0) + (run.live?.protection_gaps ?? 0);
  const sealed = run.state === "sealed", n = failures?.length ? raised(failures) : sealed ? 0 : run.live?.exceptions ?? 0;
  // Sealed invalid for its exceptions alone, the count in red says why in the place of "invalid".
  const alone = sealed && n > 0 && String(run.seal?.reasons ?? run.reasons ?? []) === "RUNTIME_FAILURES";
  const raisedLink = n > 0 && <TextButton className={`-mx-1 underline underline-offset-3 ${sealed && !alone ? "text-fg-muted" : "text-fail"}`}
                                          onClick={() => tradesTab.set("exceptions")}>{exceptionsText(n, sealed)}</TextButton>;
  if (sealed) return <span>Sealed {sealedOn(run)} · {!alone && <><span className={state.tone === "fail" ? "text-fail" : ""}>{state.tone === "fail" ? "invalid" : "complete"}</span>{raisedLink && " · "}</>}{raisedLink}</span>;
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

/** Every run, running then sealed under a count each; past FIND runs a box finds one by name, Enter
 *  picks the first match, and ↑ ↓ move between rows. */
export function RunList({ order, runs: all, front, now, pick }: { order: readonly PaperRun[]; runs: readonly PaperRun[]; front: PaperRun; now: number; pick: (r: PaperRun) => void }) {
  const [query, setQuery] = useState("");
  const shown = order.filter((r) => (r.candidate ?? "").toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [["Running", shown.filter((r) => ACTIVE.has(r.state))], ["Sealed", shown.filter((r) => !ACTIVE.has(r.state))]] as const;
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=option]")], i = rows.indexOf(document.activeElement as HTMLElement);
    rows[e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
    e.preventDefault();
  };
  return (
    <div role="listbox" aria-label="Paper runs" onKeyDown={move} className="flex flex-col gap-px">
      {order.length > FIND && (
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a version" aria-label="Find a version"
               onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) pick(shown[0]); }}
               className="mb-1 h-8 shrink-0 rounded-control bg-frame px-2.5 text-dense text-fg outline-none placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-focus" />
      )}
      {groups.map(([name, runs]) => runs.length > 0 && (
        <div key={name} className="flex flex-col gap-px">
          <span className="sticky top-0 z-10 flex h-7 items-center bg-popup px-3 text-small text-fg-faint">{name} · {runs.length}</span>
          {runs.map((r) => <RunRow key={r.paper_id} run={r} chain={chainOf(r, all)} on={r.paper_id === front.paper_id} now={now} onPick={() => pick(r)} />)}
        </div>
      ))}
      {!shown.length && <p className="px-3 py-2 text-dense text-fg-faint">No version matches “{query.trim()}”</p>}
    </div>
  );
}

/** The runs in the picker's order: running ones (any in trouble first, else newest first), then sealed
 *  ones newest first; a run another continues after a restart (model/chain.ts) only through its chain's latest. */
export function runOrder(all: readonly PaperRun[], now: number): PaperRun[] {
  const runs = all.filter((r) => !isContinued(r, all)), active = runs.filter((r) => ACTIVE.has(r.state)).reverse();
  return [...active.filter((r) => alarming(r, now)), ...active.filter((r) => !alarming(r, now)), ...runs.filter((r) => !ACTIVE.has(r.state)).reverse()];
}
