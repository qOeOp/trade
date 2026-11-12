import { useState, type ReactNode } from "react";
import { HoverCard } from "radix-ui";
import type { PaperRun } from "../lib/paperApi";
import { duration, plural } from "../lib/format";
import { ACTIVE, chainReturn, chainStart, chainTrades } from "../model/chain";
import { usePhone } from "../state/phone";
import { useTimeZone } from "../state/timeZone";
import { pnlClass, type DataRole } from "../theme/roles";
import { IconButton } from "./IconButton";
import { Ended, health, RunMenu, signedPct } from "./RunTile";

const DOT: Record<DataRole, string> = { recommended: "bg-recommended", meets: "bg-meets", misses: "bg-misses", fail: "bg-fail", masked: "bg-masked" };

/** How the strategy stands, in a few words: running for how long (since its chain's first run), data late
 *  or failing in amber, or how and when it ended. */
function Status({ run, chain, now }: { run: PaperRun; chain: readonly PaperRun[]; now: number }) {
  const zone = useTimeZone(), state = health(run, now, zone), started = chainStart(chain) ?? run.live?.started_ns ?? null;
  if (state.late || (run.state !== "sealed" && state.tone === "fail")) return <span className="truncate text-misses-fg">{state.text}</span>;
  if (run.state === "sealed") return <span className="truncate"><Ended run={run} /></span>;
  if (run.state !== "running" || started === null || run.live?.last_bar_ns == null) return <span className="truncate">{state.text}</span>;
  return <span className="truncate">Running {duration(now - started / 1e6)}</span>;
}

/** One strategy in the run picker's list: its version and its return, a dot in the state's colour, how it
 *  stands and how many trades it has closed, the return and trades once it has a reading. `run` is the run
 *  that stands for it (its latest that started) and `chain` that run's chain. Its record (`history`: every run, stop and failed start) opens beside the list
 *  on hover or keyboard focus, never over it (narrower where the window leaves less room); a phone, which has no hover, opens it under the row from a
 *  button. The run shown is on the inactive selection; its actions are on right-click (RunMenu). */
export function RunRow({ run, chain = [run], on, now, note, onPick, history }: {
  run: PaperRun; chain?: readonly PaperRun[]; on: boolean; now: number; note?: string; onPick: () => void; history?: ReactNode;
}) {
  const phone = usePhone(), zone = useTimeZone(), [open, setOpen] = useState(false);
  const [name, revision] = (run.candidate ?? "").split("@"), ret = chainReturn(chain), trades = chainTrades(chain), tone = health(run, now, zone).tone;
  const row = (
    <div role="option" aria-selected={on} tabIndex={0} onClick={onPick} onKeyDown={(e) => { if (e.key === "Enter") onPick(); }}
         className={`flex shrink-0 cursor-default items-center gap-2 rounded-card px-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${phone ? "min-h-12 py-1.5" : "h-12"} ${on ? "bg-selection-inactive" : "hover:bg-hover"}`}>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="flex min-w-0 items-baseline gap-3">
          <span className={`flex min-w-0 flex-1 font-mono text-dense ${ACTIVE.has(run.state) ? "text-fg" : "text-fg-muted"}`}>
            {name ? <><span className="truncate">{name}</span><span className="shrink-0 text-fg-faint">@{revision}</span></> : <span className="truncate font-sans text-fg-faint">No version declared</span>}
          </span>
          {ret !== null && <span className={`shrink-0 text-small tabular-nums ${pnlClass(ret)}`}>{signedPct(ret)}</span>}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-small text-fg-muted">
          <i aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
          <span className="flex min-w-0 max-w-[60%] shrink-0"><Status run={run} chain={chain} now={now} /></span>
          {trades !== null && <span className="shrink-0 tabular-nums">· {plural(trades, "trade")}</span>}
          {note && <span className="min-w-0 shrink-[100] truncate text-fg-faint">· {note}</span>}
        </span>
      </span>
      {phone && history && <IconButton icon="history" label={open ? "Hide history" : "Show history"} aria-pressed={undefined} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onKeyDown={(e) => e.stopPropagation()} />}
    </div>
  );
  if (phone) return <div><RunMenu run={run}>{row}</RunMenu>{open && history && <div className="mx-1 mb-1 rounded-card bg-hover px-2 py-2">{history}</div>}</div>;
  if (!history) return <RunMenu run={run}>{row}</RunMenu>;
  return (
    <HoverCard.Root openDelay={250} closeDelay={120}>
      <RunMenu run={run}><HoverCard.Trigger asChild>{row}</HoverCard.Trigger></RunMenu>
      <HoverCard.Portal>
        <HoverCard.Content side="right" align="start" sideOffset={12} collisionPadding={8} avoidCollisions={false}
          className="enter z-50 w-[min(20rem,var(--radix-hover-card-content-available-width))] max-h-(--radix-hover-card-content-available-height) overflow-auto rounded-popup border border-popup-border bg-popup p-3 shadow-popup outline-none">
          {history}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
