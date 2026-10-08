"""
Count preregistered D60 order opportunities across native 37-coin LAST Catalogs.

Bar reaches are descriptive. This reader creates no orders, fills, equity or PnL.

"""

from __future__ import annotations

import argparse
import hashlib
import json
from itertools import pairwise
from pathlib import Path

from audit_d60_broad_swing_source import PLAN_LIFE_BARS
from audit_d60_broad_swing_source import REGISTRATION_COMMIT
from audit_d60_broad_swing_source import _advance_active
from audit_d60_broad_swing_source import _eligible_at_decision
from audit_d60_broad_swing_source import _plan_row
from audit_d60_broad_swing_source import _selected
from audit_h13_source_gate import _utc
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_trendline_signal_parity import INPUT_SHA256
from strategy import FourHour

from vibe_trading.indicators import WilderMovingAverage
from vibe_trading.persistence import ParquetDataCatalog


SOURCE_SHA256 = "c4e653dd6647edb66b8e9bf987df568ff968af1c652f26abf2ae71456ee397ba"
SOURCE_READER_SHA256 = "f2ae538096df254d7037523ce6744d80cd898707074536138eb8616d4355f8cc"
REFERENCE_EQUITY = 100_000.0
RISK_FRACTION = 0.0025
NOTIONAL_FRACTION = 0.05


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _quantized(selected: dict, instrument) -> tuple[dict | None, str | None]:
    if selected["stop"] <= 0:
        return None, "nonpositive_raw_stop"
    row = {**selected}
    for field in ("level_50", "level_618", "stop", "target"):
        row[field] = instrument.make_price(row[field]).as_double()
    levels = (row["level_50"], row["level_618"])
    stop, target = row["stop"], row["target"]
    if not (
        0 < stop < levels[-1] and all(a > b for a, b in pairwise(levels)) and levels[0] < target
    ):
        return None, "rounded_price_order_invalid"
    multiplier = instrument.multiplier.as_double()
    quantities = []
    for entry in levels:
        raw = min(
            REFERENCE_EQUITY * RISK_FRACTION / len(levels) / ((entry - stop) * multiplier),
            REFERENCE_EQUITY * NOTIONAL_FRACTION / len(levels) / (entry * multiplier),
        )
        quantity = instrument.make_qty(raw, round_down=True)
        if quantity.as_double() <= 0:
            return None, "zero_rounded_quantity"
        if (
            instrument.min_quantity is not None
            and quantity.as_decimal() < instrument.min_quantity.as_decimal()
        ):
            return None, "below_min_quantity"
        if (
            instrument.min_notional is not None
            and quantity.as_double() * entry * multiplier < instrument.min_notional.as_double()
        ):
            return None, "below_min_notional"
        quantities.append(quantity.as_double())
    risk = sum(
        qty * (entry - stop) * multiplier for qty, entry in zip(quantities, levels, strict=True)
    )
    notional = sum(qty * entry * multiplier for qty, entry in zip(quantities, levels, strict=True))
    if risk <= 0 or risk > REFERENCE_EQUITY * RISK_FRACTION + 1e-8:
        return None, "rounded_risk_outside_budget"
    if notional > REFERENCE_EQUITY * NOTIONAL_FRACTION + 1e-8:
        return None, "rounded_notional_outside_cap"
    row["reference_tier_quantities"] = quantities
    row["reference_total_stop_risk"] = risk
    row["reference_total_notional"] = notional
    return row, None


def _scan(candles: list, instrument, trade_start_ns: int) -> dict:
    state: list[FourHour] = []
    atr = WilderMovingAverage(14)
    planned_pairs: set[tuple[int, int]] = set()
    bundles: list[dict] = []
    invalid: dict[str, int] = {}
    active: dict | None = None
    for raw in candles:
        candle = FourHour(raw.ts_event, float(raw.high), float(raw.low), float(raw.close))
        prior_close = state[-1].close if state else candle.close
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - prior_close),
            abs(candle.low - prior_close),
        )
        state.append(candle)
        i = len(state) - 1
        selected = _selected(state, i, atr.value if atr.initialized else None)
        atr.update_raw(true_range)
        active = _advance_active(active, selected, i, candle)
        if selected is None or candle.ts_event < trade_start_ns or active is not None:
            continue
        pair = (selected["a_index"], selected["b_index"])
        if pair in planned_pairs or not _eligible_at_decision(state, i, selected):
            continue
        rounded, reason = _quantized(selected, instrument)
        if reason is not None:
            invalid[reason] = invalid.get(reason, 0) + 1
            planned_pairs.add(pair)
            continue
        if not _eligible_at_decision(state, i, rounded):
            continue
        active = _plan_row(rounded, i, candle, state)
        planned_pairs.add(pair)
        bundles.append(active)
    if active is not None:
        active["retired_reason"] = "live_at_catalog_end"
    reached_50 = [row for row in bundles if row["first_50_reach_utc"] is not None]
    reached_618 = [row for row in bundles if row["first_618_reach_utc"] is not None]
    return {
        "complete_four_hour_bars": len(candles),
        "distinct_valid_bundles": len(bundles),
        "distinct_first_50_reaches": len(reached_50),
        "distinct_first_618_reaches": len(reached_618),
        "first_50_same_bar_stop_crosses": sum(
            row["first_reach_bar_below_stop"] for row in reached_50
        ),
        "invalid_geometry_or_quantity": invalid,
        "bundles": bundles,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--source-result", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for path, expected in (
        (args.input_identity, INPUT_SHA256),
        (args.parity, PARITY_SHA256),
        (args.source_result, SOURCE_SHA256),
        (Path(__file__).with_name("audit_d60_broad_swing_source.py"), SOURCE_READER_SHA256),
    ):
        if _sha(path) != expected:
            raise RuntimeError(f"frozen D60 input changed: {path}")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    source = json.loads(args.source_result.read_text())
    if not source["source_gate_pass"] or not parity["all_exact"]:
        raise RuntimeError("D60 source or complete parity gate failed")
    if len(identity["coins"]) != len(parity["coins"]) or len(parity["coins"]) != 37:
        raise RuntimeError("D60 requires exactly 37 registered native Catalogs")
    parity_by_coin = {row["coin"]: row for row in parity["coins"]}
    catalog_root = Path(identity["minute_catalog_root"])
    start_ns, end_ns = _ns(parity["start_utc"]), _ns(parity["end_utc"])
    trade_start_ns = _ns(parity["trade_start_utc"])
    by_coin = []
    for input_row in identity["coins"]:
        coin = input_row["coin"]
        parity_row = parity_by_coin[coin]
        instrument_id, candles = _read_candles(
            catalog_root,
            input_row,
            parity_row,
            start_ns,
            end_ns,
        )
        catalog = ParquetDataCatalog(str(catalog_root / coin / "minute"))
        instruments = catalog.instruments(instrument_ids=[instrument_id])
        if len(instruments) != 1 or str(instruments[0].id) != instrument_id:
            raise RuntimeError(f"{coin}: native Instrument identity mismatch")
        counts = _scan(candles, instruments[0], trade_start_ns)
        by_coin.append({"coin": coin, "instrument_id": instrument_id, **counts})
        print(
            f"{coin}: {counts['distinct_valid_bundles']} bundles, "
            f"{counts['distinct_first_50_reaches']} first-50 reaches, "
            f"{counts['distinct_first_618_reaches']} first-61.8 reaches",
            flush=True,
        )
    total_50 = sum(row["distinct_first_50_reaches"] for row in by_coin)
    total_618 = sum(row["distinct_first_618_reaches"] for row in by_coin)
    output = {
        "schema": "r1-native-read-only-capacity-diagnostic/v1",
        "id": "D60",
        "registration_commit": REGISTRATION_COMMIT,
        "input_sha256": {
            "identity": INPUT_SHA256,
            "parity": PARITY_SHA256,
            "source_result": SOURCE_SHA256,
            "source_reader": SOURCE_READER_SHA256,
        },
        "trade_start_utc": _utc(trade_start_ns),
        "end_utc": _utc(end_ns),
        "reference_equity_for_instrument_sizing": REFERENCE_EQUITY,
        "risk_fraction": RISK_FRACTION,
        "notional_fraction": NOTIONAL_FRACTION,
        "bundle_life_bars": PLAN_LIFE_BARS,
        "totals": {
            "distinct_valid_bundles": sum(row["distinct_valid_bundles"] for row in by_coin),
            "distinct_first_50_reaches": total_50,
            "distinct_first_618_reaches": total_618,
            "first_50_same_bar_stop_crosses": sum(
                row["first_50_same_bar_stop_crosses"] for row in by_coin
            ),
        },
        "capacity_gate_pass": total_50 >= 200 and total_618 >= 100,
        "by_coin": by_coin,
        "economic_data_read": False,
        "limitations": [
            "Instrument terms are current Catalog terms, not proven historical terms.",
            "100,000-USDT fixed reference sizing is an instrument feasibility check; actual Portfolio equity varies.",
            "Four-hour LAST bar reach is not a native fill and cannot establish account return.",
            "An engaged bundle remains until its fixed expiry in this conservative count; native target/stop termination can change later capacity.",
        ],
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
