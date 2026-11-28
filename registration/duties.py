"""The measure catalogue (`registration.measure_catalogue`) and the duties a change touches (`header_changes`).

A strategy file's header takes a stance on each of the 27 duties (`ledger.strategies.DUTIES`); a derived
registration names the duties its one change touches (`changed_duties`) and predicts, for each, the direction of a measure
on a fixed attribution slice. The catalogue is shared by registration checks and both reports, so
a prediction can only name what the reports measure. The duties a change touches are the header lines it
edits (`header_changes`). Registration checks a body's changed duties, predictions and header lines against them
(`check_duties`, `check_prediction`, `check_header`).
"""

from __future__ import annotations

from collections.abc import Mapping

from ledger.strategies import DUTIES, header_lines, name
from shared.refusals import refuse


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


# Counts of activity that a threshold or filter change moves mechanically (looser admits more cycles, orders
# and turnover): a duty predicted only on them cannot be refuted (doctor 20261122-23), so registration asks
# for at least one other measure of that duty.
_COUNTS = frozenset({"cycles", "daily_turnover", "entry_orders"})


def measure_catalogue() -> dict:
    """{slices: [{id, title, duties, measures}]}: the fixed catalogue, a new copy on every call."""
    return {"slices": [{"id": slice_id, "title": title, "duties": list(duties), "measures": list(measures)}
                       for slice_id, title, duties, measures in _SLICES]}


def slice_measures() -> dict[str, frozenset[str]]:
    """Measures by slice ID."""
    return {item["id"]: frozenset(item["measures"]) for item in measure_catalogue()["slices"]}


def counting_measures() -> frozenset[str]:
    """The catalogue measures that only count activity (cycles, turnover, entry orders)."""
    return _COUNTS


def header_changes(parent: bytes, child: bytes) -> list[str]:
    """The duty IDs whose header line differs between two published sources (added or removed counts), sorted."""
    old, new = header_lines(parent), header_lines(child)
    return sorted(duty for duty in DUTIES if old.get(duty) != new.get(duty))


def check_duties(body: Mapping, root: bool) -> None:
    changed = body["changed_duties"]
    unknown = [duty for duty in changed if duty not in DUTIES]
    if unknown:
        raise refuse("DUTY_UNKNOWN", "changed_duties names unknown duties: " + ", ".join(unknown), missing=tuple(unknown),
                     expected="duty IDs A1 to I2")
    if root and changed:
        raise refuse("DUTY_UNKNOWN", "a root registration changes no duty", missing=("changed_duties",))
    if not root and not changed:
        raise refuse("DUTY_UNKNOWN", "a derived registration names at least one changed duty",
                     missing=("changed_duties",))


def check_prediction(body: Mapping, root: bool) -> None:
    catalogue = slice_measures()
    every = frozenset().union(*catalogue.values())
    changed = set(body["changed_duties"])
    allowed = DUTIES if root else changed  # a root changes no duty, predicts any
    predicted = set()
    for index, item in enumerate(body["prediction"]["mechanism"]):
        where = f"prediction.mechanism[{index}]"
        if item["duty"] not in allowed:
            raise refuse("PREDICTION_INVALID", f"{where} predicts duty {item['duty']}, which changed_duties does not "
                                               "name", missing=(where,))
        if item["slice"] is None:
            if not item["reason"].strip():
                raise refuse("PREDICTION_INVALID", f"{where} has no slice and no reason", missing=(where,))
            if item["measure"] is not None and item["measure"] not in every:
                raise refuse("PREDICTION_INVALID", f"{where} names measure {item['measure']} outside the catalogue",
                             missing=(where,), expected="null or a catalogue measure: " + ", ".join(sorted(every)))
        elif item["slice"] not in catalogue:
            raise refuse("PREDICTION_INVALID", f"{where} names slice {item['slice']}, which is not in the measure "
                                               "catalogue", missing=(where,),
                         expected="null or a catalogue slice: " + ", ".join(sorted(catalogue)))
        elif item["measure"] not in catalogue[item["slice"]]:
            raise refuse("PREDICTION_INVALID", f"{where} names {item['slice']}/{item['measure']}, which is not in the "
                                               "measure catalogue", missing=(where,),
                         expected=f"a measure of {item['slice']}: " + ", ".join(sorted(catalogue[item["slice"]])))
        predicted.add(item["duty"])
    unpredicted = sorted(changed - predicted)
    if unpredicted:
        raise refuse("PREDICTION_INVALID", "changed duties without a prediction: " + ", ".join(unpredicted),
                     missing=tuple(unpredicted))
    _check_counting(body["prediction"]["mechanism"], changed, every)


def _check_counting(mechanism: list, changed: set[str], every: frozenset[str]) -> None:
    """A changed duty whose named measures are all counts: a threshold change moves them mechanically."""
    counts = counting_measures()
    named: dict[str, set[str]] = {}
    for item in mechanism:
        if item["duty"] in changed and item["measure"] is not None:
            named.setdefault(item["duty"], set()).add(item["measure"])
    counting_only = sorted(duty for duty, measures in named.items() if measures <= counts)
    if counting_only:
        raise refuse("PREDICTION_INVALID", "changed duties predicted only on counting measures ("
                     + ", ".join(sorted(counts)) + "), which a threshold change moves mechanically: "
                     + ", ".join(counting_only), missing=tuple(counting_only),
                     expected="for each such duty, also a catalogue measure of quality, return, drawdown or exit "
                              "structure: " + ", ".join(sorted(every - counts)))


def check_header(body: Mapping, parent: dict | None, sources: Mapping[str, bytes]) -> None:
    """A derived registration's changed duties are the duty lines each grid candidate's header changes from its
    parent's."""
    if parent is None:
        return
    changed = sorted(set(body["changed_duties"]))
    for ref, source in sources.items():
        edited = header_changes(parent["source"], source)
        if edited != changed:
            raise refuse("DUTY_HEADER_MISMATCH", f"grid candidate {ref} changes the header lines of "
                                                 f"{', '.join(edited) or 'no duty'} from {name(parent)}; "
                                                 f"changed_duties names {', '.join(changed)}",
                         missing=tuple(sorted(set(edited) ^ set(changed))), expected=", ".join(edited) or "none")
