"""The semantic fingerprint is equal for two replays of one run and names the table and day that differ."""

import csv
import gzip
import json
import tempfile
import unittest
import uuid
from pathlib import Path

from engine.compare import report_fingerprint


DAY1, DAY2 = 1736294400000000000, 1736380800000000000


def write_reports(root: Path, ids: dict, swap: bool = False, last_px: str = "0.98880") -> None:
    """A two-order run whose random IDs come from `ids`; `swap` reverses the file order of rows."""
    root.mkdir(parents=True)
    fills = [{"client_order_id": "O-1", "trade_id": ids["t1"], "event_id": ids["f1"], "last_qty": "5",
              "last_px": last_px, "ts_event": "2025-01-08 00:00:00+00:00", "position_id": "P"},
             {"client_order_id": "O-2", "trade_id": ids["t2"], "event_id": ids["f2"], "last_qty": "5",
              "last_px": "1.01000", "ts_event": "2025-01-09 00:00:00+00:00", "position_id": "P"}]
    orders = [{"client_order_id": "O-1", "init_id": ids["i1"], "last_trade_id": ids["t1"], "ts_init": str(DAY1)},
              {"client_order_id": "O-2", "init_id": ids["i2"], "last_trade_id": ids["t2"], "ts_init": str(DAY2)}]
    positions = [{"position_id": f"P-{ids['s1']}", "ts_opened": "2025-01-08 00:00:00+00:00",
                  "events": str([{"event_id": ids["f1"], "trade_id": ids["t1"]},
                                 {"event_id": ids["f2"], "trade_id": ids["t2"]}]),
                  "adjustments": str([{"adjustment_type": "FUNDING", "event_id": ids["a1"], "pnl_change": "-0.1 USDT"}])}]
    events = [{"type": "OrderInitialized", "client_order_id": "O-1", "event_id": ids["i1"], "ts_event": DAY1},
              {"type": "OrderFilled", "client_order_id": "O-1", "event_id": ids["f1"], "trade_id": ids["t1"],
               "ts_event": DAY1},
              {"type": "OrderInitialized", "client_order_id": "O-2", "event_id": ids["i2"], "ts_event": DAY2},
              {"type": "OrderFilled", "client_order_id": "O-2", "event_id": ids["f2"], "trade_id": ids["t2"],
               "ts_event": DAY2}]
    order = (lambda rows: rows[::-1]) if swap else (lambda rows: rows)
    for name, rows in (("orders", orders), ("fills", fills), ("positions", positions)):
        with (root / f"{name}.csv").open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(order(rows))
    (root / "account.csv").write_text("ts_event,total\n2025-01-08 00:00:00+00:00,100000\n")
    (root / "returns_series.csv").write_text(f"ts_event_ns,native_return\n{DAY1},0.0\n")
    with gzip.open(root / "exposures.csv.gz", "wt", newline="") as stream:
        stream.write(f"ts_event_ns,position_id,notional_value,unrealized_pnl\n{DAY1 - 10**6},P,5 USDT,0 USDT\n")
    by_order = {"O-1": events[:2], "O-2": events[2:]}
    with gzip.open(root / "order_events.jsonl.gz", "wt") as stream:
        for identity in order(["O-1", "O-2"]):
            for event in by_order[identity]:
                stream.write(json.dumps(event, sort_keys=True) + "\n")


def fresh_ids() -> dict:
    return {**{key: str(uuid.uuid4()) for key in ("f1", "f2", "i1", "i2", "s1", "a1")},
            **{key: f"T-{uuid.uuid4().hex[:16]}-{index}" for index, key in enumerate(("t1", "t2"))}}


class FingerprintTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def fingerprint(self, name: str, **options) -> dict:
        write_reports(self.root / name, options.pop("ids", None) or fresh_ids(), **options)
        return report_fingerprint(self.root / name)

    def test_fresh_random_ids_and_row_order_give_the_same_fingerprint(self):
        first, second = self.fingerprint("a"), self.fingerprint("b", swap=True)
        self.assertEqual(first, second)
        self.assertEqual({name: value["rows"] for name, value in first.items()},
                         {"orders": 2, "fills": 2, "positions": 1, "account": 1, "returns_series": 1,
                          "order_events": 4, "exposures": 1})
        self.assertIn("file_sha256", first["account"])

    def test_a_changed_fill_names_its_table_and_day(self):
        ids = fresh_ids()
        first, changed = self.fingerprint("a", ids=ids), self.fingerprint("b", ids=ids, last_px="0.98881")
        differing = sorted(name for name in first if first[name] != changed[name])
        self.assertEqual(differing, ["fills"])
        days = first["fills"]["by_utc_day"]
        self.assertEqual([day for day in days if days[day] != changed["fills"]["by_utc_day"][day]], ["2025-01-08"])

    def test_a_broken_link_between_fill_and_position_changes_the_fingerprint(self):
        ids = fresh_ids()
        linked = self.fingerprint("a", ids=ids)
        write_reports(self.root / "b", ids)
        positions = (self.root / "b" / "positions.csv").read_text().replace(ids["f2"], str(uuid.uuid4()))
        (self.root / "b" / "positions.csv").write_text(positions)
        self.assertNotEqual(report_fingerprint(self.root / "b")["positions"], linked["positions"])


if __name__ == "__main__":
    unittest.main()
