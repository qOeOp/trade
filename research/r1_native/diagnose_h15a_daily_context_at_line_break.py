"""
Join D55 native line-break snapshots to the previously completed R-1 daily direction.

This is a read-only cohort screen. It creates no orders, fills, account return, or
executable exit PnL. The D55 native position and fee/funding arithmetic is the only
source for the indicative early-exit comparison.

"""

from __future__ import annotations

import argparse
import hashlib
import json
from bisect import bisect_left
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
from statistics import median

import audit_source_daily_context
from audit_daily_signal_counts import _daily_bars
from run import _ns


EXPECTED_D55_SHA256 = "451eeb0a92f7b41e657ae461a726d422b41cb70e481ed5d692cbd3957a0ec32b"
EXPECTED_IDENTITY_SHA256 = "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc"
START_NS = _ns("2025-10-07T00:00:00Z")
END_NS = _ns("2026-10-07T08:30:00Z")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _summary(rows: list[dict]) -> dict:
    closed = [row for row in rows if row["actual_continuation_minus_indicative_usdt"] is not None]
    return {
        "event_positions": len(rows),
        "eventually_closed": len(closed),
        "open_at_run_end": len(rows) - len(closed),
        "eventual_winners": sum(
            Decimal(row["native_final_realized_pnl_usdt"]) > 0 for row in closed
        ),
        "eventual_native_targets": sum(row["native_close_cause"] == "target" for row in closed),
        "eventual_realized_pnl_usdt": str(
            sum(
                (Decimal(row["native_final_realized_pnl_usdt"]) for row in closed),
                Decimal(0),
            ),
        ),
        "actual_continuation_minus_indicative_usdt": str(
            sum(
                (Decimal(row["actual_continuation_minus_indicative_usdt"]) for row in closed),
                Decimal(0),
            ),
        ),
        "indicative_exit_improvement_fixed_path_usdt": str(
            -sum(
                (Decimal(row["actual_continuation_minus_indicative_usdt"]) for row in closed),
                Decimal(0),
            ),
        ),
        "median_event_age_complete_bars": (
            str(median(row["event_age_complete_bars"] for row in rows)) if rows else None
        ),
        "median_event_close_first_r": (
            str(median(Decimal(row["event_close_first_r"]) for row in rows)) if rows else None
        ),
    }


def _load_events(
    d55_path: Path,
    identity_path: Path,
) -> tuple[dict, list[dict], Decimal]:
    if _sha(d55_path) != EXPECTED_D55_SHA256:
        raise RuntimeError("D55 native-position report identity changed")
    if _sha(identity_path) != EXPECTED_IDENTITY_SHA256:
        raise RuntimeError("37-coin Catalog identity changed")
    d55 = json.loads(d55_path.read_text())
    identity = json.loads(identity_path.read_text())
    if len(d55["positions"]) != 686 or len(identity["coins"]) != 37:
        raise RuntimeError("D55 position or universe cardinality changed")
    events = [row for row in d55["positions"] if row["state"] == "line_broken_while_open"]
    if (
        len(events) != 184
        or sum(row["actual_continuation_minus_indicative_usdt"] is not None for row in events)
        != 183
    ):
        raise RuntimeError("D55 event or right-censor cardinality changed")
    original_delta = sum(
        (
            Decimal(row["actual_continuation_minus_indicative_usdt"])
            for row in events
            if row["actual_continuation_minus_indicative_usdt"] is not None
        ),
        Decimal(0),
    )
    if str(original_delta) != d55["summary"]["actual_continuation_minus_indicative_sum_usdt"]:
        raise RuntimeError("D55 native fee/funding comparison does not reconcile")

    return identity, events, original_delta


def _join_coin(
    coin_row: dict,
    minute_root: Path,
    daily_root: Path,
    by_instrument: dict[str, list[dict]],
) -> list[dict]:
    coin = coin_row["coin"]
    minute_catalog = minute_root / coin / "minute"
    daily_catalog = daily_root / coin / "daily"
    if (
        audit_source_daily_context._tree_digest(minute_catalog)
        != coin_row["minute_catalog"]["sha256"]
    ):
        raise RuntimeError(f"{coin}: minute Catalog bytes changed")
    if (
        audit_source_daily_context._tree_digest(daily_catalog)
        != coin_row["daily_catalog"]["sha256"]
    ):
        raise RuntimeError(f"{coin}: daily Catalog bytes changed")
    completion = json.loads(
        (daily_catalog / "r1-daily-download-complete.json").read_text(),
    )
    instrument_id = completion["instrument"]
    coin_events = by_instrument.pop(instrument_id, [])
    days, warmup_count, aggregate_count = _daily_bars(
        daily_root,
        minute_root,
        coin,
        instrument_id,
        START_NS,
        END_NS,
    )
    if warmup_count < 200 or aggregate_count < 300:
        raise RuntimeError(f"{coin}: insufficient complete daily history")
    available = [day.available_ns for day in days]
    rows = []
    for row in coin_events:
        event_ns = row["event_four_hour_close_ns"]
        day_i = bisect_left(available, event_ns) - 1
        if day_i < 200 or days[day_i].available_ns >= event_ns:
            raise RuntimeError(f"{coin}: causal prior daily close missing")
        state = audit_source_daily_context._trend_state(days[: day_i + 1], 3)
        if state["last_closed_daily_ns"] != available[day_i] or state["trend"] not in (
            -1,
            0,
            1,
        ):
            raise RuntimeError(f"{coin}: invalid frozen daily trend read")
        rows.append(
            {
                "position_id": row["position_id"],
                "instrument_id": instrument_id,
                "event_four_hour_close_ns": event_ns,
                "last_prior_complete_daily_ns": state["last_closed_daily_ns"],
                "daily_trend": state["trend"],
                "daily_trend_last_flip_ns": state["last_flip_ns"],
                "event_age_complete_bars": row["event_age_complete_bars"],
                "event_close_first_r": row["event_close_first_r"],
                "native_close_cause": row["native_close_cause"],
                "native_final_realized_pnl_usdt": row["native_final_realized_pnl_usdt"],
                "actual_continuation_minus_indicative_usdt": row[
                    "actual_continuation_minus_indicative_usdt"
                ],
            },
        )
    print(f"{coin}: {len(coin_events)} D55 events joined", flush=True)
    return rows


def _group_results(
    result_rows: list[dict],
    original_delta: Decimal,
) -> tuple[dict, dict]:
    groups = {
        "bearish_daily_at_break": _summary(
            [row for row in result_rows if row["daily_trend"] == -1],
        ),
        "neutral_daily_at_break": _summary(
            [row for row in result_rows if row["daily_trend"] == 0],
        ),
        "bullish_daily_at_break": _summary(
            [row for row in result_rows if row["daily_trend"] == 1],
        ),
    }
    overall = _summary(result_rows)
    group_delta = sum(
        (Decimal(group["actual_continuation_minus_indicative_usdt"]) for group in groups.values()),
        Decimal(0),
    )
    if (
        sum(group["event_positions"] for group in groups.values()) != 184
        or Decimal(overall["actual_continuation_minus_indicative_usdt"]) != original_delta
        or group_delta != original_delta
    ):
        raise RuntimeError("D58 group totals do not reconcile to D55")
    return groups, overall


def diagnose(d55_path: Path, identity_path: Path) -> dict:
    identity, events, original_delta = _load_events(d55_path, identity_path)
    minute_root = Path(identity["minute_catalog_root"])
    daily_root = Path(identity["daily_catalog_root"])
    by_instrument: dict[str, list[dict]] = defaultdict(list)
    for row in events:
        by_instrument[row["instrument_id"]].append(row)
    result_rows = []
    for coin_row in identity["coins"]:
        result_rows.extend(_join_coin(coin_row, minute_root, daily_root, by_instrument))
    if (
        by_instrument
        or len(result_rows) != 184
        or len({row["position_id"] for row in result_rows}) != 184
    ):
        raise RuntimeError(f"D55 events not fully joined: {sorted(by_instrument)}")

    groups, overall = _group_results(result_rows, original_delta)
    bearish = groups["bearish_daily_at_break"]
    capacity_pass = bearish["eventually_closed"] >= 30 and Decimal(
        bearish["indicative_exit_improvement_fixed_path_usdt"],
    ) >= Decimal(5000)
    return {
        "schema": "r1-native-read-only-diagnostic/v1",
        "id": "D58",
        "registration": "RD_EXPERIMENTS.md D58 commit 14c8e766b411845ceeed731a8599321a92df71cb",
        "method": "join original D55 native event/fee/funding snapshots to the strictly prior complete UTC daily frozen family_r pivot/body direction; no orders or account return",
        "input_sha256": {
            "d55": EXPECTED_D55_SHA256,
            "catalog_identity": EXPECTED_IDENTITY_SHA256,
        },
        "rule": {
            "daily_pivot_order": 3,
            "bearish_state": -1,
            "strictly_prior_daily_close": True,
            "minimum_closed_events": 30,
            "minimum_fixed_path_exit_improvement_usdt": "5000",
        },
        "overall": overall,
        "groups": groups,
        "capacity_screen_pass": capacity_pass,
        "positions": sorted(
            result_rows,
            key=lambda row: (row["instrument_id"], row["event_four_hour_close_ns"]),
        ),
        "limitations": [
            "The daily classifier is a frozen source-rule read, not a separately ordered Nautilus Strategy.",
            "The indicative exit uses D55 actual native Position state, accrued real fees/funding and one hypothetical taker fee; it is not an executable account return.",
            "D55 and the same annual market period were already exposed; the subgroup is development evidence only.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--d55", type=Path, required=True)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = diagnose(args.d55, args.input_identity)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
