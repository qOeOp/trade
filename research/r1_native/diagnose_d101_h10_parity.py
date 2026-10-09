"""One frozen, read-only adjudication of the existing H10 native reports."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from datetime import date
from decimal import Decimal
from pathlib import Path


OLD = Path("/tmp/r1-rd-h10-full-37")
NEW = Path("/tmp/r1-h29a-paired-h10-37-native-repaired")
EXPECTED = {
    "old": "ea8a4b3777a2e107385057e5e6b3eef480e948a3a67984063fd4bd98485d3aab",
    "new": "ca42700568b49b7608f8a457355794e52224c581181c2c57955111fbb6abfb25",
}
NAMES = ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv")


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as src:
        return list(csv.DictReader(src))


def numeric_delta(left: str, right: str) -> str | None:
    try:
        return str(abs(Decimal(left) - Decimal(right)))
    except Exception:
        return None


def paired_rows(left: list[dict[str, str]], right: list[dict[str, str]], key: str) -> tuple[list[tuple[dict[str, str], dict[str, str]]], dict]:
    a = {row[key]: row for row in left}
    b = {row[key]: row for row in right}
    if len(a) != len(left) or len(b) != len(right):
        raise ValueError(f"non-unique {key}")
    common = sorted(a.keys() & b.keys())
    return [(a[k], b[k]) for k in common], {
        "old_count": len(left),
        "new_count": len(right),
        "common": len(common),
        "only_old": sorted(a.keys() - b.keys())[:5],
        "only_new": sorted(b.keys() - a.keys())[:5],
    }


def diffs(pairs: list[tuple[dict[str, str], dict[str, str]]], key: str, *, ignore: tuple[str, ...] = ()) -> dict:
    fields = Counter()
    examples = []
    numeric = {}
    for a, b in pairs:
        changed = [name for name in a if name not in ignore and a[name] != b[name]]
        for name in changed:
            fields[name] += 1
            delta = numeric_delta(a[name], b[name])
            if delta is not None and (name not in numeric or Decimal(delta) > Decimal(numeric[name]["max_abs_delta"])):
                numeric[name] = {"max_abs_delta": delta, "key": a[key], "old": a[name], "new": b[name]}
        if changed and len(examples) < 8:
            examples.append({"key": a[key], "fields": changed, "values": {n: [a[n], b[n]] for n in changed if n in ("status", "avg_px_open", "avg_px_close", "realized_return", "realized_pnl", "liquidity_side", "expire_time_ns")}})
    return {"field_counts": dict(fields), "max_numeric_differences": numeric, "examples": examples}


def day_ends(rows: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    result = {}
    for row in rows:
        result[str(date.fromisoformat(row["ts_event"][:10]))] = row
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    paths = {label: {name: root / name for name in NAMES} for label, root in (("old", OLD), ("new", NEW))}
    hashes = {label: {name: digest(path) for name, path in files.items()} for label, files in paths.items()}
    for label, expected in EXPECTED.items():
        if hashes[label]["summary.json"] != expected:
            raise RuntimeError(f"{label} summary identity changed")
    data = {label: {name: read_csv(path) for name, path in files.items() if name.endswith(".csv")} for label, files in paths.items()}
    summaries = {label: json.loads(paths[label]["summary.json"].read_text()) for label in paths}
    order_pairs, order_keys = paired_rows(data["old"]["orders.csv"], data["new"]["orders.csv"], "client_order_id")
    fill_pairs, fill_keys = paired_rows(data["old"]["fills.csv"], data["new"]["fills.csv"], "trade_id")
    position_pairs = list(zip(data["old"]["positions.csv"], data["new"]["positions.csv"], strict=True))
    return_pairs = list(zip(data["old"]["returns_series.csv"], data["new"]["returns_series.csv"], strict=True))
    if any(a["ts_event_ns"] != b["ts_event_ns"] for a, b in return_pairs):
        raise RuntimeError("daily return clocks differ")
    old_days = day_ends(data["old"]["account.csv"])
    new_days = day_ends(data["new"]["account.csv"])
    day_keys = sorted(old_days.keys() | new_days.keys())
    account_day_deltas = []
    for day in day_keys:
        a, b = old_days.get(day), new_days.get(day)
        if a is None or b is None:
            account_day_deltas.append({"day": day, "missing": "old" if a is None else "new"})
        elif a["total"] != b["total"]:
            account_day_deltas.append({"day": day, "old": a["total"], "new": b["total"], "abs_delta": numeric_delta(a["total"], b["total"])})
    result = {
        "kind": "D101_existing_native_report_read_only",
        "input_sha256": hashes,
        "summary_metrics": {name: [summaries["old"].get(name), summaries["new"].get(name)] for name in ("starting_balance_usdt", "final_equity_usdt", "annualized_return_pct", "closed_trades", "winning_trades", "denied_orders", "rejected_orders", "native_sharpe_365", "native_max_drawdown_daily_close")},
        "orders": {**order_keys, **diffs(order_pairs, "client_order_id"), "status_cross": {f"{a} -> {b}": count for (a, b), count in Counter((a["status"], b["status"]) for a, b in order_pairs).items()}},
        "fills": {**fill_keys, **diffs(fill_pairs, "trade_id", ignore=("event_id",))},
        "positions": {"counts": [len(data["old"]["positions.csv"]), len(data["new"]["positions.csv"])], **diffs(position_pairs, "opening_order_id", ignore=("position_id", "events", "venue_order_ids", "trade_ids")), "realized_pnl_differences": [{"row": i, "old": a["realized_pnl"], "new": b["realized_pnl"]} for i, (a, b) in enumerate(position_pairs) if a["realized_pnl"] != b["realized_pnl"]][:10]},
        "returns_series": {"counts": [len(data["old"]["returns_series.csv"]), len(data["new"]["returns_series.csv"])], **diffs(return_pairs, "ts_event_ns")},
        "account_report": {"event_counts": [len(data["old"]["account.csv"]), len(data["new"]["account.csv"])], "observed_event_day_counts": [len(old_days), len(new_days)], "last_event_per_observed_day_total_mismatch_count": len(account_day_deltas), "first_day_total_differences": account_day_deltas[:10], "last_total": [data["old"]["account.csv"][-1]["total"], data["new"]["account.csv"][-1]["total"]], "limitation": "Account report is emitted on account events, not at every daily MARK close; last event per observed UTC day is settled account total only and cannot establish full daily Portfolio equity parity."},
    }
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str) + "\n")


if __name__ == "__main__":
    main()
