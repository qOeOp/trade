// A sealed research replay (the Runs page's backtest stage) as the page reads it from its report
// (lib/trialApi.ts), only from what the ledger stores: a point a day of the account, compounded from its
// starting balance by the stored daily returns, with the day's mean gross exposure as a share of it and
// the cycles held that day; the cycles as closed trades (no prices or sizes are stored for them); the
// deepest drawdown the seal measured at bar closes, peak and trough; and the account and trade stats
// Details shows, as a paper run's (account.ts), with what the report measures taken from its slices (what
// moved the account, win rate, average win and loss, expectancy). A cycle still open at the window's end
// is held until that end, as the report reads it. Without a recorded starting balance there is no equity.
import { amount, symbolOf } from "../lib/paperApi";
import { DAY_MS, utcInstant } from "../lib/time";
import type { TrialReport } from "../lib/trialApi";
import { tradeStats, type Account, type TradeStats } from "./account";
import { sidesHeld, type Leaning } from "./held";
import { exitOf } from "./paper";
import type { Closed } from "./trades";

/** A cycle as a closed trade: `pnl` after fees and funding, `gross` its price move alone; `open` when it was
 *  still open at the window's end, `closed` then being that end. */
export type Cycle = Closed & { fees: number; funding: number; gross: number; type: string; open: boolean };
/** One market benchmark's Dimson (one-day lag) regression decomposition from the `market_exposure` slice:
 *  `beta` (same-day plus prior-day slope), daily `alpha` and its Newey-West `alphaSe`, and the fitted days'
 *  simple-return sums `betaReturn` and `alphaReturn`. */
export type MarketExposure = {
  benchmark: "basket" | "btc"; label: string; note: string | null; days: number | null;
  beta: number | null; alpha: number | null; alphaSe: number | null;
  betaReturn: number | null; alphaReturn: number | null;
};
/** One volatility regime's return summary from `by_regime` (`high` or `low` prior-day basket volatility):
 *  the number of days in that regime, their compounded return (`exp(log_sum) - 1`) and mean daily return (`exp(mean_log) - 1`). */
export type RegimeStat = { regime: "high" | "low"; label: string; days: number; totalReturn: number | null; dailyReturn: number | null };
/** One development year (cut at the trade start's anniversaries, not a calendar year): its UTC dates and compound return. */
export type DevYear = { start: string; end: string; ret: number };
/** The closed cycles of one UTC close year: their count, price move, fees paid and funding (account currency). */
export type ClosedYear = { year: string; closed: number; price: number | null; fees: number | null; funding: number | null };
/** Time and market-state breakdowns from `by_period`, `by_regime`, `capital_scaled`, `dev_years` and `closed_by_year`. */
export type PeriodBreakdown = {
  monthsWonShare: number | null; monthsCount: number | null; residualAfterTop5Days: number | null;
  upMonthNotional: number | null; downMonthNotional: number | null;
  levelTerm: number | null; timingTerm: number | null;
  regimes: RegimeStat[]; devYears: DevYear[]; closedYears: ClosedYear[];
  /** The window's annual return without its best development year. */
  exBestYearAnnual: number | null;
};
/** A day: its start (s), return, closing equity, gross exposure (share of equity) and cycles held. */
type Day = { time: number; ret: number; equity: number; exposure: number | null; held: number };
export type Backtest = {
  trial: number; starting: number | null; days: Day[]; cycles: Cycle[];
  /** The sealed deepest drawdown: its depth, peak and trough (s). */
  drawdown: { depth: number; peak: number; trough: number } | null;
  /** The trade window (ms). */
  window: [number, number];
  /** The market day the run read: its bars are read at it. */
  market: string | null;
  image: string | null; execution: string | null; account: Account | null; stats: TradeStats | null;
  exposures: MarketExposure[];
  periods: PeriodBreakdown | null;
};

/** The report's times: UTC, written without a zone. */
const ms = (text: string) => utcInstant(text) ?? Number.NaN;
const value = (m: { value: number | string | null } | null | undefined) => amount(m?.value ?? null);
/** The report's measure `name` of its slice `id`. */
const sliced = (r: TrialReport, id: string, name: string) => value(r.slices?.find((s) => s.id === id)?.measures[name]);

export function backtest(r: TrialReport): Backtest {
  const window: [number, number] = [ms(r.trade_window.trade_start), ms(r.trade_window.trade_end)];
  const cycles: Cycle[] = (r.tables?.positions ?? []).map((c): Cycle => {
    const type = c.closing_order_type ?? "", open = c.ts_closed_ns === null;
    return {
      id: `${r.trial_id}:${c.seq}`, symbol: symbolOf(c.instrument_id), long: c.side.toLowerCase() === "long", quantity: 0, entry: null, exit: null,
      pnl: amount(c.realized_pnl), opened: c.ts_opened_ns / 1e6, closed: c.ts_closed_ns === null ? window[1] : c.ts_closed_ns / 1e6,
      how: exitOf(type),
      fees: amount(c.commissions) ?? 0, funding: amount(c.funding) ?? 0, gross: amount(c.price_pnl) ?? 0, type, open,
    };
  }).sort((a, b) => b.closed - a.closed);
  const starting = amount(r.cost_basis?.account?.starting_balance_usdt ?? null), rows = r.tables?.daily_returns ?? [];
  const days: Day[] = [];
  if (starting !== null && rows.every((d) => d.native_return !== null)) {
    let equity = starting;
    for (const d of rows) {
      equity *= 1 + d.native_return!;
      const from = d.ts_event_ns / 1e6, gross = amount(d.mean_gross_notional);
      days.push({ time: from / 1000, ret: d.native_return!, equity, exposure: gross === null || !equity ? null : gross / equity,
                  held: cycles.filter((c) => c.opened < from + DAY_MS && c.closed >= from).length });
    }
  }
  const dd = r.drawdown, depth = value(dd?.["mark_max_drawdown"]), peak = dd?.["peak_utc"]?.value, trough = dd?.["trough_utc"]?.value;
  const drawdown = depth !== null && typeof peak === "string" && typeof trough === "string" ? { depth, peak: ms(peak) / 1000, trough: ms(trough) / 1000 } : null;
  const account = starting === null || !days.length ? null : accountOf(r, starting, days, cycles, window, depth);
  const inMarket = value(r.capital?.["time_in_market"]), trade = (name: string) => sliced(r, "trade_structure", name);
  return {
    trial: r.trial_id, starting: days.length ? starting : null, days, cycles, drawdown, window, market: r.market_day ?? null,
    image: r.runtime?.image_digest ?? null, execution: r.cost_basis?.account?.execution ?? null,
    account, stats: account && { ...tradeStats(account, []), inMarket, winRate: trade("win_rate"), avgWin: trade("avg_win"),
                                 avgLoss: trade("avg_loss"), perTrade: trade("expectancy") },
    exposures: marketExposures(r),
    periods: periodsOf(r),
  };
}

/** Reads the `market_exposure` slice (`beta_basket`, `alpha_basket`, `beta_btc`, `alpha_btc`) when present. */
function marketExposures(r: TrialReport): MarketExposure[] {
  const m = r.slices?.find((s) => s.id === "market_exposure")?.measures;
  if (!m) return [];
  const specs = [
    ["basket", "Basket", "beta_basket", "alpha_basket"],
    ["btc", "BTC", "beta_btc", "alpha_btc"],
  ] as const;
  return specs.flatMap(([benchmark, label, bKey, aKey]): MarketExposure[] => {
    const b = m[bKey], a = m[aKey];
    const beta = value(b), alpha = value(a);
    if (beta === null && alpha === null) return [];
    return [{
      benchmark, label, note: a?.definition_note ?? b?.definition_note ?? null, days: amount(a?.sample_size ?? b?.sample_size ?? null),
      beta, alpha, alphaSe: amount(a?.standard_error ?? null),
      betaReturn: amount(b?.return_sum ?? null), alphaReturn: amount(a?.return_sum ?? null),
    }];
  });
}

/** Reads the time and market-state slices (`by_period`, `by_regime`, `capital_scaled`, `dev_years`, `closed_by_year`). */
function periodsOf(r: TrialReport): PeriodBreakdown | null {
  const period = r.slices?.find((s) => s.id === "by_period")?.measures;
  const regime = r.slices?.find((s) => s.id === "by_regime")?.measures;
  const cap = r.slices?.find((s) => s.id === "capital_scaled")?.measures;
  const monthsWon = period?.["months_won_share"];
  const monthsWonShare = value(monthsWon), monthsCount = amount(monthsWon?.sample_size ?? null);
  const residualAfterTop5Days = value(period?.["residual_after_top5_days"]);
  const upMonthNotional = value(cap?.["up_month_notional"]), downMonthNotional = value(cap?.["down_month_notional"]);
  const levelTerm = value(cap?.["level_term"]), timingTerm = value(cap?.["timing_term"]);
  const regimes: RegimeStat[] = (["high", "low"] as const).flatMap((k): RegimeStat[] => {
    const days = value(regime?.[`${k}_vol_days`]);
    if (days === null || days <= 0) return [];
    const logSum = value(regime?.[`${k}_vol_log_sum`]), meanLog = value(regime?.[`${k}_vol_mean_log`]);
    return [{
      regime: k, label: k === "high" ? "High vol" : "Low vol", days,
      totalReturn: logSum === null ? null : Math.expm1(logSum),
      dailyReturn: meanLog === null ? null : Math.expm1(meanLog),
    }];
  });
  const devYears: DevYear[] = (r.dev_years?.years ?? []).map((y) => ({ start: y.start, end: y.end, ret: y.return }));
  const closedYears: ClosedYear[] = Object.entries(r.closed_by_year ?? {}).map(([year, c]) => ({
    year, closed: c.closed_trades, price: amount(c.price_pnl_usdt), fees: amount(c.fill_commissions_usdt), funding: amount(c.reported_funding_usdt),
  }));
  const exBestYearAnnual = r.dev_years?.return_without_best_year ?? null;
  if (
    monthsWonShare === null && residualAfterTop5Days === null && upMonthNotional === null && downMonthNotional === null
    && levelTerm === null && timingTerm === null && !regimes.length && !devYears.length && !closedYears.length
  ) return null;
  return {
    monthsWonShare, monthsCount, residualAfterTop5Days, upMonthNotional, downMonthNotional,
    levelTerm, timingTerm, regimes, devYears, closedYears, exBestYearAnnual,
  };
}

/** The account over the window: at its end, what moved it as the report's profit bridge gives it (the
 *  cycles' price moves, fees, funding and the open cycles' final mark; none when the report gives none),
 *  the drawdown below the daily peak then and the sealed deepest; its trades the closed cycles. */
function accountOf(r: TrialReport, starting: number, days: readonly Day[], cycles: readonly Cycle[], window: [number, number], deepest: number | null): Account {
  const equity = days.at(-1)!.equity, peak = Math.max(starting, ...days.map((d) => d.equity)), fee = sliced(r, "profit_bridge", "fee");
  return {
    starting, equity, net: equity - starting, ret: equity / starting - 1, gross: sliced(r, "profit_bridge", "price"),
    fees: fee === null ? null : -fee, funding: sliced(r, "profit_bridge", "funding"), open: sliced(r, "profit_bridge", "open_mark"),
    drawdown: 1 - equity / peak, maxDrawdown: deepest, path: days.map((d) => [d.time * 1e9, d.equity]),
    start: window[0], end: window[1], trades: cycles.filter((c) => !c.open),
  };
}

/** When any cycle was open (ms) and which way, overlapping ones joined, oldest first (sidesHeld). */
export const cyclesHeld = (cycles: readonly Cycle[]): Leaning[] => sidesHeld(cycles.map((c) => [c.opened, c.closed, c.long] as const));
