"""
Compare the frozen D60 selector with H19a on every complete native LAST candle.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_d60_broad_swing_source import _eligible_at_decision
from audit_d60_broad_swing_source import _selected
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_trendline_signal_parity import INPUT_SHA256
from broad_swing_signal import BroadSwingPullback
from strategy import FourHour

from vibe_trading.indicators import WilderMovingAverage


FROZEN_SOURCE_READER_SHA256 = "f2ae538096df254d7037523ce6744d80cd898707074536138eb8616d4355f8cc"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _check(candles: list) -> dict:
    state: list[FourHour] = []
    selector = BroadSwingPullback()
    atr = WilderMovingAverage(14)
    selected = 0
    eligible = 0
    for raw in candles:
        candle = FourHour(raw.ts_event, float(raw.high), float(raw.low), float(raw.close))
        previous_close = state[-1].close if state else candle.close
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - previous_close),
            abs(candle.low - previous_close),
        )
        prior_atr = atr.value if atr.initialized else None
        state.append(candle)
        i = len(state) - 1
        frozen = _selected(state, i, prior_atr)
        plan = selector.on_closed(candle, prior_atr)
        if selector.last_selected != frozen:
            raise RuntimeError(f"H19a selected geometry differs at four-hour index {i}")
        expected_plan = (
            frozen is not None and frozen["stop"] > 0 and _eligible_at_decision(state, i, frozen)
        )
        if (plan is not None) != expected_plan:
            raise RuntimeError(f"H19a plan eligibility differs at four-hour index {i}")
        if plan is not None and (
            plan.ts_event != candle.ts_event
            or plan.a_index != frozen["a_index"]
            or plan.b_index != frozen["b_index"]
            or plan.entry != frozen["level_50"]
            or plan.stop != frozen["stop"]
            or plan.target != frozen["target"]
        ):
            raise RuntimeError(f"H19a plan prices differ at four-hour index {i}")
        selected += frozen is not None
        eligible += expected_plan
        atr.update_raw(true_range)
    return {
        "complete_four_hour_bars": len(candles),
        "selected_decisions": selected,
        "eligible_decisions": eligible,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if _sha(args.input_identity) != INPUT_SHA256 or _sha(args.parity) != PARITY_SHA256:
        raise RuntimeError("registered D60 native input or corrected parity changed")
    if (
        _sha(Path(__file__).with_name("audit_d60_broad_swing_source.py"))
        != FROZEN_SOURCE_READER_SHA256
    ):
        raise RuntimeError("frozen D60 source reader changed")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    if Path(identity["minute_catalog_root"]) != args.catalog_root:
        raise RuntimeError("H19a parity Catalog root differs from registered D60")
    if len(identity["coins"]) != 37 or not parity["all_exact"]:
        raise RuntimeError("H19a parity requires all 37 corrected native inputs")
    by_coin = {row["coin"]: row for row in parity["coins"]}
    start_ns, end_ns = _ns(parity["start_utc"]), _ns(parity["end_utc"])
    rows = []
    for input_row in identity["coins"]:
        coin = input_row["coin"]
        instrument, candles = _read_candles(
            args.catalog_root,
            input_row,
            by_coin[coin],
            start_ns,
            end_ns,
        )
        result = _check(candles)
        rows.append({"coin": coin, "instrument_id": instrument, **result})
        print(f"{coin}: {result['complete_four_hour_bars']} exact decisions", flush=True)
    output = {
        "schema": "r1-native-h19a-signal-parity/v1",
        "input_sha256": {"identity": INPUT_SHA256, "parity": PARITY_SHA256},
        "source_reader_sha256": _sha(Path(__file__).with_name("audit_d60_broad_swing_source.py")),
        "strategy_signal_sha256": _sha(Path(__file__).with_name("broad_swing_signal.py")),
        "coins": rows,
        "totals": {
            "coins": len(rows),
            "complete_four_hour_bars": sum(row["complete_four_hour_bars"] for row in rows),
            "selected_decisions": sum(row["selected_decisions"] for row in rows),
            "eligible_decisions": sum(row["eligible_decisions"] for row in rows),
        },
        "all_exact": True,
        "economic_data_read": False,
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
