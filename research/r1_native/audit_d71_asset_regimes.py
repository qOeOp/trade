"""Describe native R1 outcomes by predecision asset regimes without selecting coins."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import re
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd
from audit_d66_native_position_r import _position
from nautilus_trader.model import BarType
from nautilus_trader.persistence import ParquetDataCatalog


START = pd.Timestamp("2025-10-07T00:00:00Z")
DAILY_END = pd.Timestamp("2026-10-07T00:00:00Z")
MONTHS = pd.date_range("2025-10-01", "2026-10-01", freq="MS", tz="UTC")
FIVE_MINUTE_NS = 300_000_000_000
MILLISECOND_NS = 1_000_000
FEATURES = ("realized_volatility", "wick_fraction", "trend_efficiency")
TERCILES = ("low", "middle", "high")
RUNS = {
    "H15a": "support-three-tier-4h",
    "H19a": "support-broad-two-tier-4h",
    "H22a": "support-broad-local-a-outside-stop-two-tier-4h",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        name = path.relative_to(root).as_posix().encode()
        digest.update(len(name).to_bytes(4, "big"))
        digest.update(name)
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def _bar_row(bar) -> dict:
    return {
        "day": pd.Timestamp(bar.ts_event, tz="UTC").floor("D"),
        "open": float(bar.open),
        "high": float(bar.high),
        "low": float(bar.low),
        "close": float(bar.close),
    }


def daily_bars(coin: str, minute_root: Path, warmup_root: Path) -> pd.DataFrame:
    instrument = f"{coin}USDT-PERP.BINANCE"
    if coin == "PEPE":
        instrument = "1000PEPEUSDT-PERP.BINANCE"
    if coin == "SHIB":
        instrument = "1000SHIBUSDT-PERP.BINANCE"
    daily_catalog = ParquetDataCatalog(str(warmup_root / coin / "daily"))
    daily_type = BarType.from_str(f"{instrument}-1-DAY-LAST-EXTERNAL")
    warmup = sorted(
        (
            bar
            for bar in daily_catalog.query_bars([instrument])
            if bar.bar_type == daily_type and bar.ts_event < START.value
        ),
        key=lambda bar: bar.ts_event,
    )
    warmup_rows = [
        _bar_row(bar)
        for bar in warmup
        if bar.ts_event >= MONTHS[0].value - 70 * 86_400_000_000_000
    ]
    minute_catalog = ParquetDataCatalog(str(minute_root / coin / "minute"))
    last_type = BarType.from_str(f"{instrument}-5-MINUTE-LAST-EXTERNAL")
    last = sorted(
        (
            bar
            for bar in minute_catalog.query_bars(
                [instrument],
                start=START.value,
                end=DAILY_END.value,
            )
            if bar.bar_type == last_type
        ),
        key=lambda bar: bar.ts_event,
    )
    expected = (DAILY_END.value - START.value) // FIVE_MINUTE_NS
    if len(last) != expected or any(
        bar.ts_event != START.value + (i + 1) * FIVE_MINUTE_NS - MILLISECOND_NS
        for i, bar in enumerate(last)
    ):
        raise RuntimeError(f"{coin}: native five-minute LAST interval is incomplete")
    aggregate = []
    for offset in range(0, len(last), 288):
        group = last[offset : offset + 288]
        if len(group) != 288:
            raise RuntimeError(f"{coin}: incomplete UTC daily group")
        aggregate.append(
            {
                "day": START + pd.Timedelta(days=offset // 288),
                "open": float(group[0].open),
                "high": max(float(bar.high) for bar in group),
                "low": min(float(bar.low) for bar in group),
                "close": float(group[-1].close),
            },
        )
    rows = pd.DataFrame(warmup_rows + aggregate).sort_values("day")
    if rows.day.duplicated().any():
        raise RuntimeError(f"{coin}: native daily history has duplicate dates")
    return rows.reset_index(drop=True)


def monthly_features(days: pd.DataFrame, coin: str) -> list[dict]:
    results = []
    for month in MONTHS:
        previous = days.loc[days.day < month].tail(60)
        row = {"coin": coin, "month_start_utc": month.isoformat()}
        if len(previous) != 60 or any(
            previous.day.iloc[i] != month - pd.Timedelta(days=60 - i) for i in range(60)
        ):
            row.update(dict.fromkeys(FEATURES, None))
            row["unavailable_reason"] = (
                "fewer than 60 consecutive completed native days"
            )
            results.append(row)
            continue
        opens = previous.open.to_numpy(dtype=float)
        highs = previous.high.to_numpy(dtype=float)
        lows = previous.low.to_numpy(dtype=float)
        closes = previous.close.to_numpy(dtype=float)
        if (
            not np.isfinite(opens).all()
            or not np.isfinite(highs).all()
            or not np.isfinite(lows).all()
            or not np.isfinite(closes).all()
            or (opens <= 0).any()
            or (lows <= 0).any()
            or (highs < np.maximum(opens, closes)).any()
            or (lows > np.minimum(opens, closes)).any()
        ):
            row.update(dict.fromkeys(FEATURES, None))
            row["unavailable_reason"] = "invalid prior native OHLC prices"
            results.append(row)
            continue
        range_size = highs - lows
        valid_range = range_size > 0
        price_steps = np.diff(closes)
        denominator = np.abs(price_steps).sum()
        if not valid_range.any() or denominator <= 0:
            row.update(dict.fromkeys(FEATURES, None))
            row["unavailable_reason"] = "zero daily range or zero close movement"
            results.append(row)
            continue
        wick = highs - np.maximum(opens, closes) + np.minimum(opens, closes) - lows
        row.update(
            realized_volatility=float(
                np.std(np.diff(np.log(closes)), ddof=1) * math.sqrt(365)
            ),
            wick_fraction=float(np.median(wick[valid_range] / range_size[valid_range])),
            trend_efficiency=float(abs(closes[-1] - closes[0]) / denominator),
            unavailable_reason=None,
        )
        results.append(row)
    return results


def assign_terciles(rows: list[dict]) -> None:
    months = sorted({row["month_start_utc"] for row in rows})
    for month in months:
        same_month = [row for row in rows if row["month_start_utc"] == month]
        for feature in FEATURES:
            valid = sorted(
                (row for row in same_month if row[feature] is not None),
                key=lambda row: (row[feature], row["coin"]),
            )
            for row in same_month:
                row[f"{feature}_tercile"] = "unavailable"
            for rank, row in enumerate(valid):
                row[f"{feature}_tercile"] = TERCILES[rank * 3 // len(valid)]


def native_positions(
    run: Path, audit_path: Path, expected_variant: str
) -> tuple[list[dict], dict]:
    summary = json.loads((run / "summary.json").read_text())
    audit = json.loads(audit_path.read_text())
    if (
        summary["signal_variant"] != expected_variant
        or not summary["integrity_passed"]
        or not audit["passed"]
        or audit["run"] != str(run)
        or len(summary["per_coin"]) != 37
    ):
        raise RuntimeError(f"{run}: native shared-account report or audit invalid")
    for name, expected in audit["file_sha256"].items():
        if sha(run / name) != expected:
            raise RuntimeError(f"{run}: native report {name} changed after audit")
    with (run / "orders.csv").open(newline="") as stream:
        orders = list(csv.DictReader(stream))
    by_id = {row["client_order_id"]: row for row in orders}
    if len(by_id) != len(orders):
        raise RuntimeError(f"{run}: duplicate native order ID")
    stops = defaultdict(list)
    for order in orders:
        if order["side"] == "SELL" and order["type"] == "STOP_MARKET":
            stops[order["parent_order_id"]].append(order)
    with (run / "positions.csv").open(newline="") as stream:
        positions = [_position(row, by_id, stops) for row in csv.DictReader(stream)]
    closed = [row for row in positions if row["closed"]]
    wins = sum(Decimal(row["native_realized_pnl_usdt"]) > 0 for row in closed)
    if len(closed) != summary["closed_trades"] or wins != summary["winning_trades"]:
        raise RuntimeError(
            f"{run}: native Position count or winners differ from summary"
        )
    return positions, {"run": str(run), "report_sha256": audit["file_sha256"]}


def source_mentions(path: Path, coins: list[str]) -> dict[str, list[str]]:
    text = path.read_text()
    sections = re.split(r"(?=^## C\d{2}\b)", text, flags=re.M)
    mentions = defaultdict(list)
    for section in sections:
        match = re.match(r"## (C\d{2})\b", section)
        if match is None:
            continue
        for coin in coins:
            if re.search(rf"(?<![A-Za-z0-9]){re.escape(coin)}(?![A-Za-z0-9])", section):
                mentions[coin].append(match.group(1))
    return {coin: mentions[coin] for coin in coins}


def summarize(
    positions: list[dict], feature_lookup: dict, variant: str
) -> tuple[dict, list[dict]]:
    detail = []
    for position in positions:
        coin = position["instrument_id"].split("USDT", 1)[0]
        if coin.startswith("1000"):
            coin = coin[4:]
        month = pd.Timestamp(position["first_order_init_ns"], tz="UTC").strftime(
            "%Y-%m-01T00:00:00+00:00"
        )
        state = feature_lookup.get((coin, month))
        if state is None:
            raise RuntimeError(
                f"{variant} {coin}: first native entry month lacks feature state"
            )
        detail.append(
            {
                **position,
                "variant": variant,
                "coin": coin,
                "entry_submission_month_utc": month,
                **{
                    f"{feature}_tercile": state[f"{feature}_tercile"]
                    for feature in FEATURES
                },
            },
        )
    groups = {}
    for feature in FEATURES:
        feature_groups = {}
        for tercile in (*TERCILES, "unavailable"):
            cohort = [p for p in detail if p[f"{feature}_tercile"] == tercile]
            closed = [p for p in cohort if p["closed"]]
            pnls = [Decimal(p["native_realized_pnl_usdt"]) for p in closed]
            net_r = [float(p["net_r_multiple"]) for p in closed]
            feature_groups[tercile] = {
                "native_positions": len(cohort),
                "closed_positions": len(closed),
                "open_right_censored_positions": len(cohort) - len(closed),
                "distinct_coins": len({p["coin"] for p in cohort}),
                "wins": sum(pnl > 0 for pnl in pnls),
                "closed_win_rate": sum(pnl > 0 for pnl in pnls) / len(closed)
                if closed
                else None,
                "mean_closed_net_r": float(np.mean(net_r)) if closed else None,
                "median_closed_net_r": float(np.median(net_r)) if closed else None,
                "sum_closed_native_realized_pnl_usdt": str(sum(pnls, Decimal(0))),
            }
        groups[feature] = feature_groups
    return {
        "native_positions": len(detail),
        "native_closed_positions": sum(p["closed"] for p in detail),
        "coin_counts": dict(sorted(Counter(p["coin"] for p in detail).items())),
        "entry_month_counts": dict(
            sorted(Counter(p["entry_submission_month_utc"] for p in detail).items()),
        ),
        "feature_terciles": groups,
    }, detail


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--source-cases", type=Path, required=True)
    parser.add_argument("--h15-run", type=Path, required=True)
    parser.add_argument("--h15-audit", type=Path, required=True)
    parser.add_argument("--h19-run", type=Path, required=True)
    parser.add_argument("--h19-audit", type=Path, required=True)
    parser.add_argument("--h22-run", type=Path, required=True)
    parser.add_argument("--h22-audit", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--detail", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.identity.read_text())
    minute_root = Path(identity["minute_catalog_root"])
    daily_root = Path(identity["daily_catalog_root"])
    coins = [row["coin"] for row in identity["coins"]]
    if len(coins) != 37 or len(set(coins)) != 37:
        raise RuntimeError("registered 37-coin identity differs")
    for row in identity["coins"]:
        coin = row["coin"]
        if (
            tree_digest(minute_root / coin / "minute")
            != row["minute_catalog"]["sha256"]
            or tree_digest(daily_root / coin / "daily")
            != row["daily_catalog"]["sha256"]
        ):
            raise RuntimeError(f"{coin}: registered native Catalog tree changed")
    features = []
    for coin in coins:
        features.extend(
            monthly_features(daily_bars(coin, minute_root, daily_root), coin)
        )
    assign_terciles(features)
    lookup = {(row["coin"], row["month_start_utc"]): row for row in features}
    run_args = {
        "H15a": (args.h15_run, args.h15_audit),
        "H19a": (args.h19_run, args.h19_audit),
        "H22a": (args.h22_run, args.h22_audit),
    }
    runs = {}
    all_detail = []
    reports = {}
    for label, (run, audit) in run_args.items():
        positions, reports[label] = native_positions(run, audit, RUNS[label])
        runs[label], detail = summarize(positions, lookup, label)
        all_detail.extend(detail)
    result = {
        "schema": "r1-native-d71-asset-regime-descriptive/v1",
        "preregistration_commit": "1eaebfbcd",
        "coverage_correction_commit": "d44cdd3df",
        "input_identity_sha256": sha(args.identity),
        "source_cases_sha256": sha(args.source_cases),
        "native_run_reports": reports,
        "month_starts": len(MONTHS),
        "coins": coins,
        "source_case_mentions_in_curated_cases": source_mentions(
            args.source_cases, coins
        ),
        "feature_states": features,
        "runs": runs,
        "limitations": [
            "This is a descriptive analysis on the already viewed annual development set, with three prespecified correlated features and no multiple-comparison qualification.",
            "Tercile PnL is native closed-Position realized PnL, not a separately funded account return or a counterfactual asset filter.",
            "Open Positions are right-censored; first order submission predates fills and does not imply equal opportunity exposure.",
            "The fixed 2026 coin universe is backcast to 2025; curated video mentions are not a census of Ronnie's orders or a profitable-coin filter.",
        ],
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    detail_payload = json.dumps(all_detail, separators=(",", ":")).encode()
    with (
        args.detail.open("wb") as stream,
        gzip.GzipFile(fileobj=stream, mode="wb", mtime=0) as zipped,
    ):
        zipped.write(detail_payload)


if __name__ == "__main__":
    main()
