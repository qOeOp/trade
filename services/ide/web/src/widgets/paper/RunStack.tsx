import { useState, type KeyboardEvent, type ReactNode } from "react";
import { fixed, type PaperRun } from "../../lib/paperApi";
import { plural } from "../../lib/format";
import type { Account } from "../../model/account";
import { age, health, returnOf, RunButton, RunMenu, RunName, RunRow, sealedOn, signedPct } from "../../components/RunTile";
import { Stack } from "../../components/Stack";
import { useNow } from "../../components/hooks/useNow";
import { ACTIVE, paperTab, selectedRun } from "../../state/paper";
import { pnlClass } from "../../theme/roles";
import { Sparkline } from "./Sparkline";

const FIND = 8;  // a list longer than this opens with a box to find a version by name
const alarming = (run: PaperRun, now: number) => { const h = health(run, now); return ACTIVE.has(run.state) && (h.late || h.tone === "fail"); };

/** A run's curve: a running run's equity by the minute, a sealed one's compounded daily returns. */
function Curve({ run, large = false }: { run: PaperRun; large?: boolean }) {
  const ret = run.state === "sealed" ? run.seal?.total_return ?? null : run.live?.total_return ?? null;
  const tone = ret == null || ret === 0 ? "fg-muted" : ret > 0 ? "pnl-up" : "pnl-down";
  let path: [number, number][], starting = 1;
  if (run.live) { path = run.live.equity; starting = Number(run.live.starting_balance_usdt) || 100_000; }
  else {
    let value = 1;
    path = [[run.seal?.started_ns ?? 0, 1], ...(run.seal?.daily_returns ?? []).map(([day, r]) => [Date.parse(`${day}T23:59:59Z`) * 1e6, (value *= 1 + r)] as [number, number])];
  }
  return <Sparkline path={path} starting={starting} live={run.state === "running"} tone={tone} large={large} />;
}

/** How long ago the last bar closed, read every second: 12s, 3m. */
function Ago({ ns }: { ns: number }) {
  const s = Math.max(0, Math.round((useNow(1000) - ns / 1e6) / 1000));
  return <>{s < 90 ? `${s}s` : `${Math.round(s / 60)}m`}</>;
}

/** The front run's state at the card's foot: how long it has run and when its last bar came, gaps in
 *  amber; or when it was sealed and how it ended. */
function Health({ run, now }: { run: PaperRun; now: number }) {
  const state = health(run, now), lastBar = run.live?.last_bar_ns ?? null, started = run.live?.started_ns ?? null;
  const gaps = (run.live?.missing_bars ?? 0) + (run.live?.protection_gaps ?? 0);
  if (run.state === "sealed") return <span>Sealed {sealedOn(run)} · <span className={state.tone === "fail" ? "text-fail" : ""}>{state.tone === "fail" ? "invalid" : "complete"}</span></span>;
  if (run.state !== "running" || state.late) return <span className={state.tone === "fail" ? "text-fail" : "text-misses"}>{state.text}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
      {gaps > 0 && <span className="text-misses">{plural(gaps, run.live?.missing_bars ? "missing bar" : "protection gap")} ·</span>}
      {started !== null && <span>{age(now - started / 1e6)} ·</span>}
      {lastBar === null ? "waiting for a bar" : <><i className="size-1.5 shrink-0 rounded-full bg-meets" />last bar <Ago ns={lastBar} /> ago</>}
    </span>
  );
}

/** The run in front: at the left its version, its equity as the one large figure (cents faint) and its
 *  return since the start; its curve filling the right; and a foot line of small print, its state at
 *  the left and the stack's pager and the run's ⏸ at the right. The name gives way to the figure's
 *  width and is cut there, so the curve keeps its room. */
function Front({ run, a, now, pager }: { run: PaperRun; a: Account | null; now: number; pager: ReactNode }) {
  const [whole = "", cents = ""] = (a?.equity == null ? "" : fixed(a.equity, 2) ?? "").split(".");
  const ret = returnOf(run);
  return (
    <RunMenu run={run}>
      <div className="flex flex-col gap-2 pb-2.5 pl-5 pr-4 pt-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 pr-1">
          <span className="flex flex-col gap-1">
            <span className="w-0 min-w-full"><RunName run={run} strong /></span>
            <span className="whitespace-nowrap text-figure tabular-nums tracking-[-0.02em] text-fg">
              {whole || "-"}{cents && <span className="text-fg-faint">.{cents}</span>}<span className="ml-1.5 text-dense tracking-normal text-fg-faint">USDT</span>
            </span>
            <span className={`text-dense tabular-nums ${pnlClass(ret)}`}>{ret == null ? "\u00a0" : signedPct(ret)}</span>
          </span>
          <span className={`min-h-16 py-1 ${ACTIVE.has(run.state) ? "" : "opacity-45"}`}><Curve run={run} large /></span>
        </div>
        <div className="flex h-7 items-center gap-1.5 whitespace-nowrap text-small text-fg-muted">
          <span className="mr-auto min-w-0 truncate"><Health run={run} now={now} /></span>
          {pager}<RunButton run={run} />
        </div>
      </div>
    </RunMenu>
  );
}

/** Every run, running then sealed under a count each; past FIND runs a box finds one by name, Enter
 *  picks the first match, and ↑ ↓ move between rows. */
function RunList({ order, front, now, pick }: { order: readonly PaperRun[]; front: PaperRun; now: number; pick: (r: PaperRun) => void }) {
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
          {runs.map((r) => <RunRow key={r.paper_id} run={r} on={r.paper_id === front.paper_id} now={now} spark={<Curve run={r} />} onPick={() => pick(r)} />)}
        </div>
      ))}
      {!shown.length && <p className="px-3 py-2 text-dense text-fg-faint">No version matches “{query.trim()}”</p>}
    </div>
  );
}

/** The paper runs as a stack above Performance: the selected run in front, then running ones (any in
 *  trouble first, else newest first) and sealed ones newest first; a swipe turns through them and
 *  "2 of 5" lists them all. */
export function RunStack({ runs, selected, a }: { runs: readonly PaperRun[]; selected: number; a: Account | null }) {
  const now = useNow();
  const active = runs.filter((r) => ACTIVE.has(r.state)).reverse();
  const order = [...active.filter((r) => alarming(r, now)), ...active.filter((r) => !alarming(r, now)), ...runs.filter((r) => !ACTIVE.has(r.state)).reverse()];
  const at = Math.max(0, order.findIndex((r) => r.paper_id === selected));
  const pick = (r: PaperRun) => { if (r.paper_id !== selected) { selectedRun.set(r.paper_id); paperTab.set(null); } };
  const run = order[at];
  if (!run) return null;
  const alarm = order.find((r) => r !== run && alarming(r, now)), trouble = alarm && health(alarm, now);
  return (
    <Stack count={order.length} at={at} onAt={(i) => pick(order[i]!)} label="Paper runs"
           badge={trouble && <i className={`size-1.5 rounded-full ${trouble.tone === "fail" ? "bg-fail" : "bg-misses"}`} />}
           hint={trouble ? `${alarm.candidate ?? ""} · ${trouble.text}` : undefined}
           front={(pager) => <Front run={run} a={a} now={now} pager={pager} />}
           list={(close) => <RunList order={order} front={run} now={now} pick={(r) => { pick(r); close(); }} />} />
  );
}
