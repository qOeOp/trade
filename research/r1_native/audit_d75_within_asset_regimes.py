"""Read-only D75 contrasts on frozen D71 native Position and feature artifacts."""

from __future__ import annotations

import gzip
import hashlib
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
from statistics import mean


ROOT = Path(__file__).resolve().parent
SUMMARY = ROOT / "results/2026-10-08-d71-asset-regimes.json"
POSITIONS = ROOT / "results/2026-10-08-d71-asset-regime-positions.json.gz"
OUTPUT = ROOT / "results/2026-10-08-d75-within-asset-regimes.json"
FROZEN_SHA = {
    SUMMARY.name: "0d1b12ca483aa95f1ec4c0ed944223a5f43362c59dc28db1fc9caa53d4b080be",
    POSITIONS.name: "624d4dd60a6742e6811c7e66733e971a1faeaeb803814e6af61034e8e9d7b5e9",
}
FEATURES = ("realized_volatility", "wick_fraction", "trend_efficiency")
VARIANTS = ("H15a", "H19a", "H22a")
RANKS = ("low", "middle", "high")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _summary(rows: list[dict]) -> dict:
    closed = [row for row in rows if row["closed"]]
    net_r = [float(row["net_r_multiple"]) for row in closed]
    pnl = sum((Decimal(row["native_realized_pnl_usdt"]) for row in closed), Decimal(0))
    wins = sum(Decimal(row["native_realized_pnl_usdt"]) > 0 for row in closed)
    return {
        "native_positions": len(rows),
        "closed_positions": len(closed),
        "open_right_censored_positions": len(rows) - len(closed),
        "wins": wins,
        "win_rate": wins / len(closed) if closed else None,
        "mean_net_r": mean(net_r) if net_r else None,
        "native_closed_pnl_usdt": str(pnl),
    }


def _contrasts(rows: list[dict], feature: str, key: str) -> dict:
    groups = defaultdict(lambda: {"low": [], "high": []})
    for row in rows:
        rank = row[f"{feature}_tercile"]
        if row["closed"] and rank in ("low", "high"):
            groups[row[key]][rank].append(row)
    details = []
    for label in sorted(groups):
        low, high = groups[label]["low"], groups[label]["high"]
        if not low or not high:
            continue
        low_stat, high_stat = _summary(low), _summary(high)
        details.append({
            key: label,
            "low_closed": len(low),
            "high_closed": len(high),
            "high_minus_low_mean_net_r": high_stat["mean_net_r"] - low_stat["mean_net_r"],
            "high_minus_low_win_rate": high_stat["win_rate"] - low_stat["win_rate"],
        })
    r_deltas = [row["high_minus_low_mean_net_r"] for row in details]
    w_deltas = [row["high_minus_low_win_rate"] for row in details]
    return {
        "comparable_groups": len(details),
        "high_minus_low_equal_group_mean_net_r": mean(r_deltas) if details else None,
        "high_minus_low_equal_group_mean_win_rate": mean(w_deltas) if details else None,
        "net_r_directions": {
            "positive": sum(value > 0 for value in r_deltas),
            "negative": sum(value < 0 for value in r_deltas),
            "tied": sum(value == 0 for value in r_deltas),
        },
        "win_rate_directions": {
            "positive": sum(value > 0 for value in w_deltas),
            "negative": sum(value < 0 for value in w_deltas),
            "tied": sum(value == 0 for value in w_deltas),
        },
        "groups": details,
    }


def main() -> None:
    hashes = {path.name: _sha(path) for path in (SUMMARY, POSITIONS)}
    if hashes != FROZEN_SHA:
        raise RuntimeError(f"D71 frozen input identity changed: {hashes}")
    d71 = json.loads(SUMMARY.read_text())
    with gzip.open(POSITIONS, "rt") as stream:
        positions = json.load(stream)
    assert d71["coins"] and len(d71["coins"]) == 37
    assert d71["month_starts"] == 13 and len(d71["feature_states"]) == 481
    assert sorted(d71["runs"]) == sorted(VARIANTS)
    states = defaultdict(list)
    for state in d71["feature_states"]:
        assert state["coin"] in d71["coins"]
        assert all(state[f"{feature}_tercile"] in RANKS for feature in FEATURES)
        states[state["coin"]].append(state)
    assert len(states) == 37
    assert all(len(value) == 13 for value in states.values())
    state_by_key = {}
    for coin, value in states.items():
        assert [s["month_start_utc"] for s in value] == sorted(
            s["month_start_utc"] for s in value
        )
        for state in value:
            key = (coin, state["month_start_utc"])
            assert key not in state_by_key
            state_by_key[key] = state

    seen = set()
    by_variant = defaultdict(list)
    for row in positions:
        identity = (row["variant"], row["position_id"])
        assert identity not in seen
        seen.add(identity)
        state = state_by_key[(row["coin"], row["entry_submission_month_utc"])]
        assert row["variant"] in VARIANTS
        assert row["instrument_id"].endswith("-PERP.BINANCE")
        for feature in FEATURES:
            assert row[f"{feature}_tercile"] == state[f"{feature}_tercile"]
        assert row["closed"] == (row["net_r_multiple"] is not None)
        by_variant[row["variant"]].append(row)
    assert len(positions) == sum(d71["runs"][v]["native_positions"] for v in VARIANTS)
    for variant in VARIANTS:
        assert len(by_variant[variant]) == d71["runs"][variant]["native_positions"]
        assert sum(row["closed"] for row in by_variant[variant]) == d71["runs"][variant]["native_closed_positions"]

    changes = {}
    result = {}
    for feature in FEATURES:
        rank_key = f"{feature}_tercile"
        changes[feature] = {
            "adjacent_rank_changes": sum(
                left[rank_key] != right[rank_key]
                for value in states.values()
                for left, right in zip(value, value[1:])
            ),
            "possible_adjacent_transitions": 37 * 12,
            "coins_with_both_low_and_high": sum(
                {"low", "high"}.issubset({s[rank_key] for s in value})
                for value in states.values()
            ),
        }
        result[feature] = {}
        for variant in VARIANTS:
            rows = by_variant[variant]
            buckets = {
                rank: _summary([row for row in rows if row[rank_key] == rank])
                for rank in RANKS
            }
            frozen = d71["runs"][variant]["feature_terciles"][feature]
            for rank in RANKS:
                assert buckets[rank]["native_positions"] == frozen[rank]["native_positions"]
                assert buckets[rank]["closed_positions"] == frozen[rank]["closed_positions"]
                assert buckets[rank]["wins"] == frozen[rank]["wins"]
                assert buckets[rank]["native_closed_pnl_usdt"] == frozen[rank]["sum_closed_native_realized_pnl_usdt"]
            result[feature][variant] = {
                "ranks": buckets,
                "within_coin": _contrasts(rows, feature, "coin"),
                "within_submission_month": _contrasts(rows, feature, "entry_submission_month_utc"),
            }
    output = {
        "schema": "r1-native-d75-within-asset-regimes-descriptive/v1",
        "preregistration_commit": "7751afd3d",
        "frozen_d71_input_sha256": hashes,
        "native_position_unit": "D71 native shared-account Position; first entry-order submission month; closed net R includes native fees and funding; open positions censored",
        "method": "For all three preregistered D71 features and all three frozen native strategies, high-minus-low mean net R and win-rate differences within each comparable coin and UTC submission month, then equal-weight across groups. Descriptive exposed-year associations only.",
        "feature_rank_changes": changes,
        "contrasts": result,
        "limitations": [
            "Within-coin comparisons can still be confounded by calendar month, and within-month comparisons can still be confounded by coin composition; neither is a causal portfolio-filter replay.",
            "Native Position outcome is observed conditional on the strategy's candidate generation, order submission, fill and closure; unavailable and open observations are not fabricated as wins or losses.",
            "The annual development data and these feature/outcome relationships have been viewed repeatedly; no p-value, asset list, economic uplift or independent validation is claimed.",
        ],
    }
    OUTPUT.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(OUTPUT), "sha256": _sha(OUTPUT), "changes": changes,
                      "h19_vol_within_coin": result["realized_volatility"]["H19a"]["within_coin"],
                      "h19_vol_within_month": result["realized_volatility"]["H19a"]["within_submission_month"]},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
