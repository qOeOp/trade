"""
Check whether H15a's frozen native-input selector could have offered S44's BTC plan.

The source-frame bands are fixed in D59. This reader enumerates every distinct causally
selected pair in the source window; it does not select a profitable pair, create an
order, simulate a fill, or calculate a return.

"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_h13_source_gate import _utc
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_trendline_signal_parity import INPUT_SHA256
from retracement_strategy import ConfirmedSupportPullback
from strategy import FOUR_HOUR_NS
from strategy import FourHour

from vibe_trading.indicators import WilderMovingAverage


SELECTOR_SHA256 = "1cf4b5240f4341d24dbcf98c8755ee5d424c3882cb1d4369b645549eefdbb12e"
S44_SHA256 = "95ee11265c573022ea6904b547d98c74824c345d7091e4ec19cccd2fd925db07"
SOURCE_START_NS = _ns("2026-04-01T00:00:00Z")
SOURCE_CUTOFF_NS = _ns("2026-06-02T00:00:00Z")
A_BAND = (64_000.0, 69_000.0)
B_BAND = (80_000.0, 84_000.0)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _source_band_match(impulse: dict) -> bool:
    return (
        A_BAND[0] <= impulse["a_low"] <= A_BAND[1] and B_BAND[0] <= impulse["b_high"] <= B_BAND[1]
    )


def _record_pair(pairs: dict, pair: tuple[int, int], impulse: dict, selector, candle) -> None:
    if pair not in pairs:
        pairs[pair] = {
            "a_index": pair[0],
            "b_index": pair[1],
            "a_close_utc": _utc(selector.candles[pair[0]].ts_event),
            "b_close_utc": _utc(selector.candles[pair[1]].ts_event),
            "first_selected_utc": _utc(candle.ts_event),
            "selected_complete_bars": 0,
            "impulse": impulse,
            "source_band_match": _source_band_match(impulse),
        }
    pairs[pair]["selected_complete_bars"] += 1


def _retire_active(active, plan_row: dict | None, candle, pair: tuple[int, int] | None):
    if active is None or candle.ts_event <= active.ts_event:
        return active
    if candle.low <= active.entry:
        plan_row["retired_reason"] = "first_50_touch_while_live"
        plan_row["first_touch_low"] = candle.low
    elif pair is not None and pair != (active.a_index, active.b_index):
        plan_row["retired_reason"] = "superseded_before_touch"
    elif candle.ts_event >= active.ts_event + 30 * FOUR_HOUR_NS:
        plan_row["retired_reason"] = "expired_before_touch"
    if plan_row["retired_reason"] is not None:
        plan_row["retired_utc"] = _utc(candle.ts_event)
        return None
    return active


def _new_plan_row(plan) -> dict:
    return {
        "a_index": plan.a_index,
        "b_index": plan.b_index,
        "armed_utc": _utc(plan.ts_event),
        "a_low": plan.a_low,
        "b_high": plan.b_high,
        "level_50": plan.level_50,
        "level_618": plan.b_high - 0.618 * (plan.b_high - plan.a_low),
        "level_764": plan.level_764,
        "original_h15a_stop": plan.stop,
        "source_band_match": A_BAND[0] <= plan.a_low <= A_BAND[1]
        and B_BAND[0] <= plan.b_high <= B_BAND[1],
        "retired_reason": None,
    }


def _scan(candles: list) -> dict:
    selector = ConfirmedSupportPullback(
        timing="confirmed-update",
        support_mode="none",
        entry_ratio=0.5,
        minimum_target_r=0.0,
        stop_at_origin=True,
    )
    atr = WilderMovingAverage(14)
    pairs: dict[tuple[int, int], dict] = {}
    plans: list[dict] = []
    active = None
    active_plan_row = None
    source_bars = 0
    for raw in candles:
        if raw.ts_event >= SOURCE_CUTOFF_NS:
            break
        candle = FourHour(raw.ts_event, float(raw.high), float(raw.low), float(raw.close))
        prior_close = selector.candles[-1].close if selector.candles else candle.close
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - prior_close),
            abs(candle.low - prior_close),
        )
        plan = selector.on_closed(candle, atr.value if atr.initialized else None)
        atr.update_raw(true_range)
        impulse = selector.last_readout["impulse"]
        pair = (impulse["a_index"], impulse["b_index"]) if impulse else None

        if SOURCE_START_NS <= candle.ts_event < SOURCE_CUTOFF_NS:
            source_bars += 1
            if pair is not None:
                _record_pair(pairs, pair, impulse, selector, candle)

        active = _retire_active(active, active_plan_row, candle, pair)
        if plan is not None and SOURCE_START_NS <= candle.ts_event < SOURCE_CUTOFF_NS:
            if active is not None:
                raise RuntimeError("overlapping live H15a selector plans")
            active = plan
            active_plan_row = _new_plan_row(plan)
            plans.append(active_plan_row)
    if active is not None:
        active_plan_row["retired_reason"] = "untouched_at_source_cutoff"
    if source_bars < 300:
        raise RuntimeError("insufficient complete source-window four-hour bars")
    matched = [row for row in plans if row["source_band_match"]]
    pass_rows = [row for row in matched if row["retired_reason"] == "first_50_touch_while_live"]
    return {
        "complete_source_window_four_hour_bars": source_bars,
        "distinct_selected_pairs": len(pairs),
        "source_band_selected_pairs": sum(row["source_band_match"] for row in pairs.values()),
        "armed_h15a_plans": len(plans),
        "source_band_armed_plans": len(matched),
        "source_band_live_first_50_touches": len(pass_rows),
        "reuse_h15a_selector_source_gate_pass": bool(pass_rows),
        "pairs": sorted(pairs.values(), key=lambda row: (row["a_index"], row["b_index"])),
        "plans": plans,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--s44", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if _sha(args.input_identity) != INPUT_SHA256 or _sha(args.parity) != PARITY_SHA256:
        raise RuntimeError("frozen native Catalog identity or full parity changed")
    if _sha(args.s44) != S44_SHA256:
        raise RuntimeError("registered S44 source record changed")
    if _sha(Path(__file__).with_name("retracement_strategy.py")) != SELECTOR_SHA256:
        raise RuntimeError("H15a selector source changed")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    if not parity["all_exact"] or len(parity["coins"]) != 37:
        raise RuntimeError("complete 37-coin native parity required")
    input_row = next(row for row in identity["coins"] if row["coin"] == "BTC")
    parity_row = next(row for row in parity["coins"] if row["coin"] == "BTC")
    instrument, candles = _read_candles(
        Path(identity["minute_catalog_root"]),
        input_row,
        parity_row,
        _ns(parity["start_utc"]),
        _ns(parity["end_utc"]),
    )
    if instrument != "BTCUSDT-PERP.BINANCE":
        raise RuntimeError("BTC perpetual identity changed")
    scan = _scan(candles)
    output = {
        "schema": "r1-native-read-only-source-diagnostic/v1",
        "id": "D59",
        "registration": "RD_EXPERIMENTS.md D59 commit 329d3586d377bc6a024326747754a489013bf6c8",
        "method": "unchanged completed-four-hour H15a selector on registered BTC Binance perpetual LAST Catalog; enumerate all pairs and plan lifecycles in the source-frame window",
        "input_sha256": {
            "identity": INPUT_SHA256,
            "parity": PARITY_SHA256,
            "selector": SELECTOR_SHA256,
            "s44": S44_SHA256,
        },
        "source_window_utc": ["2026-04-01T00:00:00Z", "2026-06-02T00:00:00Z"],
        "source_frame_bands": {"a_low": list(A_BAND), "b_high": list(B_BAND)},
        "instrument_id": instrument,
        **scan,
        "economic_data_read": False,
        "limitations": [
            "Source-frame price bands are broad and TradingView venue differs from the native Binance perpetual.",
            "The S44 A/B drawing anchors and spoken deep-stop number lack independent verification.",
            "This checks reuse of the existing H15a selector and five-day plan life, not profitability of a distinct long-lived two-entry family.",
        ],
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
