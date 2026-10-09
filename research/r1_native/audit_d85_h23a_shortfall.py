"""D85 read-only exact-geometry overlap and entry-room diagnosis."""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
from collections import defaultdict
from datetime import UTC
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from statistics import median


ROOT = Path(__file__).resolve().parent
H23 = Path("/tmp/r1-h23a-37")
H19 = Path("/tmp/r1-h23a-paired-h19a-37")
D82 = ROOT / "results/2026-10-08-d82-post-touch-bull-response-bundles.json.gz"
AUDIT = ROOT / "results/2026-10-08-h23a-37-native-audit.json"
CLOCK = ROOT / "results/2026-10-08-h23a-37-order-clock.json"
PARITY = ROOT / "results/2026-10-08-h23a-paired-h19a-parity.json"
OUT = ROOT / "results/2026-10-08-d85-h23a-shortfall.json"
DETAIL = ROOT / "results/2026-10-08-d85-h23a-shortfall-matches.json.gz"
HASHES = {
    H23
    / "summary.json": "d1a9e64db32c4c3dd1b7352f3ce65903dd757382cdc3ae9ff699179e9db7d6f5",
    H23
    / "orders.csv": "1bf293b8bb5b07a621601e5739cab2be31a5c4ee84409a942f1e371daf397024",
    H23
    / "positions.csv": "bd31fd8565269c7e8bd4d205fa94a7b74d522b6fd81472682d0b65f61fa29ba6",
    H19
    / "summary.json": "393e237f66eb684501d05eb77696e1af42d963de77c2482da7d204ba6e629645",
    H19
    / "orders.csv": "4f5670e832331b9ecf3d82a01b0f30d8a654d79fe5f361acac0b2811aed84a0b",
    H19
    / "positions.csv": "b65e1316bd61e09c6502ea2ab3f2b8aa52a484d73aad6cc28b6da1ef574e3e6d",
    D82: "3e30f06d99f4173d193a5f9051551c3412194dcb5c022d3a06146b02135788e1",
    AUDIT: "9b9a767db5f65867b6c542698d76778575b5ac776c3eac5bee681ea20469e9c3",
    CLOCK: "f34004dc0d8d1a9288c1fe25f725f7660e196b50141031bc89d59dc099b51182",
    PARITY: "a16c903ea36377988097f838d74b7ae998625d3579350a0f2f1ebb073c99df93",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dec(value: object) -> Decimal:
    return Decimal(str(value))


def rows(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def month(ns: int) -> str:
    return datetime.fromtimestamp(ns // 1_000_000_000, UTC).strftime("%Y-%m")


def group_h23(orders: list[dict]) -> list[dict]:
    by_list = defaultdict(dict)
    for order in orders:
        by_list[order["order_list_id"]][order["tags"]] = order
    parents = []
    for group in by_list.values():
        if not {"['ENTRY']", "['STOP_LOSS']", "['TAKE_PROFIT']"} <= group.keys():
            continue  # Native time exits have no bracket list.
        parent = group["['ENTRY']"]
        stop = dec(group["['STOP_LOSS']"]["trigger_price"])
        target = dec(group["['TAKE_PROFIT']"]["price"])
        trigger = dec(parent["trigger_price"])
        if not 0 < stop < trigger < target:
            raise RuntimeError(
                f"invalid native H23a geometry {parent['client_order_id']}"
            )
        parents.append(
            {
                "id": parent["client_order_id"],
                "coin": parent["instrument_id"].split("USDT")[0],
                "key": (parent["instrument_id"], stop, target),
                "submit_ns": int(parent["ts_init"]),
                "trigger": trigger,
                "status": parent["status"],
                "filled": dec(parent["filled_qty"]) > 0,
                "target_r": (target - trigger) / (trigger - stop),
            }
        )
    return parents


def summarize_matched(
    matched: list[dict], originals: list[dict], parents: list[dict]
) -> dict:
    old_matched = {row["original_bundle_id"] for row in matched}
    new_matched = {row["h23_parent_id"] for row in matched}
    old_ambig_or_absent = [
        row for row in originals if row["bundle_id"] not in old_matched
    ]
    old_closed = [
        p for row in old_ambig_or_absent for p in row["native_positions"] if p["closed"]
    ]
    changes = [row["target_r_change"] for row in matched]
    delays = [row["submit_delay_after_original_fill_hours"] for row in matched]
    by_coin = defaultdict(lambda: {"matched": 0, "old_winners": 0, "new_filled": 0})
    by_month = defaultdict(lambda: {"matched": 0, "old_winners": 0, "new_filled": 0})
    for row in matched:
        for dest in (by_coin[row["coin"]], by_month[row["h23_submission_month"]]):
            dest["matched"] += 1
            dest["old_winners"] += row["old_closed_winners"]
            dest["new_filled"] += row["h23_filled"]
    return {
        "h19_original_filled_bundles": len(originals),
        "h23_submitted_stop_parents": len(parents),
        "unambiguous_exact_geometry_matches": len(matched),
        "h19_bundles_without_unambiguous_match": len(old_ambig_or_absent),
        "h19_closed_winners_without_unambiguous_match": sum(
            dec(p["native_final_realized_pnl_usdt"]) > 0 for p in old_closed
        ),
        "h23_parents_without_unambiguous_match": len(parents) - len(new_matched),
        "matched_h23_filled": sum(row["h23_filled"] for row in matched),
        "matched_old_closed_positions": sum(
            row["old_closed_positions"] for row in matched
        ),
        "matched_old_closed_winners": sum(row["old_closed_winners"] for row in matched),
        "matched_h23_closed_positions": sum(
            row["h23_closed_positions"] for row in matched
        ),
        "matched_h23_closed_winners": sum(row["h23_closed_winners"] for row in matched),
        "matched_target_r_change_mean": sum(changes) / len(changes)
        if changes
        else None,
        "matched_target_r_change_median": median(changes) if changes else None,
        "matched_target_r_deteriorated": sum(value < 0 for value in changes),
        "matched_trigger_above_old_first_tier": sum(
            row["trigger_above_old_first_tier"] for row in matched
        ),
        "matched_submit_delay_hours_median": median(delays) if delays else None,
        "matched_submit_before_original_fill": sum(value < 0 for value in delays),
        "by_coin": dict(sorted(by_coin.items())),
        "by_h23_submission_month": dict(sorted(by_month.items())),
    }


def main() -> None:
    for path, expected in HASHES.items():
        if sha(path) != expected:
            raise RuntimeError(f"frozen D85 input changed: {path}")
    if (
        not json.loads(AUDIT.read_text())["passed"]
        or not json.loads(CLOCK.read_text())["passed"]
    ):
        raise RuntimeError("H23a native audit or completed-bar clock failed")
    if not json.loads(PARITY.read_text())["parity_passed"]:
        raise RuntimeError("paired H19a failed frozen parity")
    h23_summary = json.loads((H23 / "summary.json").read_text())
    h19_summary = json.loads((H19 / "summary.json").read_text())
    if len(h23_summary["per_coin"]) != 37 or len(h19_summary["per_coin"]) != 37:
        raise RuntimeError("37-coin native account coverage missing")
    if h23_summary["runner_source_sha256"] != h19_summary["runner_source_sha256"]:
        raise RuntimeError("paired native runner differs")
    with gzip.open(D82, "rt") as stream:
        originals = json.load(stream)
    if len(originals) != 500:
        raise RuntimeError("D82 old filled-bundle population changed")
    old_orders = rows(H19 / "orders.csv")
    old_by_prefix = defaultdict(list)
    for order in old_orders:
        if order["tags"] == "['ENTRY']":
            old_by_prefix[order["client_order_id"].rsplit("-", 1)[0]].append(order)
    original_by_key = defaultdict(list)
    for old in originals:
        parents = old_by_prefix[old["bundle_id"]]
        if len(parents) != 2:
            raise RuntimeError(
                f"original native two-tier parent mismatch: {old['bundle_id']}"
            )
        first = max(parents, key=lambda row: dec(row["price"]))
        observed_first_r = (dec(old["original_target_b_px"]) - dec(first["price"])) / (
            dec(first["price"]) - dec(old["original_stop_px"])
        )
        if abs(
            observed_first_r - dec(old["original_first_tier_planned_target_r"])
        ) > dec("0.001"):
            raise RuntimeError(
                f"original first-tier R disagrees with native orders: {old['bundle_id']}"
            )
        old["first_tier_price"] = first["price"]
        key = (
            first["instrument_id"],
            dec(old["original_stop_px"]),
            dec(old["original_target_b_px"]),
        )
        original_by_key[key].append(old)
    h23_parents = group_h23(rows(H23 / "orders.csv"))
    if len(h23_parents) != 431:
        raise RuntimeError("H23a native parent count changed")
    h23_by_key = defaultdict(list)
    for parent in h23_parents:
        h23_by_key[parent["key"]].append(parent)
    native_positions = defaultdict(list)
    for position in rows(H23 / "positions.csv"):
        native_positions[position["opening_order_id"]].append(position)
    matches = []
    for key in original_by_key.keys() & h23_by_key.keys():
        if len(original_by_key[key]) != 1 or len(h23_by_key[key]) != 1:
            continue
        old, new = original_by_key[key][0], h23_by_key[key][0]
        old_first_r = dec(old["original_first_tier_planned_target_r"])
        new_r = new["target_r"]
        old_closed = [p for p in old["native_positions"] if p["closed"]]
        new_closed = [p for p in native_positions[new["id"]] if p["ts_closed"]]
        matches.append(
            {
                "original_bundle_id": old["bundle_id"],
                "h23_parent_id": new["id"],
                "coin": old["coin"],
                "h23_submission_month": month(new["submit_ns"]),
                "original_first_fill_ns": old["first_native_buy_fill_ns"],
                "h23_submit_ns": new["submit_ns"],
                "submit_delay_after_original_fill_hours": (
                    new["submit_ns"] - old["first_native_buy_fill_ns"]
                )
                / 3_600_000_000_000,
                "old_first_tier_price": str(old["first_tier_price"]),
                "h23_trigger": str(new["trigger"]),
                "trigger_above_old_first_tier": new["trigger"]
                > dec(old["first_tier_price"]),
                "old_first_tier_target_r": float(old_first_r),
                "h23_target_r": float(new_r),
                "target_r_change": float(new_r - old_first_r),
                "h23_filled": new["filled"],
                "old_closed_positions": len(old_closed),
                "old_closed_winners": sum(
                    dec(p["native_final_realized_pnl_usdt"]) > 0 for p in old_closed
                ),
                "h23_closed_positions": len(new_closed),
                "h23_closed_winners": sum(
                    dec(p["realized_pnl"].split()[0]) > 0 for p in new_closed
                ),
            }
        )
    matches.sort(key=lambda row: (row["h23_submit_ns"], row["coin"]))
    stats = summarize_matched(matches, originals, h23_parents)
    old_no_key = [
        row
        for key, group in original_by_key.items()
        if key not in h23_by_key
        for row in group
    ]
    old_ambiguous = [
        row
        for key, group in original_by_key.items()
        if key in h23_by_key and (len(group) != 1 or len(h23_by_key[key]) != 1)
        for row in group
    ]
    stats["h19_bundles_with_no_h23_geometry_key"] = len(old_no_key)
    stats["h19_bundles_with_ambiguous_geometry_key"] = len(old_ambiguous)
    stats["h19_closed_winners_with_no_h23_geometry_key"] = sum(
        dec(position["native_final_realized_pnl_usdt"]) > 0
        for row in old_no_key
        for position in row["native_positions"]
        if position["closed"]
    )
    stats["h19_closed_winners_with_ambiguous_geometry_key"] = sum(
        dec(position["native_final_realized_pnl_usdt"]) > 0
        for row in old_ambiguous
        for position in row["native_positions"]
        if position["closed"]
    )
    stats["h23_parents_with_no_h19_geometry_key"] = sum(
        len(group) for key, group in h23_by_key.items() if key not in original_by_key
    )
    stats["h23_parents_with_ambiguous_geometry_key"] = sum(
        len(group)
        for key, group in h23_by_key.items()
        if key in original_by_key
        and (len(group) != 1 or len(original_by_key[key]) != 1)
    )
    stats["ambiguous_exact_geometry_keys"] = sum(
        len(original_by_key[key]) != 1 or len(h23_by_key[key]) != 1
        for key in original_by_key.keys() & h23_by_key.keys()
    )
    DETAIL.parent.mkdir(parents=True, exist_ok=True)
    with DETAIL.open("wb") as stream:
        with gzip.GzipFile(filename="", fileobj=stream, mode="wb", mtime=0) as archive:
            archive.write((json.dumps(matches, indent=2) + "\n").encode())
    report = {
        "schema": "r1-native-d85-h23a-shortfall/v1",
        "source_identity": {str(path): expected for path, expected in HASHES.items()},
        "matched_detail_sha256": sha(DETAIL),
        "summary": stats,
        "limitations": [
            "Exact stop/B uniqueness is a conservative plan-geometry join, not randomized treatment assignment; changed account and order paths create new opportunities.",
            "Unmatched includes no matching key and ambiguous repeated keys; it does not prove a specific plan had no H23a touch or signal.",
            "Old original winners/losers are actual H19a native Positions, not hypothetical H23a outcomes; matched H23a Positions are separately native.",
            "H23a source-plan first touch is not serialized in order reports; its Strategy counters and native order clock are audited separately.",
        ],
    }
    OUT.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
