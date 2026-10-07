"""
Read the corrected H08 source geometry for H08b's pre-touch order gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from strategy import STOP_BUFFER_ATR
from trendline_strategy import MAX_LINE_EXTENSION
from trendline_strategy import MIN_ANCHOR_SPAN


H08_GEOMETRY_SHA256 = "eba4ca34c4ad8a0fd558c8db136055d286edaa5afef43b428d77924400959239"
DECISION_UTC = "2026-07-24T00:00:00+00:00"
TEST_UTC = "2026-07-24T04:00:00+00:00"


def _case(coin_row: dict) -> dict:
    bars = {row["ts_event_utc"]: row for row in coin_row["source_period_bars"]}
    decision, test = bars[DECISION_UTC], bars[TEST_UTC]
    result = {
        "coin": coin_row["coin"],
        "decision_utc": DECISION_UTC,
        "test_utc": TEST_UTC,
        "decision_bar": decision,
        "next_bar_low": test["ohlc"][2],
        "eligible_intent": False,
        "next_low_crosses_limit": False,
    }
    pivots = decision["latest_confirmed_low_pivots"]
    if len(pivots) != 2 or decision.get("prior_atr") is None:
        return result
    first, second = pivots
    span = second["index"] - first["index"]
    age = decision["pair_age_bars"]
    if span < MIN_ANCHOR_SPAN or age > MAX_LINE_EXTENSION:
        return result
    if second["low"] <= first["low"] or decision["pair_dead_after_bar"]:
        return result
    slope = (second["low"] - first["low"]) / span
    decision_line = decision["projected_line"]
    band = STOP_BUFFER_ATR * decision["prior_atr"]
    if decision["ohlc"][2] <= decision_line + band:
        return result
    if decision["ohlc"][3] <= decision_line + band:
        return result
    next_line = decision_line + slope
    limit = next_line + band
    stop = next_line - band
    target = decision["prior_60_bar_high"]
    if limit <= stop or target - limit < limit - stop:
        return result
    result.update(
        {
            "eligible_intent": True,
            "anchors": pivots,
            "decision_line": decision_line,
            "projected_next_line": next_line,
            "prior_atr_touch_band": band,
            "planned_limit": limit,
            "planned_stop": stop,
            "planned_target": target,
            "planned_room_r": (target - limit) / (limit - stop),
            "next_low_crosses_limit": test["ohlc"][2] <= limit,
            "next_close_above_line": test["ohlc"][3] > next_line,
        },
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--h08-geometry", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.h08_geometry.read_bytes()).hexdigest() != H08_GEOMETRY_SHA256:
        raise RuntimeError("registered H08 source geometry bytes changed")
    geometry = json.loads(args.h08_geometry.read_text())
    if geometry["corrected_h06_parity_sha256"] != (
        "ee1b06ef9d42645aeb107c5e8425273827c97181c8cf942630c31bdf8cde7978"
    ):
        raise RuntimeError("corrected native source coverage is required")
    cases = [_case(row) for row in geometry["per_coin"]]
    if [row["coin"] for row in cases] != ["BTC", "LINK", "ETH"]:
        raise RuntimeError("registered source case order changed")
    output = {
        "scope": "H08b read-only pre-touch order geometry; native orders/fills/PnL not computed",
        "registration_commit": "687ff3b36",
        "h08_geometry_sha256": H08_GEOMETRY_SHA256,
        "decision_utc": DECISION_UTC,
        "test_utc": TEST_UTC,
        "cases": cases,
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
