"""
Check causal pivot-zone locations against already acquired source charts.

The input is a Nautilus daily Catalog. This diagnostic selects no live or backtest order
and computes no fill, portfolio return, or future price path.

"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from statistics import median

from audit_daily_signal_counts import Daily
from audit_source_daily_context import CASES
from audit_source_daily_context import _days
from audit_source_daily_context import _sha
from audit_source_daily_context import _source_ideas
from audit_source_daily_context import _tree_digest

from vibe_trading.indicators import WilderMovingAverage


PIVOT_ORDERS = (3, 20)
SOURCE_SUPPORT = {"C07": 0.34, "C10": 195.0, "C08": 2000.0}


def _features(days: list[Daily]) -> tuple[list[float], list[bool], list[bool]]:
    atr = WilderMovingAverage(14)
    values = []
    up = []
    down = []
    for i, day in enumerate(days):
        previous_close = days[i - 1].close if i else day.close
        true_range = max(
            day.high - day.low,
            abs(day.high - previous_close),
            abs(day.low - previous_close),
        )
        atr.update_raw(true_range)
        values.append(atr.value)
        if i < 20:
            up.append(False)
            down.append(False)
            continue
        prior_body = median(abs(d.close - d.open) for d in days[i - 20 : i])
        big = abs(day.close - day.open) >= 1.5 * prior_body
        big2 = abs(day.close - days[i - 1].open) >= 3 * prior_body
        up.append((day.close > day.open and big) or (day.close > days[i - 1].open and big2))
        down.append((day.close < day.open and big) or (day.close < days[i - 1].open and big2))
    return values, up, down


def _pivot_zones(days: list[Daily], atr: list[float]) -> list[dict]:
    zones = []
    for order in PIVOT_ORDERS:
        for i in range(2 * order + 21, len(days)):
            j = i - order
            window = days[j - order : j + order + 1]
            pivot = days[j]
            body_top = max(pivot.open, pivot.close)
            body_bottom = min(pivot.open, pivot.close)
            if pivot.high == max(d.high for d in window):
                zones.append(
                    {
                        "order": order,
                        "kind": "former_high",
                        "pivot_ns": pivot.available_ns,
                        "confirmed_ns": days[i].available_ns,
                        "confirmed_index": i,
                        "lower": max(body_top, pivot.high - atr[i]),
                        "upper": pivot.high,
                    },
                )
            if pivot.low == min(d.low for d in window):
                zones.append(
                    {
                        "order": order,
                        "kind": "swing_low",
                        "pivot_ns": pivot.available_ns,
                        "confirmed_ns": days[i].available_ns,
                        "confirmed_index": i,
                        "lower": pivot.low,
                        "upper": min(body_bottom, pivot.low + atr[i]),
                    },
                )
    return zones


def _active_support(
    zone: dict,
    days: list[Daily],
    strong_up: list[bool],
    strong_down: list[bool],
) -> tuple[str, dict | None]:
    activated_ns = None
    for i in range(zone["confirmed_index"], len(days)):
        if (
            (zone["kind"] == "swing_low" or activated_ns is not None)
            and strong_down[i]
            and days[i].close < zone["lower"]
        ):
            return "invalidated", None
        if (
            activated_ns is None
            and days[i].close > zone["upper"]
            and (zone["kind"] == "swing_low" or strong_up[i])
        ):
            activated_ns = days[i].available_ns
    if activated_ns is None:
        return "never_activated", None
    if days[-1].close <= zone["upper"]:
        return "not_below_close", None
    return "active", {key: value for key, value in zone.items() if key != "confirmed_index"} | {
        "activated_ns": activated_ns,
        "invalidated_ns": None,
    }


def _key_supports(zones: list[dict]) -> list[dict]:
    result = []
    for zone in zones:
        overlaps = [
            other
            for other in zones
            if other is not zone
            and other["order"] == 3
            and other["pivot_ns"] != zone["pivot_ns"]
            and other["lower"] <= zone["upper"]
            and zone["lower"] <= other["upper"]
        ]
        result.append(
            zone | {"key": zone["order"] == 20 or bool(overlaps), "overlap_count": len(overlaps)},
        )
    return result


def _distance(zone: dict, source_price: float) -> float:
    return max(zone["lower"] - source_price, 0, source_price - zone["upper"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--daily-root", type=Path, required=True)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.input_identity.read_text())
    if Path(identity["daily_catalog_root"]) != args.daily_root:
        raise RuntimeError("daily Catalog identity root differs")
    digests = {row["coin"]: row["daily_catalog"]["sha256"] for row in identity["coins"]}
    ideas, archive_sha = _source_ideas()
    cases = []
    for case, coin, uuid in CASES:
        idea = ideas[uuid]
        publication_ns = int(datetime.fromisoformat(idea["created_at"]).timestamp() * 1e9)
        days, instrument = _days(args.daily_root, coin, publication_ns)
        digest = _tree_digest(args.daily_root / coin / "daily")
        if digest != digests[coin]:
            raise RuntimeError(f"{coin}: daily Catalog changed from registered input")
        atr, strong_up, strong_down = _features(days)
        active = []
        status_counts = {"active": 0, "invalidated": 0, "never_activated": 0, "not_below_close": 0}
        for zone in _pivot_zones(days, atr):
            status, support = _active_support(zone, days, strong_up, strong_down)
            status_counts[status] += 1
            if support is not None:
                active.append(support)
        ranked = sorted(
            _key_supports(active),
            key=lambda z: (days[-1].close - z["upper"], z["confirmed_ns"]),
        )
        selected = next((z for z in ranked if z["key"]), None)
        nearest_non_key = next((z for z in ranked if not z["key"]), None)
        expected = SOURCE_SUPPORT.get(case)
        cases.append(
            {
                "case": case,
                "coin": coin,
                "instrument": instrument,
                "published_utc": idea["created_at"],
                "daily_catalog_sha256": digest,
                "last_closed_daily_ns": days[-1].available_ns,
                "last_closed_daily_close": days[-1].close,
                "last_closed_daily_atr": atr[-1],
                "active_support_count": len(active),
                "zone_status_counts": status_counts,
                "key_support_count": sum(z["key"] for z in ranked),
                "selected_key_support": selected,
                "nearest_non_key_support": nearest_non_key,
                "active_key_supports": [z for z in ranked if z["key"]],
                "active_non_key_supports": [z for z in ranked if not z["key"]],
                "source_chart_support_approx": expected,
                "source_distance": _distance(selected, expected) if selected and expected else None,
                "within_one_daily_atr": (
                    _distance(selected, expected) <= atr[-1] if selected and expected else None
                ),
            },
        )
    args.output.write_text(
        json.dumps(
            {
                "source_archive_sha256": archive_sha,
                "input_identity_sha256": _sha(args.input_identity),
                "pivot_orders": PIVOT_ORDERS,
                "scope": "Source-date native daily zone location only; no trade or return.",
                "cases": cases,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
    )


if __name__ == "__main__":
    main()
