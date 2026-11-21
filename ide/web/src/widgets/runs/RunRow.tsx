import type { ReactNode } from "react";
import type { PaperRun } from "../../lib/paperApi";
import { duration, plural, signedPct } from "../../lib/format";
import { ACTIVE, chainReturn, chainStart, chainTrades } from "../../model/chain";
import { heldOnInterruption, HELD_ON_RESTART, NO_RECOVERY, unprotected, unprotectedText, UNPROTECTED } from "../../model/recovery";
import { useTimeZone } from "../../state/timeZone";
import { dotClass, pnlClass, textClass } from "../../theme/roles";
import { HoverPanel, HoverTrigger } from "../../ui/HoverPanel";
import { Ended, health, RunMenu } from "./RunTile";

/** How the strategy stands, in a few words: running for how long (since its chain's first run), data late
 *  or failing in amber, or how and when it ended; a refused recovery in its own tone, as its dot. */
function Status({ run, chain, now }: { run: PaperRun; chain: readonly PaperRun[]; now: number }) {
  const zone = useTimeZone(), state = health(run, now, zone), started = chainStart(chain) ?? run.readings?.started_ns ?? null;
  if (run.recovery) return <span className={`truncate ${textClass(state.tone)}`}>{state.text}</span>;
  if (state.late || (run.state !== "sealed" && state.tone === "fail")) return <span className="truncate text-misses-fg">{state.text}</span>;
  if (run.state === "sealed") return <span className="truncate"><Ended run={run} /></span>;
  if (run.state !== "running" || started === null || run.readings?.last_bar_ns == null) return <span className="truncate">{state.text}</span>;
  return <span className="truncate">Running {duration(now - started / 1e6)}</span>;
}

/** One strategy in the run picker's list: its version and its return, a dot in the state's colour, how it
 *  stands and how many trades it has closed, the return and trades once it has a reading. `run` is the run
 *  that stands for it (its latest that started) and `chain` that run's chain. Its record (`history`: every run, stop and failed start) opens beside the list
 *  on hover or keyboard focus, never over it (narrower where the window leaves less room). The run shown is on the inactive selection; its actions are on right-click (RunMenu). */
export function RunRow({ run, chain, on, now, note, onPick, history }: {
  run: PaperRun; chain: readonly PaperRun[]; on: boolean; now: number; note?: string; onPick: () => void; history?: ReactNode;
}) {
  const zone = useTimeZone();
  const [name, revision] = (run.candidate ?? "").split("@"), ret = chainReturn(chain), trades = chainTrades(chain), tone = health(run, now, zone).tone;
  const row = (
    <div role="option" aria-selected={on} tabIndex={0} onClick={onPick} onKeyDown={(e) => { if (e.key === "Enter") onPick(); }}
         className={`flex shrink-0 cursor-default items-center gap-2 rounded-card px-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus h-12 ${on ? "bg-selection-inactive" : "hover:bg-hover"}`}>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="flex min-w-0 items-baseline gap-3">
          <span className={`flex min-w-0 flex-1 font-mono text-dense ${ACTIVE.has(run.state) ? "text-fg" : "text-fg-muted"}`}>
            {name ? <><span className="truncate">{name}</span><span className="shrink-0 text-fg-faint">@{revision}</span></> : <span className="truncate font-sans text-fg-faint">No version declared</span>}
          </span>
          {ret !== null && <span className={`shrink-0 text-small tabular-nums ${pnlClass(ret)}`}>{signedPct(ret)}</span>}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-small text-fg-muted">
          <i aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dotClass(tone)}`} />
          <span className="flex min-w-0 max-w-[60%] shrink-0"><Status run={run} chain={chain} now={now} /></span>
          {trades !== null && <span className="shrink-0 tabular-nums">· {plural(trades, "trade")}</span>}
          {heldOnInterruption(run) && <span className="shrink-0 text-misses-fg" title={NO_RECOVERY}>· {HELD_ON_RESTART}</span>}
          {unprotected(run).length > 0 && <span className="shrink-0 text-fail-fg" title={unprotectedText(unprotected(run))}>· {UNPROTECTED}</span>}
          {note && <span className="min-w-0 shrink-[100] truncate text-fg-faint">· {note}</span>}
        </span>
      </span>
    </div>
  );
  if (!history) return <RunMenu run={run}>{row}</RunMenu>;
  return <HoverPanel panel={history}><RunMenu run={run}><HoverTrigger>{row}</HoverTrigger></RunMenu></HoverPanel>;
}
