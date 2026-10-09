"""Describe native stop behavior by prior causal five-minute LAST/MARK gap state."""

from __future__ import annotations

import argparse
import gzip
import json
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd
from audit_d71_asset_regimes import sha
from audit_d71_asset_regimes import tree_digest
from audit_d72_native_stop_spikes import FIVE_MINUTE_NS
from audit_d72_native_stop_spikes import _bar_pairs


MONTHS = pd.date_range("2026-01-01", "2026-10-01", freq="MS", tz="UTC")
WARMUP_DAYS = 60
FIVE_MINUTE_BARS_PER_DAY = 288
TERCILES = ("low", "middle", "high")
RUNS = ("H19a", "H15a")


def _coin_month_features(bars: dict, coin: str) -> list[dict]:
    results = []
    for month in MONTHS:
        gaps = np.empty(WARMUP_DAYS * FIVE_MINUTE_BARS_PER_DAY, dtype=float)
        first_ns = (
            (month - pd.Timedelta(days=WARMUP_DAYS)).value + FIVE_MINUTE_NS - 1_000_000
        )
        for i in range(len(gaps)):
            event_ns = first_ns + i * FIVE_MINUTE_NS
            current = bars.get(event_ns)
            previous = bars.get(event_ns - FIVE_MINUTE_NS)
            if current is None or previous is None:
                raise RuntimeError(f"{coin} {month}: missing causal LAST/MARK bar pair")
            last, mark = current
            prior_last, _ = previous
            prior_close = float(prior_last.close)
            last_low = float(last.low)
            mark_low = float(mark.low)
            if (
                not np.isfinite((prior_close, last_low, mark_low)).all()
                or min(prior_close, last_low, mark_low) <= 0
            ):
                raise RuntimeError(f"{coin} {month}: invalid causal bar price")
            gaps[i] = max(0.0, mark_low - last_low) / prior_close * 10_000
        results.append(
            {
                "coin": coin,
                "month_start_utc": month.isoformat(),
                "prior_60d_p99_downside_last_mark_low_gap_bps": float(
                    np.quantile(gaps, 0.99)
                ),
                "paired_completed_five_minute_bars": len(gaps),
            }
        )
    return results


def _assign_terciles(rows: list[dict]) -> None:
    for month in (value.isoformat() for value in MONTHS):
        group = sorted(
            (row for row in rows if row["month_start_utc"] == month),
            key=lambda row: (
                row["prior_60d_p99_downside_last_mark_low_gap_bps"],
                row["coin"],
            ),
        )
        if len(group) != 37:
            raise RuntimeError(f"{month}: missing cross-sectional native feature")
        for rank, row in enumerate(group):
            row["gap_tercile"] = TERCILES[rank * 3 // len(group)]


def _group(rows: list[dict]) -> dict:
    closed = [row for row in rows if row["closed"]]
    open_rows = [row for row in rows if not row["closed"]]
    stopped = [row for row in closed if row["stop_fill_count"]]
    strict = [row for row in stopped if row["strict_last_only"]]
    wins = [row for row in closed if Decimal(row["native_realized_pnl_usdt"]) > 0]
    net_r = np.array([float(row["net_r_multiple"]) for row in closed], dtype=float)
    if len(net_r) and not np.isfinite(net_r).all():
        raise RuntimeError("nonfinite native closed Position R")
    return {
        "closed_positions": len(closed),
        "open_right_censored_positions": len(open_rows),
        "positive_closed_positions": len(wins),
        "closed_win_rate": len(wins) / len(closed) if closed else None,
        "closed_mean_net_r": float(net_r.mean()) if len(net_r) else None,
        "closed_net_pnl_usdt": str(
            sum(
                (Decimal(row["native_realized_pnl_usdt"]) for row in closed), Decimal(0)
            )
        ),
        "open_realized_pnl_usdt_not_closed_outcome": str(
            sum(
                (Decimal(row["native_realized_pnl_usdt"]) for row in open_rows),
                Decimal(0),
            )
        ),
        "stop_associated_positions": len(stopped),
        "strict_last_only_positions": len(strict),
        "strict_last_only_per_stopped": len(strict) / len(stopped) if stopped else None,
        "strict_last_only_per_closed": len(strict) / len(closed) if closed else None,
    }


def _persistence(states: list[dict], coins: list[str]) -> dict:
    by_coin = defaultdict(list)
    for row in states:
        by_coin[row["coin"]].append(row)
    changes = 0
    unchanged = []
    low_and_high = []
    state_counts = {}
    for coin in coins:
        ordered = sorted(by_coin[coin], key=lambda row: row["month_start_utc"])
        if len(ordered) != len(MONTHS):
            raise RuntimeError(f"{coin}: incomplete causal monthly feature states")
        labels = [row["gap_tercile"] for row in ordered]
        changes += sum(a != b for a, b in zip(labels, labels[1:], strict=False))
        if len(set(labels)) == 1:
            unchanged.append(coin)
        if "low" in labels and "high" in labels:
            low_and_high.append(coin)
        state_counts[coin] = dict(sorted(Counter(labels).items()))
    return {
        "adjacent_month_transitions": len(coins) * (len(MONTHS) - 1),
        "changed_tercile_transitions": changes,
        "never_changed_coins": unchanged,
        "coins_with_both_low_and_high_months": low_and_high,
        "months_by_coin_and_tercile": state_counts,
    }


def _within_coin(rows: list[dict], coins: list[str]) -> dict:
    comparable = []
    directions = Counter()
    for coin in coins:
        same = [row for row in rows if row["coin"] == coin and row["stop_fill_count"]]
        low = [row for row in same if row["gap_tercile"] == "low"]
        high = [row for row in same if row["gap_tercile"] == "high"]
        if not low or not high:
            continue
        low_rate = sum(row["strict_last_only"] for row in low) / len(low)
        high_rate = sum(row["strict_last_only"] for row in high) / len(high)
        direction = (
            "high_gt_low"
            if high_rate > low_rate
            else "high_lt_low"
            if high_rate < low_rate
            else "equal"
        )
        directions[direction] += 1
        comparable.append(
            {
                "coin": coin,
                "low_stopped": len(low),
                "low_strict": sum(row["strict_last_only"] for row in low),
                "high_stopped": len(high),
                "high_strict": sum(row["strict_last_only"] for row in high),
                "high_minus_low_rate": high_rate - low_rate,
                "direction": direction,
            }
        )
    return {
        "comparable_coin_count": len(comparable),
        "direction_counts": dict(directions),
        "coins": comparable,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--d71-detail", type=Path, required=True)
    parser.add_argument("--d72-summary", type=Path, required=True)
    parser.add_argument("--d72-detail", type=Path, required=True)
    parser.add_argument("--detail-output", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.input_identity.read_text())
    root = Path(identity["minute_catalog_root"])
    coins = [row["coin"] for row in identity["coins"]]
    if len(coins) != 37 or len(set(coins)) != 37:
        raise RuntimeError("D73 requires the registered 37-coin input identity")
    d72_summary = json.loads(args.d72_summary.read_text())
    if sha(args.d72_detail) != d72_summary["position_detail_sha256"]:
        raise RuntimeError("D72 native Position detail changed after its summary")
    d72_rows = json.loads(args.d72_detail.read_text())
    with gzip.open(args.d71_detail, "rt") as stream:
        d71_rows = json.load(stream)
    d71_lookup = {(row["variant"], row["position_id"]): row for row in d71_rows}
    if len(d71_lookup) != len(d71_rows):
        raise RuntimeError("D71 native Position detail contains duplicates")
    states = []
    for manifest in identity["coins"]:
        coin = manifest["coin"]
        if tree_digest(root / coin / "minute") != manifest["minute_catalog"]["sha256"]:
            raise RuntimeError(f"{coin}: registered minute Catalog tree digest changed")
        states.extend(_coin_month_features(_bar_pairs(root, coin), coin))
    _assign_terciles(states)
    lookup = {(row["coin"], row["month_start_utc"]): row for row in states}
    rows = []
    for prior in d72_rows:
        if prior["variant"] not in RUNS:
            raise RuntimeError("D72 Position belongs to an unexpected native variant")
        old = d71_lookup.get((prior["variant"], prior["position_id"]))
        if old is None or old["closed"] != prior["closed"]:
            raise RuntimeError("D71/D72 native Position identity mismatch")
        state = lookup.get((prior["coin"], prior["submission_month_utc"]))
        rows.append(
            {
                "position_id": prior["position_id"],
                "variant": prior["variant"],
                "coin": prior["coin"],
                "submission_month_utc": prior["submission_month_utc"],
                "gap_tercile": state["gap_tercile"] if state else "unavailable",
                "prior_60d_p99_gap_bps": (
                    state["prior_60d_p99_downside_last_mark_low_gap_bps"]
                    if state
                    else None
                ),
                "closed": prior["closed"],
                "stop_fill_count": prior["stop_fill_count"],
                "strict_last_only": prior.get("strict_last_only", False),
                "native_realized_pnl_usdt": prior["native_realized_pnl_usdt"],
                "net_r_multiple": old["net_r_multiple"],
            }
        )
    if len(rows) != len(d72_rows) or len(states) != 37 * len(MONTHS):
        raise RuntimeError(
            "D73 did not cover every native Position or registered feature state"
        )
    args.detail_output.parent.mkdir(parents=True, exist_ok=True)
    args.detail_output.write_text(json.dumps(rows, indent=2, sort_keys=True) + "\n")
    runs = {}
    for variant in RUNS:
        same = [row for row in rows if row["variant"] == variant]
        runs[variant] = {
            "all": _group(same),
            "by_gap_tercile": {
                label: _group([row for row in same if row["gap_tercile"] == label])
                for label in (*TERCILES, "unavailable")
            },
            "by_coin": {
                coin: _group([row for row in same if row["coin"] == coin])
                for coin in coins
            },
            "by_submission_month": {
                month: _group(
                    [row for row in same if row["submission_month_utc"] == month]
                )
                for month in sorted({row["submission_month_utc"] for row in same})
            },
            "within_coin_low_high_stop_comparison": _within_coin(same, coins),
        }
        source = d72_summary["runs"][variant]["all"]
        for key in (
            "closed_positions",
            "open_right_censored_positions",
            "stop_associated_positions",
            "strict_last_only_positions",
        ):
            if runs[variant]["all"][key] != source[key]:
                raise RuntimeError(f"{variant}: D72 native aggregate {key} changed")
    output = {
        "schema": "r1-native-d73-causal-five-minute-gap-state/v1",
        "preregistration_commit": "a23b6e85d",
        "input_identity_sha256": sha(args.input_identity),
        "d71_detail_sha256": sha(args.d71_detail),
        "d72_summary_sha256": sha(args.d72_summary),
        "d72_detail_sha256": sha(args.d72_detail),
        "position_detail_sha256": sha(args.detail_output),
        "months": [month.isoformat() for month in MONTHS],
        "feature_states": states,
        "feature_persistence": _persistence(states, coins),
        "runs": runs,
        "limitations": [
            "October-December 2025 order-submission months have no prior 60 complete days of paired five-minute MARK/LAST data and remain unavailable.",
            "Feature groups are cross-sectional monthly descriptions on an exposed development year; stopped-position conditioning, coin and time mix can confound observed associations.",
            "No MARK-triggered native protective order or counterfactual execution was run, and group PnL is not an independently funded return.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
