// Human names for the registration catalogue's measures (registration/duties.py _SLICES), as a
// prediction names them: `slice.measure`, or a measure alone. A name not listed reads as its words.
const SLICES: Record<string, string> = {
  profit_bridge: "Profit bridge", capital_scaled: "Scale and timing", fee_stress: "Fee stress",
  by_instrument: "Instruments and sides", market_exposure: "Market exposure", by_period: "Periods",
  by_regime: "Volatility regimes", trade_structure: "Trade structure", trade_pairs: "Trade pairs", drawdown: "Drawdown",
};
const MEASURES: Record<string, string> = {
  price: "Price P&L", fee: "Fees", funding: "Funding", open_mark: "Open positions at mark", account: "Account total",
  mean_notional: "Mean notional", unit_return: "Return per unit notional", level_term: "Level term", timing_term: "Timing term",
  up_month_notional: "Notional in up months", down_month_notional: "Notional in down months", return_over_drawdown: "Return over drawdown",
  breakeven_fee_multiple: "Break-even fee multiple", daily_turnover: "Daily turnover",
  top5_abs_share: "Top 5 instruments' share", one_side_instruments: "One-sided instruments", long_net: "Long net", short_net: "Short net",
  beta_basket: "Beta to the basket", alpha_basket: "Alpha over the basket", beta_btc: "Beta to BTC", alpha_btc: "Alpha over BTC",
  months_won_share: "Share of months won", residual_after_top5_days: "Return without the top 5 days", sharpe_lo: "Sharpe (Lo-adjusted)",
  high_vol_days: "High-volatility days", high_vol_mean_log: "High-volatility mean daily log return", high_vol_log_sum: "High-volatility summed log return",
  low_vol_days: "Low-volatility days", low_vol_mean_log: "Low-volatility mean daily log return", low_vol_log_sum: "Low-volatility summed log return",
  cycles: "Cycles", win_rate: "Win rate", avg_win: "Average win", avg_loss: "Average loss", expectancy: "Expectancy",
  median_holding_hours: "Median hold (hours)", top_exit_share: "Top exit reason's share",
  matched_share: "Matched trades' share", matched_net_share: "Matched trades' net share", removed_net: "Net of removed trades",
  added_net: "Net of added trades", matched_delta_net: "Net change of matched trades", win_to_loss: "Wins turned losses",
  loss_to_win: "Losses turned wins", median_entry_shift_minutes: "Median entry shift (minutes)",
  max_drawdown: "Maximum drawdown", drawdown_days: "Days in drawdown", top_instrument_share_in_drawdown: "Top instrument's share of the drawdown",
};
const words = (name: string) => { const s = name.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

/** A prediction's measure as words: its measure's name, and its slice's when it names one. */
export function measureLabel(key: string): { measure: string; slice: string | null } {
  const dot = key.indexOf(".");
  const [slice, measure] = dot < 0 ? [null, key] : [key.slice(0, dot), key.slice(dot + 1)];
  const label = MEASURES[measure] ?? words(measure), group = slice === null ? null : SLICES[slice] ?? words(slice);
  // A slice its measure already names ("Maximum drawdown" in Drawdown) is left out.
  return { measure: label, slice: group && !label.toLowerCase().includes(group.toLowerCase()) ? group : null };
}

/** An eligibility reason (`CODE: detail`, several joined by "; ") as words with the detail kept apart. */
const REASONS: Record<string, string> = {
  SOURCE_REVIEW_FAILED: "Source review failed", RUN_INVALID: "Run invalid", AUDIT_NOT_RUN: "Audit did not run",
  CAPTURE_FAILED: "Evidence capture failed", SEALED_RESULT_MISSING: "No sealed result", NOT_EVALUATED: "Not evaluated",
  PURPOSE_NOT_COMPARABLE: "Not a research run", unfinished: "Unfinished",
};
export function reasonLabels(reason: string): { label: string; detail: string | null }[] {
  return reason.split("; ").filter(Boolean).map((part) => {
    const colon = part.indexOf(": "), code = colon < 0 ? part : part.slice(0, colon), detail = colon < 0 ? null : part.slice(colon + 2);
    return /^[A-Z_]+$|^unfinished$/.test(code) ? { label: REASONS[code] ?? words(code.toLowerCase()), detail } : { label: part, detail: null };
  });
}
