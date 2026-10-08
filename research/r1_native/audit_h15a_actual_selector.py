"""
Check the implemented H15 selector at frozen BTC/ETH source cutoffs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_h13_source_gate import _utc
from audit_h13b_source_gate import S27
from audit_h14a_source_gate import S24_SHA256
from audit_h14a_source_gate import S27_SHA256
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_retracement_source_cases import CASES
from audit_trendline_signal_parity import INPUT_SHA256
from retracement_strategy import ConfirmedSupportPullback
from strategy import FOUR_HOUR_NS
from strategy import FourHour

from vibe_trading.indicators import WilderMovingAverage
from vibe_trading.persistence import ParquetDataCatalog


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _scan(candles, cutoffs) -> list[dict]:
    expected = {_ns(cutoff): cutoff for cutoff in cutoffs}
    state = ConfirmedSupportPullback(
        timing="confirmed-update",
        support_mode="none",
        entry_ratio=0.5,
        minimum_target_r=0.0,
        stop_at_origin=True,
    )
    atr = WilderMovingAverage(14)
    active = None
    rows = []
    for bar in candles:
        candle = FourHour(bar.ts_event, float(bar.high), float(bar.low), float(bar.close))
        previous_close = state.candles[-1].close if state.candles else candle.close
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - previous_close),
            abs(candle.low - previous_close),
        )
        plan = state.on_closed(candle, atr.value if atr.initialized else None)
        atr.update_raw(true_range)
        impulse = state.last_readout["impulse"]
        pair = (impulse["a_index"], impulse["b_index"]) if impulse else None
        if (
            active is not None
            and candle.ts_event > active.ts_event
            and (
                candle.low <= active.entry
                or candle.ts_event >= active.ts_event + 30 * FOUR_HOUR_NS
                or (pair is not None and pair != (active.a_index, active.b_index))
            )
        ):
            active = None
        if plan is not None:
            if active is not None:
                raise RuntimeError("more than one live H15 source plan")
            active = plan
        if candle.ts_event in expected:
            rows.append(
                {
                    "cutoff_utc": expected[candle.ts_event],
                    "selected_impulse": impulse,
                    "decision_reason": state.last_readout["reason"],
                    "active_untouched_plan": active.as_dict() if active is not None else None,
                    "active_armed_utc": _utc(active.ts_event) if active is not None else None,
                },
            )
        if candle.ts_event >= max(expected):
            break
    if len(rows) != len(expected):
        raise RuntimeError("missing frozen source cutoff")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--s27", type=Path, required=True)
    parser.add_argument("--s24", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for path, digest in (
        (args.input_identity, INPUT_SHA256),
        (args.parity, PARITY_SHA256),
        (args.s27, S27_SHA256),
        (args.s24, S24_SHA256),
    ):
        if _sha(path) != digest:
            raise RuntimeError(f"frozen source identity changed: {path}")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    if not parity["all_exact"] or len(parity["coins"]) != 37:
        raise RuntimeError("frozen 37-coin input parity failed")
    if Path(identity["minute_catalog_root"]) != args.catalog_root:
        raise RuntimeError("native Catalog root changed")
    rows = {}
    for coin, cases in (
        ("BTC", (("s27", S27["cutoffs"]), ("s24", CASES["BTC"]["cutoffs"]))),
        ("ETH", (("c19", CASES["ETH"]["cutoffs"]),)),
    ):
        input_row = next(row for row in identity["coins"] if row["coin"] == coin)
        parity_row = next(row for row in parity["coins"] if row["coin"] == coin)
        instrument_id, candles = _read_candles(
            args.catalog_root,
            input_row,
            parity_row,
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
        instruments = ParquetDataCatalog(str(args.catalog_root / coin / "minute")).instruments(
            instrument_ids=[instrument_id],
        )
        if len(instruments) != 1:
            raise RuntimeError(f"{coin}: native Instrument missing")
        rows[coin] = {name: _scan(candles, cutoffs) for name, cutoffs in cases}
    positive = rows["BTC"]["s27"]
    passed = all(
        row["active_untouched_plan"] is not None
        and row["active_untouched_plan"]["a_low"] == 67_711
        and row["active_untouched_plan"]["b_high"] == 72_858.5
        and row["active_untouched_plan"]["stop"] < 67_711
        for row in positive
    )
    result = {
        "method": "implemented H15 selector on frozen native four-hour source inputs; no orders or PnL",
        "audit_source_sha256": _sha(Path(__file__)),
        "selector_source_sha256": _sha(Path(__file__).with_name("retracement_strategy.py")),
        "input_identity_sha256": INPUT_SHA256,
        "parity_sha256": PARITY_SHA256,
        "rows": rows,
        "s27_exact_selector_passed": passed,
        "economic_data_read": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
