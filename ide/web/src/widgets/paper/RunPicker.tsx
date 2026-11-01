// The paper runs as the toolbar's run picker lists them, and the shown run's state in words.
import { useState, type KeyboardEvent } from "react";
import type { PaperRun, RuntimeFailure } from "../../lib/paperApi";
import { duration, plural } from "../../lib/format";
import { ACTIVE, chainOf, chainStart, isContinued } from "../../model/chain";
import { Ended, health, RunRow } from "../../components/RunTile";
import { useNow } from "../../components/hooks/useNow";
import { TextButton } from "../../components/TextButton";
import { lineOf } from "../../lib/lines";
import { useResearchLines } from "../../state/researchLines";
import { isKnown } from "../../state/selection";
import { tradesTab } from "../../state/paperStream";
import { exceptionsText, raised } from "./Exceptions";

const FIND = 8;  // a list longer than this opens with a box to find a version by name
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
  const state = health(run, now), lastBar = run.live?.last_bar_ns ?? null, started = chainStart(chain) ?? run.live?.started_ns ?? null;
  const gaps = (run.live?.missing_bars ?? 0) + (run.live?.protection_gaps ?? 0);
  const sealed = run.state === "sealed", n = failures?.length ? raised(failures) : sealed ? 0 : run.live?.exceptions ?? 0;
  const raisedLink = n > 0 && <TextButton className="-mx-1 text-misses underline underline-offset-3" onClick={() => tradesTab.set("exceptions")}>{exceptionsText(n, sealed)}</TextButton>;
  if (sealed) return <Ended run={run} errors={raisedLink || undefined} />;
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

// Why a run is in no version's group; one of another line names it, and picking it opens that line.
const UNATTRIBUTED = { none: "No version declared", other: "Not a version of this line" };
const versionOf = (r: PaperRun) => (r.candidate !== null && isKnown(r.candidate) ? r.candidate : null);

/** Every run under its version and a count, the versions with a run running first, then the one run
 *  latest; runs that declare no version of this line last, under Unattributed, each saying why (or which line
 *  its version is on). Past
 *  FIND runs a box finds one by name, Enter picks the first match, and ↑ ↓ move between rows. */
export function RunList({ order, runs: all, front, now, pick }: { order: readonly PaperRun[]; runs: readonly PaperRun[]; front: PaperRun | null; now: number; pick: (r: PaperRun) => void }) {
  const [query, setQuery] = useState("");
  const { lines } = useResearchLines();
  const why = (r: PaperRun) => {
    const line = r.candidate === null ? null : lineOf(lines, r.candidate);
    return r.candidate === null ? UNATTRIBUTED.none : line ? `On ${line.bundle.replace(/^research-line-/, "")}` : UNATTRIBUTED.other;
  };
  const shown = order.filter((r) => (r.candidate ?? "").toLowerCase().includes(query.trim().toLowerCase()));
  const by = new Map<string | null, PaperRun[]>();
  for (const r of shown) by.set(versionOf(r), [...(by.get(versionOf(r)) ?? []), r]);
  const last = (runs: readonly PaperRun[]) => Math.max(...runs.map((r) => r.paper_id));
  const groups = [...by].filter(([v]) => v !== null).sort(([, a], [, b]) =>
    Number(b.some((r) => ACTIVE.has(r.state))) - Number(a.some((r) => ACTIVE.has(r.state))) || last(b) - last(a));
  const loose = by.get(null) ?? [];
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=option]")], i = rows.indexOf(document.activeElement as HTMLElement);
    rows[e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
    e.preventDefault();
  };
  const row = (r: PaperRun, note?: string) => <RunRow key={r.paper_id} run={r} chain={chainOf(r, all)} on={r.paper_id === front?.paper_id} now={now} note={note} onPick={() => pick(r)} />;
  const head = (name: string, n: number, mono = false) => (
    <span className="sticky top-0 z-10 flex h-7 min-w-0 items-center gap-1 bg-popup px-3 text-small text-fg-faint"><span className={`truncate ${mono ? "font-mono" : ""}`}>{name}</span><span className="shrink-0">· {n}</span></span>
  );
  return (
    <div role="listbox" aria-label="Paper runs" onKeyDown={move} className="flex flex-col gap-px">
      {order.length > FIND && (
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a version" aria-label="Find a version"
               onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) pick(shown[0]); }}
               className="mb-1 h-8 shrink-0 rounded-control bg-frame px-2.5 text-dense text-fg outline-none placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-focus" />
      )}
      {groups.map(([version, runs]) => <div key={version} className="flex flex-col gap-px">{head(version!, runs.length, true)}{runs.map((r) => row(r))}</div>)}
      {loose.length > 0 && <div className="flex flex-col gap-px">{head("Unattributed", loose.length)}{loose.map((r) => row(r, why(r)))}</div>}
      {!shown.length && <p className="px-3 py-2 text-dense text-fg-faint">No version matches “{query.trim()}”</p>}
    </div>
  );
}

/** The runs in the picker's order: running ones (any in trouble first, else newest first), then sealed
 *  ones newest first; a run another continues (model/chain.ts) only through its chain's latest. */
export function runOrder(all: readonly PaperRun[], now: number): PaperRun[] {
  const runs = all.filter((r) => !isContinued(r, all)), active = runs.filter((r) => ACTIVE.has(r.state)).reverse();
  return [...active.filter((r) => alarming(r, now)), ...active.filter((r) => !alarming(r, now)), ...runs.filter((r) => !ACTIVE.has(r.state)).reverse()];
}
