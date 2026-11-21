"""The 27 strategy duties and the measure catalogue (`registration.measure_catalogue`).

A strategy file's header takes a stance on each of the 27 duties; a derived registration names the
duties its one change touches (`changed_duties`) and predicts, for each, the direction of a measure
on a fixed attribution slice. The catalogue is shared by registration checks and both reports, so
a prediction can only name what the reports measure.
"""

from __future__ import annotations


# The duty IDs; their titles are the duty directory's (research-round references/duty-directory.md).
DUTIES = frozenset(("A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "D1", "D2", "E1", "E2", "E3", "E4", "F1", "F2", "F3",
                    "F4", "F5", "G1", "G2", "G3", "H1", "H2", "H3", "I1", "I2"))

# Slices in report order, each with its measures and the duties whose rule it can measure: every duty has
# at least one. These links locate policies to investigate; they do not identify a cause or constrain the
# choice of a hypothesis or of the measure a prediction names. Registration and both reports share the
# measure catalogue.
_SLICES = (
    ("profit_bridge", "Profit bridge", ("B1", "E4", "G1", "H1", "H3"),
     ("price", "fee", "funding", "open_mark", "account")),
    ("capital_scaled", "Scale and position timing", ("A3", "B1", "E1", "E3", "E4", "F1", "F2", "G3", "H2"),
     ("mean_notional", "unit_return", "level_term", "timing_term", "up_month_notional", "down_month_notional",
      "return_over_drawdown")),
    ("fee_stress", "Fee stress", ("B2", "C2", "G1"), ("breakeven_fee_multiple", "daily_turnover")),
    ("by_instrument", "Instruments and sides", ("A1", "A2", "D1", "H3"),
     ("top5_abs_share", "net_without_top_instrument", "one_side_instruments", "long_net", "short_net")),
    ("market_exposure", "Market exposure", ("D1", "D2", "E2", "H2"), ("beta_basket", "alpha_basket", "beta_btc", "alpha_btc")),
    ("by_period", "Periods", ("A3", "B3"), ("months_won_share", "residual_after_top5_days", "sharpe_lo")),
    ("by_regime", "Volatility regimes", ("A3", "D2"),
     ("high_vol_days", "high_vol_mean_log", "high_vol_log_sum", "low_vol_days", "low_vol_mean_log",
      "low_vol_log_sum")),
    ("trade_structure", "Trade structure", ("A3", "B1", "B2", "B3", "C1", "C2", "F1", "F2", "F3", "F4", "F5", "I1", "I2"),
     ("cycles", "win_rate", "avg_win", "avg_loss", "expectancy", "median_holding_hours", "top_exit_share")),
    ("entry_orders", "Entry orders", ("C1", "G1", "G2"), ("entry_orders", "entry_filled_share")),
    ("trade_pairs", "Trade pairs", ("A3", "B1", "C1", "C2", "G1", "G2"),
     ("matched_share", "matched_net_share", "removed_net", "added_net", "matched_delta_net", "win_to_loss",
      "loss_to_win", "median_entry_shift_minutes")),
    ("drawdown", "Drawdown", ("A3", "E1", "E2", "E3", "E4", "F2", "F3", "H2", "I2"),
     ("max_drawdown", "drawdown_days", "top_instrument_share_in_drawdown")),
)


def measure_catalogue() -> dict:
    """{slices: [{id, title, duties, measures}]}: the fixed catalogue, a new copy on every call."""
    return {"slices": [{"id": slice_id, "title": title, "duties": list(duties), "measures": list(measures)}
                       for slice_id, title, duties, measures in _SLICES]}


def slice_measures() -> dict[str, frozenset[str]]:
    """Measures by slice ID."""
    return {item["id"]: frozenset(item["measures"]) for item in measure_catalogue()["slices"]}
