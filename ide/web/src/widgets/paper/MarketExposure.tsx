import { Fragment } from "react";
import { MISSING, pct, signedPct } from "../../lib/format";
import { fixed, signed } from "../../lib/paperApi";
import type { MarketExposure as ExposureRow, PeriodBreakdown } from "../../model/backtest";
import { Section } from "../../components/Section";
import { Tip } from "../../components/Tip";

const tone = (v: number | null) => (v === null || v === 0 ? "text-fg-muted" : v > 0 ? "text-pnl-up" : "text-pnl-down");

const dailyAlpha = (alpha: number | null) =>
  alpha === null ? MISSING : `${alpha > 0 ? "+" : alpha < 0 ? "−" : ""}${Math.abs(alpha * 100).toFixed(3)}%/d`;

/** One benchmark's return split bar: when Alpha and Beta share the same sign, a stacked proportional bar;
 *  when they pull in opposite directions, a zero-centred bar showing Beta vs Alpha around 0. */
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
          <div className={`${alphaReturn >= 0 ? "bg-pnl-up" : "bg-pnl-down"} transition-[width] duration-150`} style={{ width: `${aPct}%` }} />
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
        <div className={`absolute inset-y-0 ${alphaReturn >= 0 ? "bg-pnl-up" : "bg-pnl-down"}`}
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
 *  regression against the equal-weight crypto basket and BTC, showing Beta, daily Alpha, and the fitted days'
 *  cumulative simple-return split (`Beta ret + Alpha ret = Total`). */
export function MarketExposure({ rows }: { rows: readonly ExposureRow[] }) {
  if (!rows.length) return null;
  const primary = rows[0]!;
  return (
    <Section title="Alpha and beta" aside={primary.days ? `${primary.days} fitted days, Dimson 1d lag` : "Dimson 1d lag"}>
      <div className="flex flex-col gap-2">
        <SplitBar betaReturn={primary.betaReturn} alphaReturn={primary.alphaReturn} />
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(5,auto)] items-baseline gap-x-2 gap-y-1 text-dense tabular-nums">
          <span />
          <Tip content="Dimson (1979) market slope b0 + b1 (same-day plus prior-day benchmark return)">
            <span className="text-right text-small text-fg-faint">Beta</span>
          </Tip>
          <Tip content="Cumulative simple return explained by passive benchmark movement over the fitted days">
            <span className="text-right text-small text-fg-faint">Beta ret</span>
          </Tip>
          <Tip content="Cumulative simple excess return (intercept × fitted days) over the fitted days">
            <span className="text-right text-small text-fg-faint">Alpha ret</span>
          </Tip>
          <Tip content="Total simple return over the fitted days (Beta ret + Alpha ret, since OLS residuals sum to zero)">
            <span className="text-right text-small text-fg-faint">Total</span>
          </Tip>
          <Tip content="Daily intercept from the Dimson regression (Newey-West automatic-bandwidth standard error in tooltip)">
            <span className="text-right text-small text-fg-faint">Alpha/d</span>
          </Tip>
          {rows.map((r) => {
            const se = r.alpha !== null && r.alphaSe !== null && r.alphaSe > 0
              ? `SE ${(r.alphaSe * 100).toFixed(3)}%/d · t ${(r.alpha / r.alphaSe).toFixed(2)}`
              : null;
            const total = r.betaReturn !== null && r.alphaReturn !== null ? r.betaReturn + r.alphaReturn : null;
            return (
              <Fragment key={r.benchmark}>
                <span className="truncate text-fg-muted" title={r.note ?? undefined}>{r.label}</span>
                <span className="text-right text-fg">{r.beta === null ? MISSING : r.beta.toFixed(2)}</span>
                <span className={`text-right ${tone(r.betaReturn)}`}>{signedPct(r.betaReturn, 1)}</span>
                <span className={`text-right font-medium ${tone(r.alphaReturn)}`}>{signedPct(r.alphaReturn, 1)}</span>
                <span className={`text-right ${tone(total)}`}>{signedPct(total, 1)}</span>
                <span className={`text-right ${tone(r.alpha)}`} title={se ?? undefined}>{dailyAlpha(r.alpha)}</span>
              </Fragment>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/** Time and market-state decomposition from the report (`by_regime`, `by_period`, `capital_scaled`, `dev_years`,
 *  `closed_by_year`): performance across high/low basket volatility days, calendar years, month consistency,
 *  outlier-day dependence and exposure timing. */
export function PeriodsAndRegimes({ p }: { p: PeriodBreakdown }) {
  const hasYears = p.years.length > 0, hasYearRet = p.years.some((y) => y.ret !== null), hasYearPnl = p.years.some((y) => y.netPnl !== null);
  return (
    <Section title="Periods and regimes" aside="by market state and date">
      <div className="flex flex-col gap-3 text-dense tabular-nums">
        {p.regimes.length > 0 && (
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,auto)] items-baseline gap-x-3 gap-y-1">
            <span className="text-small text-fg-faint">Volatility regime</span>
            <span className="text-right text-small text-fg-faint">Days</span>
            <span className="text-right text-small text-fg-faint">Daily</span>
            <span className="text-right text-small text-fg-faint">Total</span>
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
        {hasYears && (
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,auto)] items-baseline gap-x-3 gap-y-1">
            <span className="text-small text-fg-faint">Year</span>
            <span className="text-right text-small text-fg-faint">{hasYearRet ? "Days" : "Trades"}</span>
            <span className="text-right text-small text-fg-faint">{hasYearPnl ? "Win rate" : ""}</span>
            <span className="text-right text-small text-fg-faint">{hasYearRet ? "Return" : "Closed P&L"}</span>
            {p.years.map((y) => (
              <Fragment key={y.year}>
                <span className="text-fg-muted">{y.year}</span>
                <span className="text-right text-fg-muted">{hasYearRet ? (y.days ?? MISSING) : (y.cycles ?? MISSING)}</span>
                <span className="text-right text-fg-muted">{hasYearPnl ? pct(y.winRate) : ""}</span>
                <span className={`text-right font-medium ${tone(hasYearRet ? y.ret : y.netPnl)}`}>
                  {hasYearRet ? signedPct(y.ret, 1) : signed(y.netPnl, 0)}
                </span>
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
              <Tip content="Compounded return remaining after removing the 5 largest positive daily log-return days">
                <span className="text-fg-muted">Ex top 5 days</span>
              </Tip>
              <span className={`text-right ${tone(Math.expm1(p.residualAfterTop5Days))}`}>
                {signedPct(Math.expm1(p.residualAfterTop5Days), 1)}
              </span>
            </>
          )}
          {p.exBestYearReturn !== null && (
            <>
              <span className="text-fg-muted">Ex best year</span>
              <span className={`text-right ${tone(p.exBestYearReturn)}`}>{signedPct(p.exBestYearReturn, 1)}</span>
            </>
          )}
          {(p.upMonthNotional !== null || p.downMonthNotional !== null) && (
            <>
              <Tip content="Mean daily gross notional in months where the equal-weight basket rose vs fell">
                <span className="text-fg-muted">Notional (up / down mo)</span>
              </Tip>
              <span className="text-right text-fg">
                {fixed(p.upMonthNotional, 0) ?? MISSING}
                {" / "}
                {fixed(p.downMonthNotional, 0) ?? MISSING}
              </span>
            </>
          )}
          {(p.levelTerm !== null || p.timingTerm !== null) && (
            <>
              <Tip content="Exposed P&L split into mean-notional level term vs daily notional-sizing timing covariance">
                <span className="text-fg-muted">Scale (level / timing)</span>
              </Tip>
              <span className="text-right text-fg">
                {signed(p.levelTerm, 0)}
                {" / "}
                <span className={tone(p.timingTerm)}>{signed(p.timingTerm, 0)}</span>
              </span>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}
