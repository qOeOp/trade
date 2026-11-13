import { fixed } from "../../lib/paperApi";
import type { PaperRun } from "../../lib/paperApi";
import { clockTime, displayDay, zoneOffset, type TimeZone } from "../../lib/time";
import type { LiveRun } from "../../model/liveTrading";
import { away, lastFill, liveHeld, liveMoney, liveObserved, liveStatus, liveWorking, marked, paperEquity, paperHeld, paperIssues, stopFor, type Fill } from "../../model/phoneRuns";
import { Amount, Change, HeldLine, PhoneCard, PhoneNotice, Side } from "../../components/PhoneParts";
import { health } from "../../components/RunTile";
import { textClass } from "../../theme/roles";
import { useSnapshot } from "../../state/market";
import { openRun } from "../../state/phone";
import { useTimeZone } from "../../state/timeZone";
import { LossTrack } from "./LossTrack";
import { MISSING } from "../../lib/format";

export const clock = (ms: number, zone: TimeZone) => `${clockTime(ms, zone)} ${zoneOffset(ms, zone)}`;
/** A moment with its day (MM-DD) when it is not today's: 11-09 03:12 UTC. */
export const since = (ms: number, zone: TimeZone, now = Date.now()) =>
  displayDay(ms, zone) === displayDay(now, zone) ? clock(ms, zone) : `${displayDay(ms, zone).slice(5)} ${clock(ms, zone)}`;
/** A phrase whose words stay on one line: its spaces made non-breaking. */
export const keep = (text: string) => text.replace(/ /g, "\u00a0");
/** How long ago, in the largest whole unit: 12 s, 4 min, 3 h, 2 d. */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86_400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86_400)} d`;
}

/** A version's name, its revision faint, as the desktop's run picker writes it. */
export const Version = ({ name }: { name: string | null }) => {
  const [title = MISSING, revision] = (name ?? MISSING).split("@");
  return <span className="min-w-0 truncate font-semibold">{title}{revision && <span className="font-normal text-fg-faint">@{revision}</span>}</span>;
};

/** The last fill on one line: when, its side, size and price. */
export const FillLine = ({ fill, zone }: { fill: Fill; zone: TimeZone }) => (
  <p className="text-dense text-fg-muted">Last fill {clock(fill.ms, zone)} · <Side long={fill.buy} word={fill.buy === null ? undefined : fill.buy ? "Buy" : "Sell"} /> <span className="text-fg">{keep(`${fixed(fill.qty) ?? MISSING} @ ${fixed(fill.px) ?? MISSING}`)}</span></p>
);

/** A Live run left unresolved: what it left open and where to deal with it (the phone does not close it). */
export function UnresolvedNotice({ run }: { run: LiveRun }) {
  const held = liveHeld(run);
  return (
    <PhoneNotice tone="fail">
      Live run {run.candidate} is unresolved{held.length ? ` and left ${held.map((h) => `${h.symbol} ${h.long ? "long" : "short"} ${fixed(h.qty)}`).join(", ")} open` : ""}.
      Reconcile it on the desktop, or close it in the Binance app.
    </PhoneNotice>
  );
}

/** A held position's protection: its stop and how far it is from the mark, or that it has none. */
export function StopLine({ trigger, mark, ended }: { trigger: number | null | undefined; mark: number | null; ended: boolean }) {
  const gap = trigger == null ? null : away(trigger, mark);
  return <p className={`text-small ${trigger != null ? "text-fg-faint" : "text-fail-fg"}`}>{trigger != null ? `Stop ${fixed(trigger)}${gap !== null ? ` · ${(gap * 100).toFixed(1)}% away` : ""}` : "No protective stop"}{ended && " · left open at Binance"}</p>;
}

/** A Live run on the Runs tab: its state, the account now, the last fill, the loss threshold used, and what it holds
 *  with the stop protecting it. */
export function LiveCard({ run, now }: { run: LiveRun; now: number }) {
  const zone = useTimeZone(), coins = useSnapshot()?.coins, status = liveStatus(run), money = liveMoney(run), fill = lastFill(run);
  const held = marked(liveHeld(run), coins), working = liveWorking(run);
  const seen = liveObserved(run), ended = !run.running;
  return (
    <PhoneCard label={`Live run ${run.candidate}`} onClick={() => openRun({ kind: "live", id: run.id })}>
      <div className="space-y-1 px-3 pb-3 pt-2 pr-6">
        <p className="flex min-w-0 items-baseline gap-2 text-dense"><Version name={run.candidate} /><span className={`shrink-0 ${textClass(status.tone)}`}>{status.word}</span></p>
        <p className="truncate text-small text-fg-faint">Live · {run.symbols?.join(", ") ?? MISSING}{seen !== null && ` · ${ended ? `ended ${clock(seen, zone)}` : `observed ${ago(seen, now)} ago`}`}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1"><Amount value={money?.equity ?? null} /><Change amount={money?.result} ratio={money && money.result !== null ? money.result / money.start : null} /></p>
        {fill && <FillLine fill={fill} zone={zone} />}
      </div>
      {money && money.room !== null && run.running && <div className="border-t border-line px-3 py-2"><LossTrack money={money} /></div>}
      {held.map((h) => (
        <div key={h.key} className="space-y-0.5 border-t border-line px-3 py-2">
          <HeldLine held={h} />
          <StopLine trigger={stopFor(h, working)?.trigger} mark={h.mark} ended={ended} />
        </div>
      ))}
    </PhoneCard>
  );
}

/** A paper run on the Runs tab: its state, equity and return, what it holds and what needs a look. */
export function PaperCard({ run, now }: { run: PaperRun; now: number }) {
  const zone = useTimeZone(), h = health(run, now, zone), money = paperEquity(run), held = paperHeld(run), issues = paperIssues(run);
  const bar = run.live?.last_bar_ns != null ? run.live.last_bar_ns / 1e6 : null;
  return (
    <PhoneCard label={`Paper run ${run.paper_id}`} onClick={() => openRun({ kind: "paper", id: run.paper_id })}>
      <div className="space-y-1 px-3 pb-3 pt-2 pr-6">
        <p className="flex min-w-0 items-baseline gap-2 text-dense"><Version name={run.candidate} /><span className={`shrink-0 ${textClass(h.tone)}`}>{h.text}</span></p>
        <p className="truncate text-small text-fg-faint">Paper {run.paper_id} · {run.symbols.join(", ")}{bar !== null && ` · last bar ${clock(bar, zone)}`}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1"><Amount value={money.equity} size="medium" /><Change ratio={money.ret} /></p>
      </div>
      {(held.length > 0 || issues.length > 0) && (
        <div className="space-y-0.5 border-t border-line px-3 py-2">
          {held.map((p) => <HeldLine key={p.key} held={p} />)}
          {issues.length > 0 && <p className="text-small">{issues.map((i, k) => <span key={i.text} className={textClass(i.tone)}>{k ? " · " : ""}{i.text}</span>)}</p>}
        </div>
      )}
    </PhoneCard>
  );
}
