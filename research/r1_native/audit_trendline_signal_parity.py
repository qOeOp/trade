"""
Read-only H06 signal parity over exact native LAST Catalog instruments.

The frozen source rule and native Strategy helper are compared before any structural-
context or economic interpretation. This creates no orders or PnL.

"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import shutil
import subprocess
import sys
import tempfile
import types
from datetime import datetime
from itertools import pairwise
from pathlib import Path
from typing import NamedTuple

import pandas as pd
from audit_source_daily_context import _tree_digest
from strategy import FOUR_HOUR_NS
from trendline_strategy import ConfirmedLineBreaks
from trendline_strategy import LineCandle

from vibe_trading.indicators import WilderMovingAverage
from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


SOURCE_REF = (
    "0725a7b3f89902e27cd421a18b4b879a13268534:"
    "research/ronnie/combo/candidates/trendline_break_strong.py"
)
SOURCE_SHA256 = "090142d1e7ee758d37fca11be24c1c8c95589ae3f1b413c55c0929ef79c4d202"
INPUT_SHA256 = "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc"
INTERVAL_NS = 300_000_000_000
MILLISECOND_NS = 1_000_000


class FrozenSignal(NamedTuple):
    time: pd.Timestamp
    side: int
    stop: float
    target: float
    max_bars: int


def _ns(value: str) -> int:
    return int(datetime.fromisoformat(value).timestamp() * 1e9)


def _source_signals_function():
    git = shutil.which("git")
    if git is None:
        raise RuntimeError("git is required to read frozen trend-line source")
    source = subprocess.check_output([git, "show", SOURCE_REF])
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise RuntimeError("frozen trend-line source bytes changed")
    stub = types.ModuleType("harness")
    stub.Signal = FrozenSignal
    previous = sys.modules.get("harness")
    sys.modules["harness"] = stub
    try:
        with tempfile.TemporaryDirectory(prefix="r1-h06-source-") as directory:
            path = Path(directory) / "trendline_break_strong.py"
            path.write_bytes(source)
            spec = importlib.util.spec_from_file_location("r1_h06_frozen_source", path)
            if spec is None or spec.loader is None:
                raise RuntimeError("cannot load frozen trend-line source")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module.signals
    finally:
        if previous is None:
            del sys.modules["harness"]
        else:
            sys.modules["harness"] = previous


def _closed_four_hour(bars, start_ns: int, end_ns: int):
    expected = (end_ns - start_ns) // INTERVAL_NS
    if len(bars) != expected or expected <= 0:
        raise RuntimeError(f"LAST coverage {len(bars)} differs from {expected}")
    if any(
        bar.ts_event != start_ns + (i + 1) * INTERVAL_NS - MILLISECOND_NS
        for i, bar in enumerate(bars)
    ):
        raise RuntimeError("five-minute LAST input is not contiguous")
    candles: list[LineCandle] = []
    bucket = None
    count = 0
    opened = high = low = closed = 0.0
    for bar in bars:
        bar_end = bar.ts_event + MILLISECOND_NS
        current_bucket = ((bar_end - 1) // FOUR_HOUR_NS) * FOUR_HOUR_NS
        if bucket != current_bucket:
            if bucket is not None:
                if count != 48:
                    raise RuntimeError("non-terminal four-hour bar is incomplete")
                candles.append(
                    LineCandle(bucket + FOUR_HOUR_NS, opened, high, low, closed),
                )
            bucket = current_bucket
            count = 0
            opened = float(bar.open)
            high = float(bar.high)
            low = float(bar.low)
        count += 1
        high = max(high, float(bar.high))
        low = min(low, float(bar.low))
        closed = float(bar.close)
    if bucket is not None and count == 48:
        candles.append(LineCandle(bucket + FOUR_HOUR_NS, opened, high, low, closed))
        partial = 0
    else:
        partial = count
    if any(b.ts_event - a.ts_event != FOUR_HOUR_NS for a, b in pairwise(candles)):
        raise RuntimeError("four-hour close times are not contiguous")
    return candles, partial


def _same_price(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=1e-10, abs_tol=1e-12)


def _compare_coin(candles: list[LineCandle], trade_start_ns: int, source_signals):
    frame = pd.DataFrame(
        {
            "open": [bar.open for bar in candles],
            "high": [bar.high for bar in candles],
            "low": [bar.low for bar in candles],
            "close": [bar.close for bar in candles],
        },
        index=pd.to_datetime(
            [bar.ts_event - FOUR_HOUR_NS for bar in candles],
            utc=True,
        ),
    )
    frozen = [
        signal for signal in source_signals({"4h": frame}) if signal.time.value >= trade_start_ns
    ]
    state = ConfirmedLineBreaks()
    atr = WilderMovingAverage(14)
    native = []
    for candle in candles:
        previous_close = state.candles[-1].close if state.candles else candle.close
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - previous_close),
            abs(candle.low - previous_close),
        )
        prior_atr = atr.value if atr.initialized else None
        native.extend(
            signal
            for signal in state.on_closed(candle, prior_atr)
            if signal.ts_event >= trade_start_ns
        )
        atr.update_raw(true_range)
    mismatches = []
    for index, (old, new) in enumerate(zip(frozen, native, strict=False)):
        if (
            old.time.value != new.ts_event
            or old.side != new.side
            or not _same_price(old.stop, new.stop)
            or not _same_price(old.target, new.target)
        ):
            mismatches.append(
                {
                    "index": index,
                    "source": [old.time.value, old.side, old.stop, old.target],
                    "native": [new.ts_event, new.side, new.stop, new.target],
                },
            )
    return {
        "frozen_signals": len(frozen),
        "native_signals": len(native),
        "first_crosses": state.first_crosses,
        "weak_crosses": state.weak_crosses,
        "exact_match": len(frozen) == len(native) and not mismatches,
        "mismatches_first_five": mismatches[:5],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--native-summary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.input_identity.read_bytes()).hexdigest() != INPUT_SHA256:
        raise RuntimeError("registered input identity bytes changed")
    identity = json.loads(args.input_identity.read_text())
    summary = json.loads(args.native_summary.read_text())
    by_coin = {row["coin"]: row for row in summary["per_coin"]}
    start_ns = _ns(summary["input_start_utc"])
    trade_start_ns = _ns(summary["period_start_utc"])
    end_ns = _ns(summary["period_end_utc"])
    source_signals = _source_signals_function()
    output = {
        "scope": "read-only H06 source/native signal parity; no orders, fills, PnL or account replay",
        "source_ref": SOURCE_REF,
        "source_sha256": SOURCE_SHA256,
        "strategy_sha256": hashlib.sha256(
            Path(__file__).with_name("trendline_strategy.py").read_bytes(),
        ).hexdigest(),
        "input_identity_sha256": INPUT_SHA256,
        "native_summary_sha256": hashlib.sha256(
            args.native_summary.read_bytes(),
        ).hexdigest(),
        "start_utc": summary["input_start_utc"],
        "trade_start_utc": summary["period_start_utc"],
        "end_utc": summary["period_end_utc"],
        "method": "Use each Catalog manifest InstrumentId, validate tree and full five-minute LAST coverage, aggregate completed UTC four-hour bars, compare unchanged frozen source signals with existing native helper before account events.",
        "coins": [],
    }
    for row in identity["coins"]:
        coin = row["coin"]
        root = args.catalog_root / coin / "minute"
        if _tree_digest(root) != row["minute_catalog"]["sha256"]:
            raise RuntimeError(
                f"{coin}: minute Catalog differs from registered identity",
            )
        completion = json.loads((root / "r1-download-complete.json").read_text())
        instrument = completion["instrument"]
        if (
            instrument != by_coin[coin]["instrument"]
            or completion["start_ns"] != start_ns
            or completion["end_ns"] != end_ns
            or completion["bar_minutes"] != 5
        ):
            raise RuntimeError(f"{coin}: Catalog instrument or interval differs")
        bar_type = BarType.from_str(f"{instrument}-5-MINUTE-LAST-EXTERNAL")
        catalog = ParquetDataCatalog(str(root))
        bars = sorted(
            (
                bar
                for bar in catalog.query_bars([instrument], start=start_ns, end=end_ns)
                if bar.bar_type == bar_type
            ),
            key=lambda bar: bar.ts_event,
        )
        candles, partial = _closed_four_hour(bars, start_ns, end_ns)
        compared = _compare_coin(candles, trade_start_ns, source_signals)
        compared.update(
            {
                "coin": coin,
                "instrument": instrument,
                "five_minute_bars": len(bars),
                "complete_four_hour_bars": len(candles),
                "partial_four_hour_bars": partial,
                "native_report_signals": by_coin[coin]["signals"],
                "native_report_first_crosses": by_coin[coin]["line_breaks"]["first_crosses"],
                "native_report_weak_crosses": by_coin[coin]["line_breaks"]["weak_crosses"],
            },
        )
        compared["report_match"] = (
            compared["native_signals"] == compared["native_report_signals"]
            and compared["first_crosses"] == compared["native_report_first_crosses"]
            and compared["weak_crosses"] == compared["native_report_weak_crosses"]
        )
        output["coins"].append(compared)
        print(
            f"{coin}: {len(bars)} LAST, {compared['native_signals']} signals, "
            f"source={compared['exact_match']}, report={compared['report_match']}",
            flush=True,
        )
    output["all_exact"] = len(output["coins"]) == len(identity["coins"]) == len(
        by_coin,
    ) == 37 and all(
        row["five_minute_bars"] > 0 and row["exact_match"] and row["report_match"]
        for row in output["coins"]
    )
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    if not output["all_exact"]:
        raise RuntimeError("H06 full-coverage source/native parity failed; see output")


if __name__ == "__main__":
    main()
