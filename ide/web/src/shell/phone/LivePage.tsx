import { useEffect, useMemo, useState } from "react";
import { PhonePage } from "../../components/PhoneBar";
import { Amount, Change, PhoneHeading, PhoneTable, Side } from "../../components/PhoneParts";
import { FormButton } from "../../components/chat/Field";
import { useNow } from "../../components/hooks/useNow";
import { fixed, signed } from "../../lib/paperApi";
import { nsMilliseconds } from "../../lib/time";
import { lastFill, liveHeld, liveMoney, liveObserved, liveStatus, liveWorking, marked, stopFor, stopRequested } from "../../model/phoneRuns";
import { useLiveTrading } from "../../state/liveTrading";
import { useSnapshot } from "../../state/market";
import { closeRun } from "../../state/phone";
import { useTimeZone } from "../../state/timeZone";
import { pnlClass, textClass } from "../../theme/roles";
import { EquityLine, type Level } from "../../widgets/phone/EquityLine";
import { LossTrack } from "./LossTrack";
import { ago, clock, FillLine, keep, since, StopLine, UnresolvedNotice, Version } from "./RunCards";
import { PhoneTop } from "./PhoneTop";
import { StopSheet } from "./StopSheet";

/** A Live run's page: the account now and its line against the budget and the loss threshold, the loss used, what it
 *  holds and its working orders as their native events last say, a few facts, and Request stop… at the foot, which
 *  asks first (StopSheet). Nothing else here sends anything to Live. */
export function LivePage({ id }: { id: string }) {
  const { view, actions } = useLiveTrading(), coins = useSnapshot()?.coins, zone = useTimeZone(), now = useNow(5000), [stopping, setStopping] = useState(false);
  const run = view.runs.find((r) => r.id === id) ?? null;
  useEffect(() => { if (run && actions.inspect) void actions.inspect(run.id); }, [run?.id, actions.inspect]);
  const money = run ? liveMoney(run) : null;
  const points = useMemo(() => (run?.equity?.minutes ?? []).flatMap(([t, v]) => (v === null ? [] : [[t, v] as const])), [run?.equity]);
  const levels = useMemo<Level[]>(() => money ? [{ value: money.start, title: "Start" }, ...(money.stopsAt !== null ? [{ value: money.stopsAt, title: "Drawdown brake", loss: true }] : [])] : [], [money?.start, money?.stopsAt]);
  const back = { label: "Runs", onClick: closeRun };
  if (!run) return <><PhoneTop back={back} aside="Live" /><p className="p-4 text-dense text-fg-faint">{view.availability === "unavailable" ? "Live is not answering." : "This Live run is not listed by Live."}</p></>;
  const status = liveStatus(run), fill = lastFill(run), held = marked(liveHeld(run), coins), working = liveWorking(run), seen = liveObserved(run);
  const first = points[0]?.[0], fills = (run.orders ?? []).filter((o) => o.event_type === "OrderFilled").length;
  const sent = nsMilliseconds(view.notify?.lastSentNs), check = run.accountCheck;
  return (
    <>
      <PhoneTop back={back} aside="Live" />
      <PhonePage>
        {status.word === "Unresolved" && <div className="px-3 pt-3"><UnresolvedNotice run={run} /></div>}
        <div className="space-y-1 px-3 pt-3">
          <p className="flex min-w-0 items-baseline gap-2 text-dense"><Version name={run.candidate} /><span className={`shrink-0 ${textClass(status.tone)}`}>{status.word}</span></p>
          <p className="text-small text-fg-faint">{run.symbols?.join(", ") ?? "–"}{first !== undefined && ` · since ${since(first * 1000, zone, now)}`}{seen !== null && ` · ${keep(`observed ${ago(seen, now)} ago`)}`}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1"><Amount value={money?.equity ?? null} /><Change amount={money?.result} ratio={money && money.result !== null ? money.result / money.start : null} /></p>
          {fill && <FillLine fill={fill} zone={zone} />}
        </div>
        {points.length > 1 && <div className="px-3 pt-3"><EquityLine points={points} levels={levels} /></div>}
        {money && <div className="px-3 pt-3"><LossTrack money={money} /></div>}
        <PhoneHeading title={held.length === 1 ? "Position" : "Positions"} aside={held.length ? held[0]!.mark !== null && `mark ≈ ${fixed(held[0]!.mark)}` : "None open"} />
        {held.length > 0 && <PhoneTable head={["Contract", "Side", "Qty", "Entry", "P&L ≈"]} rows={held.flatMap((h) => [
          [h.symbol, <Side long={h.long} />, fixed(h.qty), fixed(h.entry) ?? "–", <span className={pnlClass(h.pnl)}>{signed(h.pnl)}</span>],
          [<StopLine trigger={stopFor(h, working)?.trigger} mark={h.mark} ended={!run.running} />]])} />}
        <PhoneHeading title="Open orders" aside={working.length || "None"} />
        {working.length > 0 && <PhoneTable head={["Type", "Side", "Qty", "Price"]} rows={working.map((o) => [
          <span className="font-normal">{o.type}</span>, <Side long={o.buy} word={o.buy === null ? undefined : o.buy ? "Buy" : "Sell"} />, fixed(o.qty) ?? "–", fixed(o.trigger ?? o.price) ?? "–"])} />}
        <p className="px-3 pt-2 text-small text-fg-faint">As the run's native events last say. Binance is the account of record.</p>
        <PhoneHeading title="Facts" />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pb-4 text-dense">
          <dt className="text-fg-muted">Account check</dt><dd className="text-right">{check ? `${check.state}${check.readAt ? ` · ${clock(Date.parse(check.readAt), zone)}` : ""}` : "–"}</dd>
          {run.entries && <><dt className="text-fg-muted">Entries</dt><dd className={`text-right ${run.entries.open ? "" : textClass("misses")}`}>{run.entries.text}</dd></>}
          <dt className="text-fg-muted">Fills</dt><dd className="text-right tabular-nums">{fills}</dd>
          <dt className="text-fg-muted">Telegram last sent</dt><dd className="text-right">{view.notify?.configured ? sent !== null ? `${ago(sent, now)} ago` : "Not yet" : "Not set up"}</dd>
        </dl>
      </PhonePage>
      {/* Stop is for a run going as it should; an unresolved one is reconciled on the desktop or closed at Binance. */}
      {run.running && !stopRequested(run) && liveStatus(run).word !== "Unresolved" && actions.stop && (
        <div className="shrink-0 border-t border-line bg-island px-3 py-2">
          <FormButton icon="stop" className="w-full text-fail-fg" onClick={() => setStopping(true)}>Request stop…</FormButton>
        </div>
      )}
      <StopSheet run={run} open={stopping} onClose={() => setStopping(false)} />
    </>
  );
}
