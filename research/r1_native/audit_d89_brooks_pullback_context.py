"""Read-only Brooks overlap-depth and pullback extension on frozen D88 plans."""

from __future__ import annotations

import gzip
import hashlib
import io
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from audit_d80_brooks_breakout_context import native_bars
from audit_d88_brooks_leg_context import stability
from audit_d88_brooks_leg_context import summarize
from audit_d88_brooks_leg_context import third


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
IDENTITY = RESULTS / "2026-10-07-input-identity.json"
D88_SUMMARY = RESULTS / "2026-10-08-d88-brooks-leg-context.json"
D88_DETAIL = RESULTS / "2026-10-08-d88-brooks-leg-context-bundles.json.gz"
OUT = RESULTS / "2026-10-08-d89-brooks-pullback-context.json"
DETAIL = RESULTS / "2026-10-08-d89-brooks-pullback-context-bundles.json.gz"
EXPECTED = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    D88_SUMMARY: "0abffaf16fba6a6264d72560f3ced8bbc4c4e1e43dc27631fa32ee918a4eb28c",
    D88_DETAIL: "fb6d92e1330e9ebd92ba1da725849ee78e9f77d9d47a6bc245feb73d407299fa",
}
METRICS = (
    "mean_adjacent_overlap_depth",
    "bear_bar_frequency",
    "max_close_pullback_fraction",
)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compute(row: dict, bars: list[dict], by_end: dict[int, int]) -> dict:
    ai = by_end[row["a_end_ns"]]
    bi = by_end[row["b_end_ns"]]
    if ai >= bi or bars[bi]["end_ns"] >= row["native_submission_ns"]:
        raise RuntimeError(f"{row['bundle_id']}: noncausal or empty source leg")
    leg = bars[ai : bi + 1]
    depth = []
    for before, after in zip(leg, leg[1:], strict=False):
        smaller = min(before["high"] - before["low"], after["high"] - after["low"])
        if smaller <= 0:
            raise RuntimeError(f"{row['bundle_id']}: zero native high-low bar range")
        overlap = max(0.0, min(before["high"], after["high"]) - max(before["low"], after["low"]))
        depth.append(overlap / smaller)
    mean_overlap = sum(depth) / len(depth)
    bear_frequency = sum(bar["close"] < bar["open"] for bar in leg) / len(leg)
    span = max(bar["high"] for bar in leg) - min(bar["low"] for bar in leg)
    peak = leg[0]["close"]
    drawdown = 0.0
    for bar in leg[1:]:
        drawdown = max(drawdown, peak - bar["close"])
        peak = max(peak, bar["close"])
    pullback = min(1.0, drawdown / span) if span > 0 else None
    result = dict(row)
    result.update({
        "mean_adjacent_overlap_depth": mean_overlap,
        "bear_bar_frequency": bear_frequency,
        "max_close_pullback_fraction": pullback,
    })
    for name in METRICS:
        value = result[name]
        if value is not None and not (0 <= value <= 1 + 1e-10):
            raise RuntimeError(f"{row['bundle_id']}: {name} outside logical scale")
        result[f"{name}_third"] = third(value)
    return result


def main() -> None:
    for path, expected in EXPECTED.items():
        if sha(path) != expected:
            raise RuntimeError(f"frozen D88 input changed: {path}")
    identity = json.loads(IDENTITY.read_text())
    with gzip.open(D88_DETAIL, "rt") as stream:
        original = json.load(stream)
    by_coin = defaultdict(list)
    for row in original:
        by_coin[row["coin"]].append(row)
    output = []
    for coin_identity in identity["coins"]:
        coin = coin_identity["coin"]
        _, bars, _ = native_bars(
            Path(identity["minute_catalog_root"]),
            coin,
            coin_identity["minute_catalog"]["sha256"],
        )
        index = {bar["end_ns"]: i for i, bar in enumerate(bars)}
        output.extend(compute(row, bars, index) for row in by_coin[coin])
    output.sort(key=lambda row: (row["native_submission_ns"], row["bundle_id"]))
    if len(output) != 2939 or len({row["bundle_id"] for row in output}) != 2939:
        raise RuntimeError("D89 native bundle population changed")
    result = {
        "schema": "r1-native-d89-brooks-pullback-context/v1",
        "source_sha256": {str(path): value for path, value in EXPECTED.items()},
        "all": summarize(output),
        "metrics": {},
        "limitations": ["One predefined descriptive extension of saturated D88 overlap; original native Position outcomes include fees/funding but are not a filtered shared-account replay.", "Fixed logical thirds do not define a qualified trading rule; sparse groups and multiple prior exposed-year reads require independent delayed validation."],
    }
    for name in METRICS:
        field = f"{name}_third"
        result["metrics"][name] = {
            "by_third": {label: summarize([r for r in output if r[field] == label]) for label in ("lower", "middle", "upper", "undefined")},
            "coin_stability": stability(output, field, "coin"),
            "month_stability": stability(output, field, "submission_month_utc"),
            "low_third_winner_bundles": [r["bundle_id"] for r in output if r[field] == "lower" and any(p["closed"] and Decimal(p["native_final_realized_pnl_usdt"]) > 0 for p in r["native_positions"])],
            "high_third_nonwinner_bundles": [r["bundle_id"] for r in output if r[field] == "upper" and any(p["closed"] and Decimal(p["native_final_realized_pnl_usdt"]) <= 0 for p in r["native_positions"])],
        }
    if (result["all"]["submitted_bundles"], result["all"]["native_closed"], result["all"]["native_wins"]) != (2939, 496, 212):
        raise RuntimeError("frozen H19a Position outcomes changed")
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    with DETAIL.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0) as compressed, io.TextIOWrapper(compressed, encoding="utf-8") as stream:
        json.dump(output, stream)


if __name__ == "__main__":
    main()
