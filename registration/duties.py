"""The 27 strategy duties and the measure catalogue (`registration.measure_catalogue`).

A strategy file's header takes a stance on each of the 27 duties; a derived registration names the
duties its one change touches (`changed_duties`) and predicts, for each, the direction of a measure
on a fixed attribution slice. The catalogue is shared by registration checks and both reports, so
a prediction can only name what the reports measure.
"""

from __future__ import annotations

import copy


GROUPS = (("A", "Objects and applicability"), ("B", "Prediction and learning"), ("C", "First action and memory"),
          ("D", "Economic configuration"), ("E", "Risk and allocation"), ("F", "Position path"),
          ("G", "Implementation"), ("H", "Capital"), ("I", "Lifecycle and feasibility"))

DUTIES = {
    "A1": "Investable objects and eligibility",
    "A2": "Dynamic selection and replacement",
    "A3": "Market structure the mechanism needs / conditional filter",
    "B1": "Expected return / relative mispricing",
    "B2": "Forecast horizon and decay",
    "B3": "Signal combination and estimate updates",
    "C1": "First entry and trigger",
    "C2": "Not acting, re-entry and path dependence",
    "D1": "Single-leg / multi-leg economic configuration",
    "D2": "Hedging and nonlinear exposure",
    "E1": "Risk and size of one opportunity",
    "E2": "Portfolio exposure, concentration and common risk",
    "E3": "Risk budget after equity changes",
    "E4": "Allocation across opportunities / strategies",
    "F1": "Active scaling in",
    "F2": "Active reduction and position path",
    "F3": "Dynamic protection / profit boundaries",
    "F4": "Full exit, timed exit and cleanup",
    "F5": "Holdings when membership or the model changes",
    "G1": "Economic execution style and price",
    "G2": "Waiting, refreshing and post-fill feedback",
    "G3": "Impact, capacity and implementation speed",
    "H1": "Cash, financing and carrying cost",
    "H2": "Margin, collateral and buffer",
    "H3": "Short availability and financing interruption",
    "I1": "Contract / event lifecycle",
    "I2": "Exit feasibility and future resources",
}

# Slices in report order, each with its measures and a broad index of related responsibilities.
# These duty links locate policies to investigate; they do not identify a cause or constrain the
# choice of a hypothesis. Registration and both reports share the measure catalogue.
_SLICES = (
    ("profit_bridge", "Profit bridge", ("H1", "B1"), ("price", "fee", "funding", "open_mark", "account")),
    ("capital_scaled", "Scale and position timing", ("G3", "E1", "B1", "A3", "E3"),
     ("mean_notional", "unit_return", "level_term", "timing_term", "up_month_notional", "down_month_notional",
      "return_over_drawdown")),
    ("fee_stress", "Fee stress", ("G1", "C2"), ("breakeven_fee_multiple", "daily_turnover")),
    ("by_instrument", "Instruments and sides", ("A1", "A2", "F3"),
     ("top5_abs_share", "one_side_instruments", "long_net", "short_net")),
    ("market_exposure", "Market exposure", ("E2", "D2"), ("beta_basket", "alpha_basket", "beta_btc", "alpha_btc")),
    ("by_period", "Periods", ("A3", "B2"), ("months_won_share", "residual_after_top5_days", "sharpe_lo")),
    ("by_regime", "Volatility regimes", ("A3", "D2"),
     ("high_vol_days", "high_vol_mean_log", "high_vol_log_sum", "low_vol_days", "low_vol_mean_log",
      "low_vol_log_sum")),
    ("trade_structure", "Trade structure", ("F3", "F4", "C1", "F5", "I1"),
     ("cycles", "win_rate", "avg_win", "avg_loss", "expectancy", "median_holding_hours", "top_exit_share")),
    ("trade_pairs", "Trade pairs", ("C1", "A3", "G1"),
     ("matched_share", "matched_net_share", "removed_net", "added_net", "matched_delta_net", "win_to_loss",
      "loss_to_win", "median_entry_shift_minutes")),
    ("drawdown", "Drawdown", ("E2", "F3", "A3", "E1", "E3"),
     ("max_drawdown", "drawdown_days", "top_instrument_share_in_drawdown")),
)


def measure_catalogue() -> dict:
    """{slices: [{id, title, duties, measures}]}: the fixed catalogue, a new copy on every call."""
    return {"slices": [{"id": slice_id, "title": title, "duties": list(duties), "measures": list(measures)}
                       for slice_id, title, duties, measures in copy.deepcopy(_SLICES)]}


def slice_measures() -> dict[str, frozenset[str]]:
    """Measures by slice ID."""
    return {item["id"]: frozenset(item["measures"]) for item in measure_catalogue()["slices"]}
