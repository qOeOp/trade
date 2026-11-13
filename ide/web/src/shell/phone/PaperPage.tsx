import { useMemo } from "react";
import { PhonePage } from "../../components/PhoneBar";
import { Amount, Change, PhoneHeading, PhoneTable, Side } from "../../components/PhoneParts";
import { health } from "../../components/RunTile";
import { useNow } from "../../components/hooks/useNow";
import { lineOf } from "../../lib/lines";
import { fixed, signed, type PaperRun } from "../../lib/paperApi";
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
import { PhoneTop } from "./PhoneTop";
import { MISSING } from "../../lib/format";

/** The desktop's targets card for a paper run, from its listing: the max drawdown against the limit (now: on the
 *  listing's outline of the path), the return against what the minimum annual return asks for by now, and the annual
 *  return once it has run 30 days. */
function facts(run: PaperRun, targets: { max_drawdown?: number | null; annual_return?: number | null } | null | undefined, now: number): Facts {
  const l = run.live, money = paperEquity(run), start = l?.started_ns != null ? l.started_ns / 1e6 : null;
  const days = start === null ? 0 : (now - start) / DAY_MS, minimum = targets?.annual_return ?? null;
  const needed = minimum === null ? null : neededReturn(minimum, start, now), { ahead, usdt } = pace(money.ret, needed, money.starting);
  return {
    basis: "Measured on the account's minute snapshots", limit: targets?.max_drawdown ?? null, minimum, mdd: l?.max_drawdown ?? null,
    annual: annualized(money.ret, days), short: days < ANNUAL_DAYS ? days : undefined,
    account: { ret: money.ret, needed, ahead, usdt, dd: drawdownNow(money.starting, money.points), ended: false, stale: false },
  };
}

/** A paper run's page: its equity and health, its line against the start, the targets card and what it holds. */
export function PaperPage({ id }: { id: number }) {
  const listing = usePaperRuns(), lines = useResearchLines().lines, zone = useTimeZone(), now = useNow(30_000);
  const run = listing?.runs.find((r) => r.paper_id === id) ?? null;
  const money = run ? paperEquity(run) : null;
  const levels = useMemo(() => (money ? [{ value: money.starting, title: "Start" }] : []), [money?.starting]);
  const back = { label: "Runs", onClick: closeRun };
  if (!run || !money) return <><PhoneTop back={back} aside={`Paper ${id}`} /><p className="p-4 text-dense text-fg-faint">{listing ? "This paper run is not listed." : "Reading the paper runs…"}</p></>;
  const h = health(run, now, zone), held = paperHeld(run), issues = paperIssues(run), line = run.candidate ? lineOf(lines, run.candidate) : null;
  const bar = run.live?.last_bar_ns != null ? run.live.last_bar_ns / 1e6 : null, start = run.live?.started_ns != null ? run.live.started_ns / 1e6 : null;
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
        <PhoneHeading title={held.length === 1 ? "Position" : "Positions"} aside={held.length ? held[0]!.mark !== null && `mark ${fixed(held[0]!.mark)}` : "None open"} />
        {held.length > 0 && <PhoneTable head={["Contract", "Side", "Qty", "Entry", "P&L"]} rows={held.map((p) => [
          p.symbol, <Side long={p.long} />, fixed(p.qty), fixed(p.entry, 2) ?? MISSING, <span className={pnlClass(p.pnl)}>{signed(p.pnl)}</span>])} />}
        <p className="px-3 pb-4 pt-2 text-small text-fg-faint">Charts, trades, events and Stop and seal are on the desktop.</p>
      </PhonePage>
    </>
  );
}
