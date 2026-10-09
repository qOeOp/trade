"""Read-only D81 planned-entry location in a causal 60-bar range proxy."""

from __future__ import annotations

import gzip
import hashlib
import io
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

from audit_d80_brooks_breakout_context import native_bars, summarize


ROOT = Path(__file__).resolve().parent
IDENTITY = ROOT / "results/2026-10-07-input-identity.json"
D77 = ROOT / "results/2026-10-08-d77-native-entry-geometry-bundles.json.gz"
D80 = ROOT / "results/2026-10-08-d80-brooks-breakout-context.json"
D80_DETAIL = ROOT / "results/2026-10-08-d80-brooks-breakout-context-bundles.json.gz"
OUT = ROOT / "results/2026-10-08-d81-brooks-range-location.json"
DETAIL = ROOT / "results/2026-10-08-d81-brooks-range-location-bundles.json.gz"
HASHES = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    D77: "ed66b59b9f8db091572aaec1fb65146c629686cc94954fa3cb6fc991034c56b0",
    D80: "c43f101d0ac1a823c690e4a0629b87f3fbe7da05b94e6a2cbba92164603ff07c",
    D80_DETAIL: "ac941cfa197cee805c38d7447c296e05aa5819344312cd755e5d574dcac192c4",
}
LOCATIONS = ("lower_third", "middle_third", "upper_third", "below_range", "above_range")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def location(value: Decimal, low: Decimal, high: Decimal) -> tuple[str, str]:
    if high <= low:
        raise RuntimeError("nonpositive causal range")
    ratio = (value - low) / (high - low)
    if ratio < 0:
        kind = "below_range"
    elif ratio > 1:
        kind = "above_range"
    elif ratio <= Decimal(1) / Decimal(3):
        kind = "lower_third"
    elif ratio < Decimal(2) / Decimal(3):
        kind = "middle_third"
    else:
        kind = "upper_third"
    return kind, str(ratio)


def groups(rows: list[dict]) -> dict:
    return {name: summarize([row for row in rows if row["first_entry_location"] == name]) for name in LOCATIONS}


def main() -> None:
    for path, expected in HASHES.items():
        if sha(path) != expected:
            raise RuntimeError(f"frozen D81 input changed: {path}")
    identity = json.loads(IDENTITY.read_text())
    d80 = json.loads(D80.read_text())
    if d80["detail_sha256"] != HASHES[D80_DETAIL]:
        raise RuntimeError("D80 native detail pointer changed")
    with gzip.open(D77, "rt") as stream:
        d77 = {row["bundle_id"]: row for row in json.load(stream)}
    with gzip.open(D80_DETAIL, "rt") as stream:
        original = json.load(stream)
    if len(original) != 2939 or len(d77) != 2939:
        raise RuntimeError("native bundle population changed")
    by_coin = defaultdict(list)
    for row in original:
        by_coin[row["coin"]].append(row)
    output = []
    catalog_counts = {}
    for entry in identity["coins"]:
        coin = entry["coin"]
        _, bars, count = native_bars(Path(identity["minute_catalog_root"]), coin, entry["minute_catalog"]["sha256"])
        catalog_counts[coin] = {"native_last_bars": count, "complete_four_hour_bars": len(bars)}
        by_end = {bar["end_ns"]: index for index, bar in enumerate(bars)}
        for row in by_coin[coin]:
            source = d77[row["bundle_id"]]
            signal_i = by_end[row["signal_end_ns"]]
            if signal_i < 59:
                raise RuntimeError(f"{row['bundle_id']}: short causal range")
            recent = bars[signal_i - 59 : signal_i + 1]
            low = Decimal(str(min(bar["low"] for bar in recent)))
            high = Decimal(str(max(bar["high"] for bar in recent)))
            first = Decimal(source["tier_geometry"]["first"]["entry"])
            deeper = Decimal(source["tier_geometry"]["deeper"]["entry"])
            first_kind, first_fraction = location(first, low, high)
            deep_kind, deep_fraction = location(deeper, low, high)
            if not 0 < deeper < first < high:
                raise RuntimeError(f"{row['bundle_id']}: unexpected native tier geometry")
            output.append({
                **row,
                "causal_range_low": str(low),
                "causal_range_high": str(high),
                "first_entry_px": str(first),
                "deeper_entry_px": str(deeper),
                "first_entry_fraction_of_range": first_fraction,
                "deeper_entry_fraction_of_range": deep_fraction,
                "first_entry_location": first_kind,
                "deeper_entry_location": deep_kind,
                "unique_first_native_buy_fill_tier": source["unique_first_native_buy_fill"]["tier"] if source["unique_first_native_buy_fill"] else None,
                "ambiguous_earliest_native_buy_fills": len(source["ambiguous_earliest_native_buy_fills"]),
            })
    if len(output) != 2939 or len({row["bundle_id"] for row in output}) != 2939:
        raise RuntimeError("not all native bundles classified")
    output.sort(key=lambda row: (row["native_submission_ns"], row["bundle_id"]))
    no_break = [row for row in output if not row["b_close_breaks_prior_60_high"]]
    close_break = [row for row in output if row["b_close_breaks_prior_60_high"]]
    result = {
        "schema": "r1-native-d81-brooks-range-location/v1",
        "preregistration_commit": "482efdb35",
        "input_sha256": {path.name: sha(path) for path in HASHES},
        "catalog_counts": catalog_counts,
        "all": summarize(output),
        "no_close_breakout": {"all": summarize(no_break), "by_first_entry_location": groups(no_break)},
        "close_breakout": {"all": summarize(close_break), "by_first_entry_location": groups(close_break)},
        "first_mid_deeper_lower": {
            "all_submitted_bundles": sum(row["first_entry_location"] == "middle_third" and row["deeper_entry_location"] == "lower_third" for row in output),
            "no_close_breakout_submitted_bundles": sum(row["first_entry_location"] == "middle_third" and row["deeper_entry_location"] == "lower_third" for row in no_break),
            "no_close_breakout_filled_bundles": sum(row["first_entry_location"] == "middle_third" and row["deeper_entry_location"] == "lower_third" and row["any_positive_buy_fill"] for row in no_break),
        },
        "earliest_native_fill_tier_counts": dict(Counter(row["unique_first_native_buy_fill_tier"] or ("ambiguous" if row["ambiguous_earliest_native_buy_fills"] else "unfilled") for row in output)),
        "limitations": ["The 60-bar high/low is a researcher-defined causal range proxy; no-close-breakout B is not proof of a Brooks trading range.", "Location is based on original submitted limit prices, not a hindsight fill price; mixed first/deeper tiers cannot be reallocated by arithmetic.", "Group PnL retains original native fees/funding and fill selection but is not a filtered-account counterfactual.", "Only one predeclared thirds partition is read; no thresholds or lookbacks are searched."],
    }
    with gzip.GzipFile(filename=str(DETAIL), mode="wb", compresslevel=6, mtime=0) as zipped:
        with io.TextIOWrapper(zipped, encoding="utf-8") as stream:
            json.dump(output, stream, separators=(",", ":"), ensure_ascii=False)
    result["detail_file"] = DETAIL.name
    result["detail_sha256"] = sha(DETAIL)
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"no_close_breakout": {k: {x: v[x] for x in ("submitted_bundles", "filled_bundles", "native_closed", "native_winners", "native_closed_win_pct", "native_realized_payoff", "native_closed_net_pnl_usdt")} for k, v in result["no_close_breakout"]["by_first_entry_location"].items()}, "first_mid_deeper_lower": result["first_mid_deeper_lower"]}, indent=2))


if __name__ == "__main__":
    main()
