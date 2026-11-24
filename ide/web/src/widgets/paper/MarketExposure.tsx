import { Fragment, type ReactNode } from "react";
import { MISSING, pct, signedPct } from "../../lib/format";
import { fixed, signed } from "../../lib/paperApi";
import type { MarketExposure as ExposureRow, PeriodBreakdown } from "../../model/backtest";
import { Section } from "../../ui/Section";
import { Tip } from "../../ui/Tip";

const tone = (v: number | null) => (v === null || v === 0 ? "text-fg-muted" : v > 0 ? "text-pnl-up" : "text-pnl-down");

/** A column heading, with its explanation on hover when it has one. */
function Head({ tip, right = false, children }: { tip?: string; right?: boolean; children: ReactNode }) {
  const label = <span className={`${right ? "text-right " : ""}text-small text-fg-faint`}>{children}</span>;
  return tip ? <Tip content={tip}>{label}</Tip> : label;
}

const dailyAlpha = (alpha: number | null) =>
  alpha === null ? MISSING : `${alpha > 0 ? "+" : alpha < 0 ? "−" : ""}${Math.abs(alpha * 100).toFixed(3)}%/d`;

/** One benchmark's return split bar: when Alpha and Beta share the same sign, a stacked proportional bar;
 *  when they pull in opposite directions, a zero-centred bar showing Beta vs Alpha around 0. Alpha is drawn
 *  without a gain or loss colour: the report sets no significance level for it. */
function SplitBar({ betaReturn, alphaReturn }: { betaReturn: number | null; alphaReturn: number | null }) {
  if (betaReturn === null || alphaReturn === null) return null;
  const bAbs = Math.abs(betaReturn), aAbs = Math.abs(alphaReturn), span = bAbs + aAbs;
  if (span <= 0) return null;
  const sameSign = (betaReturn >= 0 && alphaReturn >= 0) || (betaReturn <= 0 && alphaReturn <= 0);
  if (sameSign) {
    const aPct = Math.round((aAbs / span) * 100), bPct = 100 - aPct;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex h-1 overflow-hidden rounded-full bg-well">
          <div className="bg-fg-muted opacity-55 transition-[width] duration-150" style={{ width: `${bPct}%` }} />
          <div className="bg-fg transition-[width] duration-150" style={{ width: `${aPct}%` }} />
        </div>
        <div className="flex justify-between text-small text-fg-faint tabular-nums">
          <span>Beta {bPct}%</span>
          <span>Alpha {aPct}%</span>
        </div>
      </div>
    );
  }
  const maxSide = Math.max(bAbs, aAbs), bHalf = Math.round((bAbs / maxSide) * 50), aHalf = Math.round((aAbs / maxSide) * 50);
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-1 overflow-hidden rounded-full bg-well">
        <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        <div className="absolute inset-y-0 bg-fg-muted opacity-55"
             style={betaReturn >= 0 ? { left: "50%", width: `${bHalf}%` } : { right: "50%", width: `${bHalf}%` }} />
        <div className="absolute inset-y-0 bg-fg"
             style={alphaReturn >= 0 ? { left: "50%", width: `${aHalf}%` } : { right: "50%", width: `${aHalf}%` }} />
      </div>
      <div className="flex justify-between text-small text-fg-faint tabular-nums">
        <span>Beta {signedPct(betaReturn, 1)}</span>
        <span>Alpha {signedPct(alphaReturn, 1)}</span>
      </div>
    </div>
  );
}

/** A sealed research run's Alpha vs Beta return decomposition (`market_exposure` slice): Dimson (one-day lag)
 *  regression against the equal-weight crypto basket and BTC, showing Beta, the fitted days' simple-return
 *  sums the report gives, daily Alpha and its t-value (Alpha over its Newey-West standard error). The report
 *  sets no significance level, so Alpha takes no gain or loss colour and its t-value is shown beside it. */
export function MarketExposure({ rows }: { rows: readonly ExposureRow[] }) {
  if (!rows.length) return null;
  const primary = rows[0]!;
  // With no value of either, why: the report's own reason, in the card's place.
  if (rows.every((r) => r.beta === null && r.alpha === null)) return (
    <Section title="Alpha and beta"><p className="text-dense text-fg-muted">{primary.note ?? "The report gives no alpha or beta."}</p></Section>
  );
  return (
    <Section title="Alpha and beta" aside={primary.days ? `${primary.days} fitted days, Dimson 1d lag` : "Dimson 1d lag"}>
      <div className="flex flex-col gap-2">
        <SplitBar betaReturn={primary.betaReturn} alphaReturn={primary.alphaReturn} />
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(5,auto)] items-baseline gap-x-2 gap-y-1 text-dense tabular-nums">
          <span />
          <Head tip="Dimson (1979) market slope b0 + b1 (same-day plus prior-day benchmark return)" right>Beta</Head>
          <Head tip="Cumulative simple return explained by passive benchmark movement over the fitted days" right>Beta ret</Head>
          <Head tip="Cumulative simple excess return (intercept × fitted days) over the fitted days" right>Alpha ret</Head>
          <Head tip="Daily intercept from the Dimson regression (Newey-West automatic-bandwidth standard error in tooltip)" right>Alpha/d</Head>
          <Head tip="Daily Alpha over its Newey-West standard error; the report sets no significance level" right>t</Head>
          {rows.map((r) => {
            const t = r.alpha !== null && r.alphaSe !== null && r.alphaSe > 0 ? r.alpha / r.alphaSe : null;
            return (
              <Fragment key={r.benchmark}>
                <span className="truncate text-fg-muted" title={r.note ?? undefined}>{r.label}</span>
                <span className="text-right text-fg">{r.beta === null ? MISSING : r.beta.toFixed(2)}</span>
                <span className={`text-right ${tone(r.betaReturn)}`}>{signedPct(r.betaReturn, 1)}</span>
                <span className="text-right font-medium text-fg">{signedPct(r.alphaReturn, 1)}</span>
                <span className="text-right text-fg"
                      title={r.alphaSe !== null ? `SE ${(r.alphaSe * 100).toFixed(3)}%/d` : undefined}>{dailyAlpha(r.alpha)}</span>
                <span className="text-right text-fg-muted">{t === null ? MISSING : t.toFixed(2)}</span>
              </Fragment>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/** Time and market-state decomposition from the report (`by_regime`, `by_period`, `capital_scaled`, `dev_years`,
 *  `closed_by_year`): performance across high/low basket volatility days, development years, closed cycles by
 *  close year, month consistency, outlier-day dependence and exposure timing. The timing term takes no gain or
 *  loss colour: its sign alone does not identify sizing skill (`MEASURE_NOTES`). */
export function PeriodsAndRegimes({ p }: { p: PeriodBreakdown }) {
  return (
    <Section title="Periods and regimes" aside="by market state and date">
      <div className="flex flex-col gap-3 text-dense tabular-nums">
        {p.regimes.length > 0 && (
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,auto)] items-baseline gap-x-3 gap-y-1">
            <Head>Volatility regime</Head>
            <Head right>Days</Head>
            <Head right>Daily</Head>
            <Head right>Total</Head>
            {p.regimes.map((g) => (
              <Fragment key={g.regime}>
                <span className="text-fg-muted">{g.label}</span>
                <span className="text-right text-fg-muted">{g.days}</span>
                <span className={`text-right ${tone(g.dailyReturn)}`}>{dailyAlpha(g.dailyReturn)}</span>
                <span className={`text-right font-medium ${tone(g.totalReturn)}`}>{signedPct(g.totalReturn, 1)}</span>
              </Fragment>
            ))}
          </div>
        )}
        {p.devYears.length > 0 && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 gap-y-1">
            <Head tip="The development window cut at the trade start's anniversaries (UTC), each year's compound return; a last part year when the window ends between two">Development year</Head>
            <Head right>Return</Head>
            <Head right tip="Each year's sealed maximum drawdown of the bar-close MARK equity; the run is continuous, so a year's drawdown may fall from an earlier year's peak">Drawdown</Head>
            {p.devYears.map((y) => (
              <Fragment key={y.start}>
                <span className="text-fg-muted">{y.start} – {y.end}</span>
                <span className={`text-right font-medium ${tone(y.ret)}`}>{signedPct(y.ret, 1)}</span>
                <span className="text-right text-fg-muted">{pct(y.drawdown)}</span>
              </Fragment>
            ))}
          </div>
        )}
        {p.closedYears.length > 0 && (
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,auto)] items-baseline gap-x-3 gap-y-1">
            <Head tip="Closed cycles by the UTC calendar year of their close">Close year</Head>
            <Head right>Closed</Head>
            <Head right>Price P&amp;L</Head>
            <Head right>Fees</Head>
            <Head right>Funding</Head>
            {p.closedYears.map((y) => (
              <Fragment key={y.year}>
                <span className="text-fg-muted">{y.year}</span>
                <span className="text-right text-fg-muted">{y.closed}</span>
                <span className={`text-right font-medium ${tone(y.price)}`}>{signed(y.price, 0)}</span>
                <span className="text-right text-fg-muted">{fixed(y.fees, 2) ?? MISSING}</span>
                <span className="text-right text-fg-muted">{signed(y.funding, 2)}</span>
              </Fragment>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1">
          {p.monthsWonShare !== null && (
            <>
              <span className="text-fg-muted">Positive months{p.monthsCount ? ` (${p.monthsCount})` : ""}</span>
              <span className="text-right text-fg">{pct(p.monthsWonShare)}</span>
            </>
          )}
          {p.residualAfterTop5Days !== null && (
            <>
              <Tip content="Compounded return left after removing up to five daily log returns in the direction of their total: the largest when the total is positive or zero, the smallest when it is negative">
                <span className="text-fg-muted">Ex top 5 days</span>
              </Tip>
              <span className={`text-right ${tone(Math.expm1(p.residualAfterTop5Days))}`}>{signedPct(Math.expm1(p.residualAfterTop5Days), 1)}</span>
            </>
          )}
          {p.exBestYearAnnual !== null && (
            <>
              <Tip content="The window's annual return over its days without the best whole development year">
                <span className="text-fg-muted">Ex best year (annualized)</span>
              </Tip>
              <span className={`text-right ${tone(p.exBestYearAnnual)}`}>{signedPct(p.exBestYearAnnual, 1)}</span>
            </>
          )}
          {(p.upMonthNotional !== null || p.downMonthNotional !== null) && (
            <>
              <Tip content="Mean daily gross notional in months where the equal-weight basket rose vs fell">
                <span className="text-fg-muted">Notional (up / down mo)</span>
              </Tip>
              <span className="text-right text-fg">{fixed(p.upMonthNotional, 0) ?? MISSING} / {fixed(p.downMonthNotional, 0) ?? MISSING}</span>
            </>
          )}
          {(p.levelTerm !== null || p.timingTerm !== null) && (
            <>
              <Tip content="Exposed P&L split into mean-notional level term vs daily notional-sizing timing covariance">
                <span className="text-fg-muted">Scale (level / timing)</span>
              </Tip>
              <span className="text-right text-fg">{signed(p.levelTerm, 0)} / {signed(p.timingTerm, 0)}</span>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}
