// A strategy's paper record beside its row in the run picker (components/RunRow.tsx): every run it had, how
// long each stop lasted and why, and the starts that failed, newest first (model/paperHistory.ts).
import type { ReactNode } from "react";
import type { PaperRun } from "../../lib/paperApi";
import { brief, duration, plural } from "../../lib/format";
import { clockTime, dateTime, displayDay } from "../../lib/time";
import { contracts } from "../../model/stage";
import { createdNs, isContinued } from "../../model/chain";
import { ending } from "../../model/ending";
import { historyOf, startedMs, type Step } from "../../model/paperHistory";
import { health } from "../../components/RunTile";
import { TextButton } from "../../components/TextButton";
import { usePhone } from "../../state/phone";
import { useTimeZone } from "../../state/timeZone";


/** A step's mark on the timeline's rail: a dot for a run (filled while it runs), a dash for a stop. */
function Rail({ kind, live, last }: { kind: Step["kind"]; live?: boolean; last: boolean }) {
  return (
    <span aria-hidden="true" className="relative flex w-3 shrink-0 justify-center">
      {!last && <span className="absolute bottom-0 top-3 w-px bg-line-strong" />}
      {kind === "run" ? <i className={`relative mt-1.5 size-2 rounded-full border-[1.5px] ${live ? "border-meets bg-meets" : "border-fg-faint bg-popup"}`} />
        : kind === "unstarted" ? <i className="relative mt-1.5 size-2 rounded-full border-[1.5px] border-misses bg-popup" />
        : <i className="relative mt-2 h-px w-2 bg-fg-faint" />}
    </span>
  );
}

/** `runs`: the strategy's runs, oldest first; `all`: the whole listing; `pick` shows one of them (only a
 *  chain's latest run links: an earlier one shows as its chain, model/stage.ts). Times on the
 *  timeline are short (no year in the current one, the zone once, in the header). On a phone it opens under
 *  the strategy's own row, so it leaves the name out. */
export function PaperHistory({ runs, all, now, pick }: { runs: readonly PaperRun[]; all: readonly PaperRun[]; now: number; pick: (run: PaperRun) => void }) {
  const zone = useTimeZone(), phone = usePhone(), year = displayDay(now, zone).slice(0, 5);
  const at = (ms: number | null) => { if (ms === null) return "?"; const day = displayDay(ms, zone); return `${day.startsWith(year) ? day.slice(5) : day} ${clockTime(ms, zone)}`; };
  const h = historyOf(runs, all), head = runs[runs.length - 1]!, [name, revision] = (head.candidate ?? "").split("@");
  const since = startedMs(runs[0]!) ?? createdNs(runs[0]!) / 1e6;
  const facts = [plural(h.runs, "run"), h.failed && `${plural(h.failed, "start")} failed`, h.stops && `stopped ${h.stops === 1 ? "once" : `${h.stops} times`}`,
    h.paused && `paused ${brief(h.paused)}`, h.offline && `offline ${brief(h.offline)}`].filter(Boolean);
  const failed = (run: PaperRun) => <span className="block text-small text-misses">Run {run.paper_id} · {ending(run).text} · {at(createdNs(run) / 1e6)}</span>;
  const line = (step: Step): ReactNode => {
    if (step.kind === "run") {
      const span = step.from === null ? null : (step.to ?? now) - step.from;
      return <>
        {isContinued(step.run, all) ? <span>Run {step.run.paper_id}</span> : <TextButton className="-mx-1 text-fg!" onClick={() => pick(step.run)}>Run {step.run.paper_id}</TextButton>}
        <span className="block text-small tabular-nums text-fg-muted">{at(step.from)} → {step.to !== null ? at(step.to) : step.run.state === "running" ? "now" : health(step.run, now, zone).text}{span !== null && ` · ${duration(span)}`}</span>
        {step.end && step === h.steps[0] && <span className="block text-small text-fg-faint">{step.end.text}</span>}
      </>;
    }
    if (step.kind === "unstarted") return failed(step.run);
    return <>
      <span className="block text-small text-fg-muted">
        {step.gap === "idle" ? "New account" : step.gap === "paused" ? "Paused" : "Offline"}{step.ms !== null && ` ${step.gap === "idle" ? "after " : ""}${brief(step.ms)}`}
        <span className="text-fg-faint"> · {step.lead}</span>
      </span>
      {step.failed.map((r) => <span key={r.paper_id}>{failed(r)}</span>)}
    </>;
  };
  return (
    <div className="min-w-0 text-dense">
      {!phone && <p className="flex min-w-0 font-mono font-semibold"><span className="truncate">{name || "No version declared"}</span>{revision && <span className="shrink-0 font-normal text-fg-faint">@{revision}</span>}</p>}
      <p className="mt-0.5 text-small text-fg-faint">{contracts(head.symbols)}{` · since ${dateTime(since, zone, "minute")}`}</p>
      <p className="mt-2 text-small text-fg-muted">{facts.join(" · ")}</p>
      <ol className="mt-3 flex flex-col">
        {h.steps.map((step, k) => (
          <li key={k} className="flex gap-2 pb-2 last:pb-0">
            <Rail kind={step.kind} live={step.kind === "run" && step.run.state === "running"} last={k === h.steps.length - 1} />
            <span className="min-w-0 flex-1">{line(step)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
