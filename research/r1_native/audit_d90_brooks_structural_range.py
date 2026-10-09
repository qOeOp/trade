"""Read-only prior swing support/resistance tests at H19a order submission."""

from __future__ import annotations

import gzip
import hashlib
import io
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from nautilus_trader.indicators import WilderMovingAverage

from audit_d80_brooks_breakout_context import native_bars
from audit_d88_brooks_leg_context import summarize


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
IDENTITY = RESULTS / "2026-10-07-input-identity.json"
D80 = RESULTS / "2026-10-08-d80-brooks-breakout-context-bundles.json.gz"
D88 = RESULTS / "2026-10-08-d88-brooks-leg-context-bundles.json.gz"
OUT = RESULTS / "2026-10-08-d90-brooks-structural-range.json"
DETAIL = RESULTS / "2026-10-08-d90-brooks-structural-range-bundles.json.gz"
EXPECTED = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    D80: "ac941cfa197cee805c38d7447c296e05aa5819344312cd755e5d574dcac192c4",
    D88: "fb6d92e1330e9ebd92ba1da725849ee78e9f77d9d47a6bc245feb73d407299fa",
}
PIVOT_ORDER = 8
HISTORY_BARS = 180


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atr_before(bars: list[dict]) -> list[float | None]:
    average = WilderMovingAverage(14)
    previous_close = None
    values = []
    for bar in bars:
        values.append(average.value if average.initialized else None)
        true_range = max(
            bar["high"] - bar["low"],
            abs(bar["high"] - (previous_close if previous_close is not None else bar["close"])),
            abs(bar["low"] - (previous_close if previous_close is not None else bar["close"])),
        )
        average.update_raw(true_range)
        previous_close = bar["close"]
    return values


def pivots(bars: list[dict], signal_i: int, bound_i: int, side: str) -> list[int]:
    field = "high" if side == "high" else "low"
    compare = max if side == "high" else min
    first = max(PIVOT_ORDER, signal_i - HISTORY_BARS + 1)
    return [
        j for j in range(first, min(bound_i, signal_i - PIVOT_ORDER + 1))
        if bars[j][field] == compare(bar[field] for bar in bars[j - PIVOT_ORDER : j + PIVOT_ORDER + 1])
    ]


def compare_groups(rows: list[dict], split: str, target: str) -> dict:
    by = defaultdict(lambda: defaultdict(list))
    for row in rows:
        by[row[split]][row["prior_test_state"]].extend(
            p for p in row["native_positions"] if p["closed"]
        )
    comparable = []
    for label, groups in by.items():
        neither, selected = groups["neither"], groups[target]
        if len(neither) < 3 or len(selected) < 3:
            continue
        nw = sum(Decimal(p["native_final_realized_pnl_usdt"]) > 0 for p in neither)
        sw = sum(Decimal(p["native_final_realized_pnl_usdt"]) > 0 for p in selected)
        comparable.append({
            "group": label, "neither_closed": len(neither), "neither_wins": nw,
            "selected_closed": len(selected), "selected_wins": sw,
            "selected_win_rate_higher": sw / len(selected) > nw / len(neither),
        })
    return {
        "groups_with_at_least_3_closed_each": len(comparable),
        "selected_win_rate_higher": sum(row["selected_win_rate_higher"] for row in comparable),
        "all_comparable": sorted(comparable, key=lambda row: row["group"]),
    }


def main() -> None:
    for path, expected in EXPECTED.items():
        if sha(path) != expected:
            raise RuntimeError(f"frozen native source changed: {path}")
    identity = json.loads(IDENTITY.read_text())
    with gzip.open(D80, "rt") as stream:
        d80 = {row["bundle_id"]: row for row in json.load(stream)}
    with gzip.open(D88, "rt") as stream:
        original = json.load(stream)
    if len(d80) != 2939 or len(original) != 2939:
        raise RuntimeError("frozen native bundle population changed")
    by_coin = defaultdict(list)
    for row in original:
        by_coin[row["coin"]].append(row)
    output = []
    for coin_identity in identity["coins"]:
        coin = coin_identity["coin"]
        instrument, bars, _ = native_bars(
            Path(identity["minute_catalog_root"]), coin,
            coin_identity["minute_catalog"]["sha256"],
        )
        by_end = {bar["end_ns"]: i for i, bar in enumerate(bars)}
        prior_atr = atr_before(bars)
        for row in by_coin[coin]:
            source = d80[row["bundle_id"]]
            ai = by_end[row["a_end_ns"]]
            bi = by_end[row["b_end_ns"]]
            si = by_end[source["signal_end_ns"]]
            if not (ai < bi <= si and bars[si]["end_ns"] < row["native_submission_ns"]):
                raise RuntimeError(f"{row['bundle_id']}: source confirmation after submission")
            atr = prior_atr[si]
            if atr is None or atr <= 0:
                raise RuntimeError(f"{row['bundle_id']}: no prior native ATR")
            a = instrument.make_price(bars[ai]["low"]).as_double()
            b = instrument.make_price(bars[bi]["high"]).as_double()
            older_lows = pivots(bars, si, ai, "low")
            older_highs = pivots(bars, si, bi, "high")
            support = [j for j in older_lows if abs(bars[j]["low"] - a) <= atr]
            resistance = [j for j in older_highs if abs(bars[j]["high"] - b) <= atr]
            state = (
                "both" if support and resistance
                else "a_support_only" if support
                else "b_resistance_only" if resistance
                else "neither"
            )
            output.append({
                **row,
                "prior_14bar_wilder_atr": atr,
                "prior_confirmed_support_test_count": len(support),
                "prior_confirmed_resistance_test_count": len(resistance),
                "prior_test_state": state,
                "nearest_prior_support_bar_end_ns": bars[support[-1]]["end_ns"] if support else None,
                "nearest_prior_resistance_bar_end_ns": bars[resistance[-1]]["end_ns"] if resistance else None,
            })
    output.sort(key=lambda row: (row["native_submission_ns"], row["bundle_id"]))
    if len(output) != 2939 or len({row["bundle_id"] for row in output}) != 2939:
        raise RuntimeError("D90 native population incomplete")
    result = {
        "schema": "r1-native-d90-brooks-structural-range/v1",
        "source_sha256": {str(path): digest for path, digest in EXPECTED.items()},
        "all": summarize(output),
        "by_prior_test_state": {state: summarize([row for row in output if row["prior_test_state"] == state]) for state in ("neither", "a_support_only", "b_resistance_only", "both")},
        "state_vs_neither_stability": {
            state: {
                "coins": compare_groups(output, "coin", state),
                "months": compare_groups(output, "submission_month_utc", state),
            }
            for state in ("a_support_only", "b_resistance_only", "both")
        },
        "both_test_winning_bundle_ids": [row["bundle_id"] for row in output if row["prior_test_state"] == "both" and any(p["closed"] and Decimal(p["native_final_realized_pnl_usdt"]) > 0 for p in row["native_positions"])],
        "both_test_nonwinning_bundle_ids": [row["bundle_id"] for row in output if row["prior_test_state"] == "both" and any(p["closed"] and Decimal(p["native_final_realized_pnl_usdt"]) <= 0 for p in row["native_positions"])],
        "limitations": ["One fixed native-bar structural proxy with eight-bar pivot confirmation and one prior ATR tolerance; Brooks gives no numerical ATR rule.", "Native Position groups include fees/funding but are selected descriptive old outcomes, not a filtered shared-account replay."],
    }
    if (result["all"]["native_positions"], result["all"]["native_closed"], result["all"]["native_wins"]) != (507, 496, 212):
        raise RuntimeError("frozen H19a Position outcomes changed")
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    with DETAIL.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0) as compressed, io.TextIOWrapper(compressed, encoding="utf-8") as stream:
        json.dump(output, stream)


if __name__ == "__main__":
    main()
