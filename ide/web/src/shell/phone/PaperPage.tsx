import { useEffect, useMemo } from "react";
import { PhonePage } from "../../components/PhoneBar";
import { Skeleton } from "../../components/Missing";
import { Amount, Change, EntryMark, heldAside, PhoneHeading, PhoneTable, Side } from "../../components/PhoneParts";
import { health } from "../../components/RunTile";
import { useNow } from "../../components/hooks/useNow";
import { lineOf } from "../../lib/lines";
import { fixed, precisions, signed, type PaperRun } from "../../lib/paperApi";
import { orders, ordersText, priceText, quantityText } from "../../model/events";
import { follow, useStream } from "../../state/paperStream";
import { paperEquity, paperHeld, paperIssues } from "../../model/phoneRuns";
import { usePaperRuns } from "../../state/paper";
import { closeRun } from "../../state/phone";
import { useResearchLines } from "../../state/researchLines";
import { DAY_MS } from "../../lib/time";
import { useTimeZone } from "../../state/timeZone";
import { pnlClass, textClass } from "../../theme/roles";
import { ANNUAL_DAYS, annualized, drawdownNow, neededReturn, pace } from "../../model/account";
import { Board, type Facts } from "../../widgets/detail/ReadingsBoard";
import { EquityLine } from "../../widgets/phone/EquityLine";
import { clock, keep, since, Version } from "./RunCards";

const SHOWN = 20;  // the latest orders a phone lists; every one is on the desktop
import { PhoneTop } from "./PhoneTop";

/** The desktop's targets card for a paper run, from its listing: the max drawdown against the limit (now: on the
 *  listing's outline of the path), the return against what the minimum annual return asks for by now, and the annual
 *  return once it has run 30 days. */
function facts(run: PaperRun, targets: { max_drawdown?: number | null; annual_return?: number | null } | null | undefined, now: number): Facts {
  const l = run.readings, money = paperEquity(run), start = l?.started_ns != null ? l.started_ns / 1e6 : null;
  const days = start === null ? 0 : (now - start) / DAY_MS, minimum = targets?.annual_return ?? null;
  const needed = minimum === null ? null : neededReturn(minimum, start, now), { ahead, usdt } = pace(money.ret, needed, money.starting);
  return {
    basis: "Measured on the account's minute snapshots", limit: targets?.max_drawdown ?? null, minimum, mdd: l?.max_drawdown ?? null,
    annual: annualized(money.ret, days), short: days < ANNUAL_DAYS ? days : undefined,
    account: { ret: money.ret, needed, ahead, usdt, dd: drawdownNow(money.starting, money.points), ended: false, stale: false },
  };
}

/** A paper run's page: its equity and health, its line against the start, the targets card, what it holds and the
 *  orders it placed, filled or not, from its stream (with its first contract's bars, the lightest a stream sends),
 *  followed while the page is open. */
export function PaperPage({ id }: { id: number }) {
  const listing = usePaperRuns(), lines = useResearchLines().lines, zone = useTimeZone(), now = useNow(30_000);
  const run = listing?.runs.find((r) => r.paper_id === id) ?? null, first = run?.symbols[0] ?? null;
  useEffect(() => { follow(first ? id : null, first); return () => follow(null, null); }, [id, first]);
  const stream = useStream(), s = stream?.paperId === id ? stream : null;
  const placed = useMemo(() => orders(s?.lines ?? []), [s?.lines]), digits = useMemo(() => precisions(s?.lines ?? []), [s?.lines]);
  const money = run ? paperEquity(run) : null;
  const levels = useMemo(() => (money ? [{ value: money.starting, title: "Start" }] : []), [money?.starting]);
  const back = { label: "Runs", onClick: closeRun };
  if (!run || !money) {
    if (listing) return <><PhoneTop back={back} aside={`Paper ${id}`} /><p className="p-4 text-dense text-fg-faint">This paper run is not listed.</p></>;
    return (
      <>
        <PhoneTop back={back} aside={`Paper ${id}`} />
        <PhonePage>
          <div className="space-y-2 px-3 pt-3"><Skeleton className="w-40" /><Skeleton className="w-52" /><Skeleton className="w-32" /></div>
          <div className="px-3 pt-3 text-dense">
            <Board f={{ basis: "Measured on the account's minute snapshots", limit: null, minimum: null, mdd: null, annual: null, reading: true,
                        account: { ret: null, needed: null, ahead: null, usdt: null, dd: null, ended: false, stale: true } }} />
          </div>
        </PhonePage>
      </>
    );
  }
  const h = health(run, now, zone), held = paperHeld(run), issues = paperIssues(run), line = run.candidate ? lineOf(lines, run.candidate) : null;
  const bar = run.readings?.last_bar_ns != null ? run.readings.last_bar_ns / 1e6 : null, start = run.readings?.started_ns != null ? run.readings.started_ns / 1e6 : null;
  return (
    <>
      <PhoneTop back={back} aside={`Paper ${run.paper_id}`} line={line?.name ?? null} />
      <PhonePage>
        <div className="space-y-1 px-3 pt-3">
          <p className="flex min-w-0 items-baseline gap-2 text-dense"><Version name={run.candidate} /><span className={`shrink-0 ${textClass(h.tone)}`}>{h.text}</span></p>
          <p className="text-small text-fg-faint">{run.symbols.join(", ")} · Sandbox fills{start !== null && ` · since ${since(start, zone, now)}`}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1"><Amount value={money.equity} /><Change ratio={money.ret} /></p>
          <p className="text-small">
            {issues.map((i, k) => <span key={i.text} className={textClass(i.tone)}>{k ? " · " : ""}{i.text}</span>)}
            <span className="text-fg-faint">{issues.length ? " · " : ""}{keep(bar !== null ? `last bar ${clock(bar, zone)}` : "no bar yet")}</span>
          </p>
        </div>
        {money.points.length > 1 && <div className="px-3 pt-3"><EquityLine points={money.points} levels={levels} places={0} /></div>}
        <div className="px-3 pt-3 text-dense">
          <Board f={facts(run, line?.targets, now)} />
        </div>
        <PhoneHeading title={held.length === 1 ? "Position" : "Positions"} aside={heldAside(held, false)} />
        {held.length > 0 && <PhoneTable head={["Contract", "Side", "Qty", held.length > 1 ? "Entry / Mark" : "Entry", "P&L"]} rows={held.map((p) => [
          p.symbol, <Side long={p.long} />, fixed(p.qty), <EntryMark held={p} several={held.length > 1} places={2} />,
          <span className={pnlClass(p.pnl)}>{signed(p.pnl)}</span>])} />}
        <PhoneHeading title="Orders" aside={s?.loaded ? (placed.length ? ordersText(placed) : "None yet") : <Skeleton className="w-24" />} />
        {placed.length > 0 && <PhoneTable head={["Contract", "Side", "Price", "State"]} rows={placed.slice(0, SHOWN).map((o) => {
          const d = digits.get(o.symbol) ?? { price: -1, size: -1 }, state = !o.done && s?.seal ? "Open at stop" : o.state;
          return [
            <>{o.symbol}<span className="block text-small font-normal text-fg-muted">{since(o.placed, zone, now)}</span></>,
            <Side long={o.buy} word={o.buy === null ? undefined : o.buy ? "Buy" : "Sell"} />,
            <>{priceText(o, d) ?? o.type.toLowerCase()}<span className="block text-small text-fg-muted">{priceText(o, d) === null ? "" : `${o.type.toLowerCase()} · `}{quantityText(o, d)}</span></>,
            <><span className={o.failed ? "text-fail-fg" : o.state === "Filled" ? "" : "text-fg-muted"}>{state}</span><span className="block text-small text-fg-muted">{since(o.at, zone, now)}</span></>,
          ];
        })} />}
        {placed.length > SHOWN && <p className="px-3 pt-2 text-small text-fg-faint">The latest {SHOWN} of {placed.length} orders.</p>}
        <p className="px-3 pb-4 pt-2 text-small text-fg-faint">Orders past the last {SHOWN}, charts, trades, events and Stop and seal are on the desktop.</p>
      </PhonePage>
    </>
  );
}
