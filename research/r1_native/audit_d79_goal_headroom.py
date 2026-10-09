"""Fixed-path arithmetic bounds from frozen H19a native Position outcomes.

This read-only audit never simulates an order, account path, or tradable filter.
"""

from __future__ import annotations

import gzip
import hashlib
import json
from collections import Counter
from decimal import Decimal
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent
SUMMARY = Path("/tmp/r1-h22a-paired-h19a-37/summary.json")
D78 = ROOT / "results/2026-10-08-d78-post-fill-asset-path.json"
DETAIL = ROOT / "results/2026-10-08-d78-post-fill-asset-path-positions.json.gz"
OUTPUT = ROOT / "results/2026-10-08-d79-goal-headroom.json"
HASHES = {
    SUMMARY: "cd0212f4c6880469c5d5b9db0b8b931618590fc2914bff42417e95ea9e41b555",
    D78: "a8c0dfe291daf9eb24f8ee04d9b41e13716d1986945e5e8e00b2f1d5ea7b669e",
    DETAIL: "ad31d3f3cf4fa1981ccea7ccf5c6289a927c86b781a7b4cd85adaef8316afd6e",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    for path, expected in HASHES.items():
        if digest(path) != expected:
            raise RuntimeError(f"frozen input changed: {path}")
    summary = json.loads(SUMMARY.read_text())
    d78 = json.loads(D78.read_text())
    with gzip.open(DETAIL, "rt") as stream:
        positions = json.load(stream)
    if len(positions) != 507 or len({p["position_id"] for p in positions}) != 507:
        raise RuntimeError("H19a native Position population changed")
    if Counter(p["prior_volatility_rank"] for p in positions) != {"low": 175, "middle": 166, "high": 166}:
        raise RuntimeError("D71 causal rank population changed")
    closed = [p for p in positions if p["closed"]]
    winners = [p for p in closed if Decimal(p["native_final_realized_pnl_usdt"]) > 0]
    if (len(closed), len(winners)) != (summary["closed_trades"], summary["winning_trades"]) or (len(closed), len(winners)) != (496, 212):
        raise RuntimeError("native closed/winner count changed")
    start = Decimal(summary["starting_balance_usdt"])
    final = Decimal(summary["final_equity_usdt"])
    if (start, final) != (Decimal("100000"), Decimal("111664.46988783")):
        raise RuntimeError("native account denominator or final equity changed")
    years = Decimal(str((pd.Timestamp(summary["period_end_utc"]) - pd.Timestamp(summary["period_start_utc"])).total_seconds())) / Decimal(86400 * 365)
    threshold = start * Decimal(str(1.2 ** float(years)))
    early = [p for p in closed if p["landmarks"]["1"]["state"] == "closed_censored" and p["landmarks"]["1"].get("close_cause") == "stop"]
    if len(early) != 24 or any(Decimal(p["native_final_realized_pnl_usdt"]) >= 0 for p in early):
        raise RuntimeError("first-landmark native stop set changed")
    high = [p for p in closed if p["prior_volatility_rank"] == "high"]
    high_losers = [p for p in high if Decimal(p["native_final_realized_pnl_usdt"]) <= 0]

    def fixed_removal(group: list[dict]) -> dict:
        removed = sum((Decimal(p["native_final_realized_pnl_usdt"]) for p in group), Decimal(0))
        removed_winners = sum(Decimal(p["native_final_realized_pnl_usdt"]) > 0 for p in group)
        residual_winners = len(winners) - removed_winners
        residual_closed = len(closed) - len(group)
        hypothetical = final - removed
        return {
            "removed_positions": len(group),
            "removed_distinct_bundles": len({p["bundle_id"] for p in group}),
            "removed_native_net_pnl_usdt": str(removed),
            "fixed_path_equity_arithmetic_usdt": str(hypothetical),
            "fixed_path_annualized_arithmetic_pct": (float(hypothetical / start) ** (1 / float(years)) - 1) * 100,
            "fixed_path_winners": residual_winners,
            "fixed_path_closed": residual_closed,
            "fixed_path_win_pct": 100 * residual_winners / residual_closed,
            "fixed_path_equity_gap_to_strict_20pct_usdt": str(threshold - hypothetical),
            "fixed_path_win_gap_to_60pp": 60 - 100 * residual_winners / residual_closed,
        }

    # Winner reclassification alone is a count bound; unknown positive replacement
    # PnL must not be invented from this fixed native path.
    reclass_winners = len(winners) + len(early)
    minimum_losers_to_delete = next(n for n in range(len(closed) + 1) if len(winners) / (len(closed) - n) >= 0.6)
    result = {
        "schema": "r1-native-d79-fixed-path-goal-headroom/v1",
        "preregistration_commit": "6ee8c3f1c",
        "input_sha256": {path.name: digest(path) for path in HASHES},
        "native_population": {"positions": len(positions), "closed": len(closed), "open": len(positions) - len(closed), "winners": len(winners), "original_final_equity_usdt": str(final)},
        "goal_threshold": {"eligible_years_365": str(years), "strict_20pct_requires_final_equity_gt_usdt": str(threshold), "original_equity_gap_usdt": str(threshold - final), "original_win_rate_pct": 100 * len(winners) / len(closed)},
        "remove_first_landmark_native_stops": fixed_removal(early),
        "reclassify_first_landmark_stops_as_wins": {"reclassified_positions": len(early), "winners": reclass_winners, "closed": len(closed), "win_pct": 100 * reclass_winners / len(closed), "new_positive_pnl_unknown": True},
        "remove_all_high_rank_closed": fixed_removal(high),
        "remove_only_high_rank_closed_losers": fixed_removal(high_losers),
        "minimum_losing_positions_to_delete_for_60pct_if_winners_fixed": minimum_losers_to_delete,
        "limitations": ["Fixed-path deletion/reclassification is not a Nautilus Strategy, order, fill, account-equity, or tradable return counterfactual.", "Native Position net PnL includes fill fees and funding adjustments, but deletion changes subsequent account slots and outcomes.", "No confidence interval or independent edge is inferred from the viewed annual sample."],
    }
    if d78["position_detail_sha256"] != HASHES[DETAIL]:
        raise RuntimeError("D78 detail pointer mismatch")
    OUTPUT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
