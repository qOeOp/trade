"""D86 read-only native B-target micro-gap and protected-runner capacity read."""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from audit_d80_brooks_breakout_context import END
from audit_d80_brooks_breakout_context import FIVE_MIN_NS
from audit_d80_brooks_breakout_context import FOUR_HOUR_NS
from audit_d80_brooks_breakout_context import START
from audit_d80_brooks_breakout_context import tree_digest
from nautilus_trader.model import BarType
from nautilus_trader.persistence import ParquetDataCatalog


ROOT = Path(__file__).resolve().parent
IDENTITY = ROOT / "results/2026-10-07-input-identity.json"
D82 = ROOT / "results/2026-10-08-d82-post-touch-bull-response-bundles.json.gz"
H19 = Path("/tmp/r1-h23a-paired-h19a-37")
PARITY = ROOT / "results/2026-10-08-h23a-paired-h19a-parity.json"
OUT = ROOT / "results/2026-10-08-d86-b-target-micro-gap.json"
DETAIL = ROOT / "results/2026-10-08-d86-b-target-micro-gap-cases.json.gz"
HASHES = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    D82: "3e30f06d99f4173d193a5f9051551c3412194dcb5c022d3a06146b02135788e1",
    H19
    / "summary.json": "393e237f66eb684501d05eb77696e1af42d963de77c2482da7d204ba6e629645",
    H19
    / "orders.csv": "4f5670e832331b9ecf3d82a01b0f30d8a654d79fe5f361acac0b2811aed84a0b",
    H19
    / "positions.csv": "b65e1316bd61e09c6502ea2ab3f2b8aa52a484d73aad6cc28b6da1ef574e3e6d",
    PARITY: "a16c903ea36377988097f838d74b7ae998625d3579350a0f2f1ebb073c99df93",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dec(value: object) -> Decimal:
    return Decimal(str(value))


def native_last(coin: str, catalog_root: Path, tree_hash: str):
    minute_root = catalog_root / coin / "minute"
    if tree_digest(minute_root) != tree_hash:
        raise RuntimeError(f"{coin}: registered native Catalog tree changed")
    catalog = ParquetDataCatalog(str(minute_root))
    instrument_id = json.loads((minute_root / "r1-download-complete.json").read_text())[
        "instrument"
    ]
    last_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
    minute = sorted(
        (
            bar
            for bar in catalog.query_bars([instrument_id], start=START, end=END)
            if bar.bar_type == last_type
        ),
        key=lambda bar: bar.ts_event,
    )
    expected = (END - START) // FIVE_MIN_NS
    if len(minute) != expected:
        raise RuntimeError(f"{coin}: native LAST bar coverage differs")
    for i, bar in enumerate(minute):
        if bar.ts_event != START + (i + 1) * FIVE_MIN_NS - 1_000_000:
            raise RuntimeError(f"{coin}: native LAST clock gap at {i}")
    four_hour = []
    for i in range(0, len(minute) - len(minute) % 48, 48):
        group = minute[i : i + 48]
        four_hour.append(
            {
                "end_ns": group[-1].ts_event,
                "high": max(dec(bar.high) for bar in group),
                "low": min(dec(bar.low) for bar in group),
                "close": dec(group[-1].close),
            }
        )
    return minute, four_hour


def classify(case: dict, minute: list, four_hour: list[dict]) -> dict:
    fill_ns = case["target_fill_ns"]
    stop = dec(case["stop"])
    b = dec(case["b"])
    first_tier = dec(case["first_tier"])
    continuation = b + (first_tier - stop)
    minute_i = (fill_ns - START) // FIVE_MIN_NS
    four_i = (fill_ns - START) // FOUR_HOUR_NS
    result = {
        **case,
        "continuation_b_plus_first_tier_r": str(continuation),
        "breakout_bar_index": four_i,
        "following_gap_observable": False,
    }
    if (
        minute_i < 0
        or minute_i >= len(minute)
        or four_i < 1
        or four_i + 1 >= len(four_hour)
    ):
        return {**result, "state": "window_censored"}
    preceding, breakout, following = (
        four_hour[four_i - 1],
        four_hour[four_i],
        four_hour[four_i + 1],
    )
    if not minute[minute_i].ts_event <= fill_ns < minute[minute_i].ts_event + 1_000_000:
        raise RuntimeError(
            f"{case['bundle_id']}: native target fill not on expected LAST minute"
        )
    decision_minute_i = (four_i + 2) * 48 - 1
    if decision_minute_i >= len(minute):
        return {**result, "state": "window_censored"}
    same_minute_stop = dec(minute[minute_i].low) <= stop
    stopped_before_decision = any(
        dec(bar.low) <= stop for bar in minute[minute_i + 1 : decision_minute_i + 1]
    )
    gap = following["low"] > preceding["high"]
    result.update(
        {
            "preceding_high": str(preceding["high"]),
            "breakout_close": str(breakout["close"]),
            "breakout_closed_above_b": breakout["close"] > b,
            "following_low": str(following["low"]),
            "following_bar_end_ns": following["end_ns"],
            "micro_gap": gap,
            "following_low_above_b": following["low"] > b,
            "same_target_minute_touched_old_stop": same_minute_stop,
            "post_target_old_stop_before_gap_observation": stopped_before_decision,
            "continuation_touched_before_gap_observation": any(
                dec(bar.high) >= continuation
                for bar in minute[minute_i : decision_minute_i + 1]
            ),
        }
    )
    if same_minute_stop:
        return {**result, "state": "target_minute_ambiguous"}
    if stopped_before_decision:
        return {**result, "state": "runner_stop_before_gap_observation"}
    result["following_gap_observable"] = True
    horizon = four_hour[four_i + 2 : four_i + 22]
    if len(horizon) < 20:
        return {**result, "state": "outcome_end_censored", "horizon_bars": len(horizon)}
    for i, bar in enumerate(horizon, start=1):
        reaches_continuation = bar["high"] >= continuation
        touches_stop = bar["low"] <= stop
        if reaches_continuation and touches_stop:
            return {**result, "state": "outcome_same_bar_ambiguous", "outcome_bar": i}
        if reaches_continuation:
            return {**result, "state": "continuation_before_stop", "outcome_bar": i}
        if touches_stop:
            return {**result, "state": "stop_before_continuation", "outcome_bar": i}
    return {**result, "state": "outcome_not_reached_in_20_bars", "horizon_bars": 20}


def group_stats(cases: list[dict]) -> dict:
    observed = [row for row in cases if row["following_gap_observable"]]
    fresh = [
        row
        for row in observed
        if not row.get("continuation_touched_before_gap_observation", False)
    ]
    evaluable = [
        row
        for row in observed
        if row["state"] in {"continuation_before_stop", "stop_before_continuation"}
    ]
    return {
        "target_exit_bundles": len(cases),
        "observable_after_old_stop_survival": len(observed),
        "states": dict(sorted(Counter(row["state"] for row in cases).items())),
        "breakout_closed_above_b": sum(
            row.get("breakout_closed_above_b", False) for row in cases
        ),
        "following_low_above_b": sum(
            row.get("following_low_above_b", False) for row in observed
        ),
        "continuation_already_touched_before_gap_observation": sum(
            row.get("continuation_touched_before_gap_observation", False)
            for row in observed
        ),
        "fresh_after_gap_observation": len(fresh),
        "fresh_future_continuation_before_stop": sum(
            row["state"] == "continuation_before_stop" for row in fresh
        ),
        "fresh_future_stop_before_continuation": sum(
            row["state"] == "stop_before_continuation" for row in fresh
        ),
        "fresh_future_unreached_or_censored": sum(
            row["state"] not in {"continuation_before_stop", "stop_before_continuation"}
            for row in fresh
        ),
        "evaluable_future_first_crosses": len(evaluable),
        "future_continuation_before_stop": sum(
            row["state"] == "continuation_before_stop" for row in evaluable
        ),
        "original_native_target_pnl_usdt": str(
            sum((dec(row["original_target_pnl_usdt"]) for row in cases), Decimal(0))
        ),
    }


def main() -> None:
    for path, expected in HASHES.items():
        if sha(path) != expected:
            raise RuntimeError(f"frozen D86 input changed: {path}")
    if not json.loads(PARITY.read_text())["parity_passed"]:
        raise RuntimeError("native H19a frozen parity failed")
    identity = json.loads(IDENTITY.read_text())
    catalog_root = Path(identity["minute_catalog_root"])
    with gzip.open(D82, "rt") as stream:
        originals = json.load(stream)
    if len(identity["coins"]) != 37 or len(originals) != 500:
        raise RuntimeError("registered 37-coin H19a source population changed")
    with (H19 / "orders.csv").open(newline="") as stream:
        old_orders = list(csv.DictReader(stream))
    by_prefix = defaultdict(list)
    for order in old_orders:
        if order["tags"] == "['ENTRY']":
            by_prefix[order["client_order_id"].rsplit("-", 1)[0]].append(order)
    cases_by_coin = defaultdict(list)
    for original in originals:
        target_positions = [
            position
            for position in original["native_positions"]
            if position["close_cause"] == "target"
        ]
        if not target_positions:
            continue
        position = min(target_positions, key=lambda row: row["native_close_ns"])
        parents = by_prefix[original["bundle_id"]]
        if len(parents) != 2:
            raise RuntimeError(
                f"{original['bundle_id']}: native original tiers missing"
            )
        first_tier = max(dec(parent["price"]) for parent in parents)
        cases_by_coin[original["coin"]].append(
            {
                "bundle_id": original["bundle_id"],
                "coin": original["coin"],
                "submission_month_utc": original["submission_month_utc"],
                "position_id": position["position_id"],
                "target_fill_ns": position["native_close_ns"],
                "original_target_pnl_usdt": position["native_final_realized_pnl_usdt"],
                "first_tier": str(first_tier),
                "stop": original["original_stop_px"],
                "b": original["original_target_b_px"],
            }
        )
    cases = []
    for coin_identity in identity["coins"]:
        coin = coin_identity["coin"]
        minute, four_hour = native_last(
            coin,
            catalog_root,
            coin_identity["minute_catalog"]["sha256"],
        )
        for case in cases_by_coin[coin]:
            cases.append(classify(case, minute, four_hour))
    cases.sort(key=lambda row: (row["target_fill_ns"], row["coin"]))
    gap = [row for row in cases if row.get("micro_gap")]
    no_gap = [row for row in cases if row.get("micro_gap") is False]
    by_coin = {
        coin: group_stats(group)
        for coin, group in sorted(
            (
                (coin, [row for row in cases if row["coin"] == coin])
                for coin in cases_by_coin
            ),
            key=lambda item: item[0],
        )
    }
    by_month = {
        month: group_stats(
            [row for row in cases if row["submission_month_utc"][:7] == month]
        )
        for month in sorted({row["submission_month_utc"][:7] for row in cases})
    }
    with DETAIL.open("wb") as stream:
        with gzip.GzipFile(filename="", mode="wb", fileobj=stream, mtime=0) as archive:
            archive.write((json.dumps(cases, indent=2) + "\n").encode())
    report = {
        "schema": "r1-native-d86-b-target-micro-gap/v1",
        "source_hashes": {str(path): expected for path, expected in HASHES.items()},
        "detail_sha256": sha(DETAIL),
        "all": group_stats(cases),
        "micro_gap": group_stats(gap),
        "no_micro_gap": group_stats(no_gap),
        "gap_by_breakout_close": {
            f"micro_gap={gap_state},breakout_closed_above_b={close_state}": group_stats(
                [
                    row
                    for row in cases
                    if row.get("micro_gap") is gap_state
                    and row.get("breakout_closed_above_b") is close_state
                ]
            )
            for gap_state in (True, False)
            for close_state in (True, False)
        },
        "by_coin": by_coin,
        "by_submission_month": by_month,
        "limitations": [
            "Only old H19a native B-target closes are sampled; a runner that remained open would alter native capital, orders, fees, funding and future opportunities.",
            "The gap is only observable after the following complete 4h candle; target-minute and intervening stop touches are censored rather than promoted.",
            "A 4h bar reaching both stop and continuation is ambiguous; this read creates no replacement fills or Portfolio return.",
            "The 20-bar +1R continuation is a frozen geometric capacity benchmark, not an optimized exit or an independently validated crypto edge.",
        ],
    }
    OUT.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
