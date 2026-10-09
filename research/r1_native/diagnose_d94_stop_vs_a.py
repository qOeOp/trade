"""D94: read-only native stop geometry and LAST A-support touch audit."""

from __future__ import annotations

import argparse
import ast
import csv
import gzip
import hashlib
import json
from bisect import bisect_left
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
from statistics import median

from nautilus_trader.model import BarType
from nautilus_trader.persistence import ParquetDataCatalog

from audit_d80_brooks_breakout_context import END
from audit_d80_brooks_breakout_context import FIVE_MIN_NS
from audit_d80_brooks_breakout_context import MILLISECOND_NS
from audit_d80_brooks_breakout_context import START
from audit_d80_brooks_breakout_context import native_bars
from readback_h26a_flow import read


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
IDENTITY = RESULTS / "2026-10-07-input-identity.json"
EXPECTED = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    RESULTS / "2026-10-09-h26a-control-h25a-summary.json": "95250f1359bd82e4bec80e96bcce664ef89e588625ee251e179561d4facf07ad",
    RESULTS / "2026-10-09-h26a-control-h25a-native-audit.json": "c52255e865c58aaed328f35438d916c74d78ab4cf2846d1f466d69de56bbed21",
    RESULTS / "2026-10-09-h26a-37-summary.json": "cc8f4df0199cb6c1b16146af95b880461b11da8e8ca2dd0775ff59ef59b9912a",
    RESULTS / "2026-10-09-h26a-37-native-audit.json": "164f41a06fbb3f401511142ebf759c84634dde6b4853fd12c36939a4371a98df",
    RESULTS / "2026-10-09-h26a-37-support-clock.json": "91edf5383a81758a17010b9e24efcdfd78b547ea94ab9f56230331c108121d5e",
    RESULTS / "2026-10-09-h26a-vs-h25a-flow.json": "068073fd694adbfa520d109afca61d2ba348a0888e00f58a8cddaa373c8077cc",
}
STOP_BUFFER_ATR = Decimal("0.25")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_orders(run: Path) -> dict:
    with (run / "orders.csv").open(newline="") as source:
        return {row["client_order_id"]: row for row in csv.DictReader(source)}


def decision_index(summary: dict) -> dict:
    return {
        row["coin"]: {
            (item["rounded_stop"], item["rounded_b"], item["signal_end_ns"]): item
            for item in row["structural_support"]["decisions"] if item["accepted"]
        }
        for row in summary["per_coin"]
    }


def five_minute_last(root: Path, coin: str, instrument_id: str) -> list:
    catalog = ParquetDataCatalog(str(root / coin / "minute"))
    bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
    bars = sorted(
        (bar for bar in catalog.query_bars([instrument_id], start=START, end=END)
         if bar.bar_type == bar_type),
        key=lambda bar: bar.ts_event,
    )
    expected = (END - START) // FIVE_MIN_NS
    if len(bars) != expected:
        raise RuntimeError(f"{coin}: native LAST bar count changed")
    if any(bar.ts_event != START + (i + 1) * FIVE_MIN_NS - MILLISECOND_NS for i, bar in enumerate(bars)):
        raise RuntimeError(f"{coin}: native LAST five-minute clock has a gap")
    return bars


def stop_exit_path(position: dict, orders: dict, bars: list, a: Decimal) -> dict:
    events = ast.literal_eval(position["events"])
    buys = [event for event in events if event["type"] == "OrderFilled" and event["order_side"] == "BUY"]
    sells = [event for event in events if event["type"] == "OrderFilled" and event["order_side"] == "SELL"]
    if not buys or not sells or sells[-1]["client_order_id"] != position["closing_order_id"]:
        raise RuntimeError("native stop Position has inconsistent fill events")
    opened, closed = int(buys[0]["ts_event"]), int(sells[-1]["ts_event"])
    ends = [bar.ts_event for bar in bars]
    entry_i, exit_i = bisect_left(ends, opened), bisect_left(ends, closed)
    if entry_i >= len(bars) or exit_i >= len(bars) or exit_i < entry_i:
        raise RuntimeError("native stop event outside verified LAST bars")
    entry_low = Decimal(str(bars[entry_i].low))
    exit_low = Decimal(str(bars[exit_i].low))
    interior_lows = [Decimal(str(bar.low)) for bar in bars[entry_i + 1 : exit_i]]
    return {
        "opening_order_id": position["opening_order_id"],
        "closing_order_id": position["closing_order_id"],
        "first_fill_ns": opened,
        "stop_exit_ns": closed,
        "native_entry_fill_count": len(buys),
        "native_exit_price": sells[-1]["last_px"],
        "native_exit_price_below_a": Decimal(str(sells[-1]["last_px"])) <= a,
        "entry_containing_bar_a_touch_ambiguous": entry_low <= a,
        "strict_interior_a_touch": any(low <= a for low in interior_lows),
        "exit_containing_bar_a_touch_ambiguous": exit_low <= a,
        "no_a_touch_in_any_observed_last_bar": (
            entry_low > a and all(low > a for low in interior_lows) and exit_low > a
        ),
        "strict_interior_complete_five_minute_bars": len(interior_lows),
        "native_closed_realized_pnl_usdt": position["realized_pnl"],
    }


def describe(rows: list[dict]) -> dict:
    def med(values: list[float]) -> float | None:
        return median(values) if values else None
    above = [row for row in rows if row["stop_to_a_relation"] == "above"]
    stopped = [path for row in rows for path in row["native_stop_positions"]]
    return {
        "submitted_bundles": len(rows),
        "native_positions": sum(row["native_position_count"] for row in rows),
        "native_closed": sum(row["native_closed_count"] for row in rows),
        "native_positive_closed": sum(row["native_positive_closed_count"] for row in rows),
        "native_open_censored": sum(row["native_open_count"] for row in rows),
        "stop_relative_to_a": dict(Counter(row["stop_to_a_relation"] for row in rows)),
        "median_old_stop_above_a_prior_atr": med([row["old_stop_minus_a_over_prior_atr"] for row in above]),
        "median_first_tier_target_r_old_new": {
            "old": med([row["first_tier_old_target_r"] for row in rows]),
            "outside_a": med([row["first_tier_outside_a_target_r"] for row in rows if row["first_tier_outside_a_target_r"] is not None]),
        },
        "median_deeper_tier_target_r_old_new": {
            "old": med([row["deeper_tier_old_target_r"] for row in rows]),
            "outside_a": med([row["deeper_tier_outside_a_target_r"] for row in rows if row["deeper_tier_outside_a_target_r"] is not None]),
        },
        "median_constant_risk_first_tier_size_ratio_outside_a_over_old": med([row["first_tier_constant_risk_size_ratio"] for row in rows if row["first_tier_constant_risk_size_ratio"] is not None]),
        "invalid_outside_a_geometry": sum(not row["outside_a_geometry_valid"] for row in rows),
        "native_final_stop_positions": len(stopped),
        "native_final_stop_no_a_touch_even_exit_bar": sum(path["no_a_touch_in_any_observed_last_bar"] for path in stopped),
        "native_final_stop_a_touch_strict_interior": sum(path["strict_interior_a_touch"] for path in stopped),
        "native_final_stop_a_touch_exit_bar": sum(path["exit_containing_bar_a_touch_ambiguous"] for path in stopped),
        "native_final_stop_exit_price_at_or_below_a": sum(path["native_exit_price_below_a"] for path in stopped),
        "native_final_stop_entry_bar_a_touch_ambiguous": sum(path["entry_containing_bar_a_touch_ambiguous"] for path in stopped),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--h25", type=Path, required=True)
    parser.add_argument("--h26", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--detail", type=Path, required=True)
    args = parser.parse_args()
    for path, digest in EXPECTED.items():
        if sha(path) != digest:
            raise RuntimeError(f"frozen D94 input changed: {path}")
    for name in ("2026-10-09-h26a-control-h25a-native-audit.json", "2026-10-09-h26a-37-native-audit.json", "2026-10-09-h26a-37-support-clock.json"):
        if not json.loads((RESULTS / name).read_text())["passed"]:
            raise RuntimeError(f"native integrity prerequisite failed: {name}")
    identity = json.loads(IDENTITY.read_text())
    source_by_coin = {item["coin"]: item for item in identity["coins"]}
    h25, h26 = read(args.h25), read(args.h26)
    flow = json.loads((RESULTS / "2026-10-09-h26a-vs-h25a-flow.json").read_text())
    if h25["sha256"] != flow["baseline_sha256"] or h26["sha256"] != flow["candidate_sha256"]:
        raise RuntimeError("H25a/H26a native report identity changed")
    if (len(h25["bundles"]), len(h26["bundles"])) != (655, 1137):
        raise RuntimeError("registered native source bundle populations changed")
    orders = {"h25": read_orders(args.h25), "h26": read_orders(args.h26)}
    decisions = {"h25": decision_index(h25["summary"]), "h26": decision_index(h26["summary"])}
    runs = {"h25": h25, "h26": h26}
    detail = {"h25": [], "h26": []}
    for coin in sorted(source_by_coin):
        root = Path(identity["minute_catalog_root"])
        instrument, _, _ = native_bars(root, coin, source_by_coin[coin]["minute_catalog"]["sha256"])
        bars = five_minute_last(root, coin, str(instrument.id))
        for name in ("h25", "h26"):
            run = runs[name]
            for key in sorted(k for k in run["bundles"] if k[0] == coin):
                _, stop_text, b_text, signal_ns = key
                decision = decisions[name][coin][(stop_text, b_text, signal_ns)]
                a, b, stop = map(Decimal, (decision["rounded_a"], b_text, stop_text))
                atr = Decimal(str(decision["prior_14bar_wilder_atr"]))
                if atr <= 0:
                    raise RuntimeError("nonpositive prior native ATR")
                parents = sorted(run["bundles"][key], key=lambda row: Decimal(row["price"]), reverse=True)
                if len(parents) != 2:
                    raise RuntimeError("native two-tier bundle changed")
                first, deeper = (Decimal(parent["price"]) for parent in parents)
                if not stop < deeper < first < b:
                    raise RuntimeError("native parent/stop/B geometry changed")
                outside = instrument.make_price(float(a - STOP_BUFFER_ATR * atr)).as_decimal()
                valid = Decimal(0) < outside < a and outside < deeper
                first_old_r, deeper_old_r = (b - first) / (first - stop), (b - deeper) / (deeper - stop)
                source_positions = run["outcomes"].get(key, [])
                native_closed = [p for p in source_positions if p["ts_closed"]]
                stopped = [
                    stop_exit_path(p, orders[name], bars, a)
                    for p in native_closed
                    if orders[name][p["closing_order_id"]]["tags"] == "['STOP_LOSS']"
                ]
                detail[name].append({
                    "source_key": [coin, stop_text, b_text, signal_ns],
                    "rounded_a": str(a),
                    "prior_atr": str(atr),
                    "old_native_stop": str(stop),
                    "stop_to_a_relation": "above" if stop > a else "equal" if stop == a else "below",
                    "old_stop_minus_a_over_prior_atr": float((stop - a) / atr),
                    "outside_a_illustrative_stop": str(outside),
                    "outside_a_geometry_valid": valid,
                    "first_tier_old_target_r": float(first_old_r),
                    "deeper_tier_old_target_r": float(deeper_old_r),
                    "first_tier_outside_a_target_r": float((b - first) / (first - outside)) if valid else None,
                    "deeper_tier_outside_a_target_r": float((b - deeper) / (deeper - outside)) if valid else None,
                    "first_tier_constant_risk_size_ratio": float((first - stop) / (first - outside)) if valid else None,
                    "deeper_tier_constant_risk_size_ratio": float((deeper - stop) / (deeper - outside)) if valid else None,
                    "native_position_count": len(source_positions),
                    "native_closed_count": len(native_closed),
                    "native_positive_closed_count": sum(Decimal(p["realized_pnl"].removesuffix(" USDT")) > 0 for p in native_closed),
                    "native_open_count": len(source_positions) - len(native_closed),
                    "native_stop_positions": stopped,
                })
        print(f"D94 verified {coin}: {len(bars)} continuous native LAST bars", flush=True)
    result = {
        "schema": "r1-native-d94-stop-vs-a/v1",
        "registration_commit": "7a1c825810e8849a3014c7a28bc21faf6065d11e",
        "frozen_sha256": {str(path.relative_to(ROOT)): digest for path, digest in EXPECTED.items()},
        "h25_native_sha256": h25["sha256"],
        "h26_native_sha256": h26["sha256"],
        "h25": describe(detail["h25"]),
        "h26": describe(detail["h26"]),
        "limitations": [
            "An outside-A stop and size ratio are geometric illustrations only; no alternative native order, fill or shared-account return was computed.",
            "A five-minute bar containing the native fill or stop exit cannot order its intrabar high/low relative to the fill event; those touches are flagged separately.",
            "Current native instrument terms approximate historical metadata; strategy outcomes remain from the already exposed one-year development sample.",
            "An A-support test is a researcher proxy and C18 permits a 76.4% stop; the source does not prescribe one universal stop placement.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.detail.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    with gzip.open(args.detail, "wt", encoding="utf-8") as stream:
        json.dump(detail, stream, separators=(",", ":"))


if __name__ == "__main__":
    main()
