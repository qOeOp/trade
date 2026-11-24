import { Fragment, type ReactNode } from "react";
import { MISSING, pct, signedPct } from "../../lib/format";
import type { AnnualInterval, Costs } from "../../model/backtest";
import { useTesting } from "../../state/testing";
import { Skeleton } from "../../ui/Missing";
import { Section } from "../../ui/Section";
import { Tip } from "../../ui/Tip";

/** A reading's line: its name with what it is on hover, a faint detail under it, and its value at the right. */
function Row({ name, tip, detail, children }: { name: string; tip: string; detail?: string | null; children: ReactNode }) {
  return (
    <Fragment>
      <Tip content={tip}><span className="min-w-0 justify-self-start text-fg-muted">{name}</span></Tip>
      <span className="whitespace-nowrap text-right text-fg">{children}</span>
      {detail && <p className="col-span-full mb-1 text-small text-fg-faint last:mb-0">{detail}</p>}
    </Fragment>
  );
}
const Rows = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 text-dense tabular-nums">{children}</div>;

const range = (low: string, high: string) => `${low} to ${high}`;
/** A probability in percent to one place; one that is not zero but rounds to it as <0.1%. */
const chance = (p: number) => (p > 0 && p < 0.0005 ? "<0.1%" : p < 1 && p > 0.9995 ? ">99.9%" : `${(p * 100).toFixed(1)}%`);

/** How much of a backtest's result chance could give: its annual return's bootstrap interval (the report's) and its
 *  deflated Sharpe at each of the line's trial counts, which move with the ledger and are read apart (state/testing.ts). */
export function Reliability({ trial, interval }: { trial: number; interval: AnnualInterval | null }) {
  const read = useTesting(), testing = read.kind === "ready" ? read.testing : null;
  const counts = testing?.multiple_testing, ends = testing?.deflated_sharpe[trial];
  const low = ends?.trials_with_sweeps, high = ends?.effective_trials;
  return (
    <Section title="Reliability">
      <Rows>
        <Row name={`Annual return${interval ? `, ${Math.round(interval.coverage * 100)}% interval` : " interval"}`}
             tip="The block-bootstrap interval of the annual return, in the comparison design the run's registration declared"
             detail={interval ? `${interval.days} days in ${interval.block}-day blocks` : "The registration declares no comparison design"}>
          {interval ? range(signedPct(interval.low, 1), signedPct(interval.high, 1)) : MISSING}
        </Row>
        <Row name="Deflated Sharpe"
             tip="The probability that the run's Sharpe is above what the best of that many trials would show by chance: at every overlapping trial with the declared offline variants, and at the number of independent trials their correlation leaves"
             detail={read.kind === "refused" ? `${read.code}: ${read.message}` : read.kind === "absent" ? read.message
               : counts ? `from ${counts.trials_with_sweeps} trials to ${counts.effective_trials?.toFixed(1) ?? MISSING} independent ones` : null}>
          {read.kind === "reading" ? <Skeleton className="w-24" /> : low == null && high == null ? MISSING
            : range(low == null ? MISSING : chance(low), high == null ? MISSING : chance(high))}
        </Row>
      </Rows>
    </Section>
  );
}

/** What costs and size leave of a backtest: the fee multiple that takes its whole profit, what it trades a day, and how
 *  much of their minute's volume its fills take. Each is a description of the run, with no threshold of its own. */
export function CostsAndCapacity({ c }: { c: Costs }) {
  const p = c.participation;
  const counted = p && ([["above their minute's volume", p.above], ["in a minute without volume", p.zero],
                         ["without a bar", p.noBar], ["of settlement or liquidation", p.engine]] as const).filter(([, n], i) => i === 0 || n > 0);
  return (
    <Section title="Costs and capacity" aside={p?.execution ? `${p.execution} execution` : undefined}>
      <div className="flex flex-col gap-3">
        <Rows>
          <Row name="Break-even fees" tip="How many times the fees paid the run could pay before its profit is gone" detail={c.breakevenNote}>
            {c.breakeven === null ? MISSING : `${c.breakeven.toFixed(1)}×`}
          </Row>
          <Row name="Daily turnover" tip="The notional traded a day over the starting balance, across the trading window" detail={c.turnoverNote}>
            {pct(c.turnover)}
          </Row>
        </Rows>
        {p ? (
          <div className="flex flex-col gap-1.5 text-dense tabular-nums">
            <Tip content="Each fill's quantity over the last-price volume of its minute, every fill weighted equally; Minute is one contract's fills of one minute together, at their largest">
              <span className="self-start text-fg-muted">Share of the minute's volume</span>
            </Tip>
            <div className="grid grid-cols-5 gap-x-2">
              {([["Median", p.median], ["p95", p.p95], ["p99", p.p99], ["Largest", p.max], ["Minute", p.minuteMax]] as const).map(([name, v]) => (
                <div key={name} className="flex min-w-0 flex-col text-right first:text-left">
                  <span className="text-small text-fg-faint">{name}</span><span className="text-fg">{v === null ? MISSING : pct(v)}</span>
                </div>
              ))}
            </div>
            <p className="text-small text-fg-faint">{`${p.fills} fills read`}{counted!.map(([words, n]) => <span key={words}> · <span className={n > 0 ? "text-fg" : ""}>{n}</span> {words}</span>)}</p>
          </div>
        ) : <p className="text-dense text-fg-faint">The seal holds no share of the minute's volume.</p>}
      </div>
    </Section>
  );
}
