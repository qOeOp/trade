"""The semantic fingerprint is equal for two replays of one run (fresh UUIDs, other row order) and names the
table and day that differ."""

import csv
import gzip
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from engine.compare import report_fingerprint


DAY1, DAY2 = 1736294400000000000, 1736380800000000000


def write_reports(root: Path, ids: dict, swap: bool = False, last_px: str = "0.98880",
                  fill_time: str = "2025-01-08 00:00:00+00:00") -> None:
    """A two-order run whose random IDs come from `ids`; `swap` reverses the file order of rows."""
    root.mkdir(parents=True)
    fills = [{"client_order_id": "O-1", "trade_id": ids["t1"], "event_id": ids["f1"], "last_qty": "5",
              "last_px": last_px, "ts_event": fill_time, "position_id": "P"},
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
    with (root / "exposures.csv.gz").open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as stream:
            stream.write(("ts_event_ns,position_id,notional_value,unrealized_pnl\n"
                          f"{DAY1 - 10**6},P,5 USDT,0 USDT\n").encode())
    by_order = {"O-1": events[:2], "O-2": events[2:]}
    with gzip.open(root / "order_events.jsonl.gz", "wt") as stream:
        for identity in order(["O-1", "O-2"]):
            for event in by_order[identity]:
                stream.write(json.dumps(event, sort_keys=True) + "\n")



def write_liquidation_reports(root: Path, ids: dict) -> None:
    """A run with two liquidation orders whose client order IDs carry fresh UUIDs (``LIQUIDATION-<venue>-<uuid>``),
    one per day."""
    root.mkdir(parents=True)
    orders = [(f"LIQUIDATION-SIM-{ids['la']}", DAY1, "0.98880", ids["i1"], ids["f1"]),
              (f"LIQUIDATION-SIM-{ids['lb']}", DAY2, "1.01000", ids["i2"], ids["f2"])]
    rows = {"orders": [], "fills": [], "events": []}
    for identity, moment, price, init_id, fill_id in orders:
        rows["orders"].append({"client_order_id": identity, "init_id": init_id, "ts_init": str(moment)})
        rows["fills"].append({"client_order_id": identity, "trade_id": TRADES["t1"] if moment == DAY1 else TRADES["t2"],
                              "event_id": fill_id, "last_px": price, "ts_event": str(moment), "position_id": "P"})
        rows["events"] += [{"type": "OrderInitialized", "client_order_id": identity, "event_id": init_id,
                            "instrument_id": "X.SIM", "ts_event": moment},
                           {"type": "OrderFilled", "client_order_id": identity, "event_id": fill_id, "instrument_id": "X.SIM",
                            "ts_event": moment}]
    positions = [{"position_id": "P", "ts_opened": str(DAY1), "events": str([{"event_id": ids["f1"]}, {"event_id": ids["f2"]}]),
                  "adjustments": "[]"}]
    for name, table in (("orders", rows["orders"]), ("fills", rows["fills"]), ("positions", positions)):
        with (root / f"{name}.csv").open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(table[0]))
            writer.writeheader()
            writer.writerows(table)
    (root / "account.csv").write_text("ts_event,total\n2025-01-08 00:00:00+00:00,100000\n")
    (root / "returns_series.csv").write_text(f"ts_event_ns,native_return\n{DAY1},0.0\n")
    with (root / "exposures.csv.gz").open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as stream:
            stream.write(f"ts_event_ns,position_id,notional_value,unrealized_pnl\n{DAY1 - 10**6},P,5 USDT,0 USDT\n".encode())
    with gzip.open(root / "order_events.jsonl.gz", "wt") as stream:
        for event in rows["events"]:
            stream.write(json.dumps(event, sort_keys=True) + "\n")

TRADES = {"t1": "T-1fd6a51d60d74306-6871", "t2": "T-e8a18c9380fc3dfc-8188"}  # derived, not random


def fresh_ids() -> dict:
    return {**{key: str(uuid.uuid4()) for key in ("f1", "f2", "i1", "i2", "s1", "a1")}, **TRADES}


class FingerprintTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def fingerprint(self, name: str, **options) -> dict:
        write_reports(self.root / name, options.pop("ids", None) or fresh_ids(), **options)
        return report_fingerprint(self.root / name)

    def test_fresh_uuids_and_row_order_give_the_same_fingerprint(self):
        with patch("gzip.time.time", return_value=1_792_570_000):
            first = self.fingerprint("a")
        with patch("gzip.time.time", return_value=1_792_570_001):
            second = self.fingerprint("b", swap=True)
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

    def test_exchanged_trade_ids_change_the_fingerprint(self):
        ids = fresh_ids()
        swapped = self.fingerprint("b", ids={**ids, "t1": TRADES["t2"], "t2": TRADES["t1"]})
        self.assertNotEqual(self.fingerprint("a", ids=ids)["fills"], swapped["fills"])

    def test_liquidation_orders_with_fresh_client_ids_give_the_same_fingerprint(self):
        """Two runs draw the random part of ``LIQUIDATION-<venue>-<uuid>`` so that the IDs sort in opposite
        orders; the walk follows the liquidations' times, so the fingerprints are equal."""
        base = {key: str(uuid.uuid4()) for key in ("i1", "i2", "f1", "f2")}
        write_liquidation_reports(self.root / "a", {**base, "la": "0" * 8 + "-0000-4000-8000-" + "0" * 12,
                                                     "lb": "f" * 8 + "-ffff-4fff-bfff-" + "f" * 12})
        write_liquidation_reports(self.root / "b", {**{key: str(uuid.uuid4()) for key in base},
                                                     "la": "f" * 8 + "-ffff-4fff-bfff-" + "f" * 12,
                                                     "lb": "0" * 8 + "-0000-4000-8000-" + "0" * 12})
        self.assertEqual(report_fingerprint(self.root / "a"), report_fingerprint(self.root / "b"))

    def test_uuid_orders_submitted_at_one_time_give_the_same_fingerprint(self):
        """A source with UUID client order IDs submits its stop and its target at one fill: the two orders share
        their first event's time and instrument, and the report lists them by their random IDs. Two runs whose
        IDs sort in opposite orders give equal fingerprints."""
        low, high = "0" * 8 + "-0000-4000-8000-" + "0" * 12, "f" * 8 + "-ffff-4fff-bfff-" + "f" * 12
        for name, stop, target in (("a", low, high), ("b", high, low)):
            root = self.root / name
            root.mkdir()
            ids = {key: str(uuid.uuid4()) for key in ("si", "ti", "sa", "ta", "sc")}
            events = sorted([
                {"type": "OrderInitialized", "client_order_id": stop, "event_id": ids["si"], "instrument_id": "X.SIM",
                 "ts_event": DAY1, "order_type": "STOP_MARKET", "trigger_price": "0.95"},
                {"type": "OrderAccepted", "client_order_id": stop, "event_id": ids["sa"], "instrument_id": "X.SIM",
                 "ts_event": DAY1 + 1},
                {"type": "OrderCanceled", "client_order_id": stop, "event_id": ids["sc"], "instrument_id": "X.SIM",
                 "ts_event": DAY2},
                {"type": "OrderInitialized", "client_order_id": target, "event_id": ids["ti"], "instrument_id": "X.SIM",
                 "ts_event": DAY1, "order_type": "LIMIT", "price": "1.05"},
                {"type": "OrderAccepted", "client_order_id": target, "event_id": ids["ta"], "instrument_id": "X.SIM",
                 "ts_event": DAY1 + 1}], key=lambda event: event["client_order_id"])
            with gzip.open(root / "order_events.jsonl.gz", "wt") as stream:
                for event in events:
                    stream.write(json.dumps(event, sort_keys=True) + "\n")
            orders = sorted([{"client_order_id": stop, "init_id": ids["si"], "order_type": "STOP_MARKET",
                              "ts_init": str(DAY1)},
                             {"client_order_id": target, "init_id": ids["ti"], "order_type": "LIMIT",
                              "ts_init": str(DAY1)}], key=lambda row: row["client_order_id"])
            with (root / "orders.csv").open("w", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(orders[0]))
                writer.writeheader()
                writer.writerows(orders)
            (root / "fills.csv").write_text("client_order_id,ts_event\n")
            (root / "positions.csv").write_text("position_id,ts_opened\n")
            (root / "account.csv").write_text("ts_event,total\n2025-01-08 00:00:00+00:00,100000\n")
            (root / "returns_series.csv").write_text(f"ts_event_ns,native_return\n{DAY1},0.0\n")
            with (root / "exposures.csv.gz").open("wb") as raw:
                with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as stream:
                    stream.write(b"ts_event_ns,position_id,notional_value,unrealized_pnl\n")
        self.assertEqual(report_fingerprint(self.root / "a"), report_fingerprint(self.root / "b"))

    def test_a_time_without_utc_offset_is_refused(self):
        with self.assertRaisesRegex(ValueError, "no UTC offset"):
            self.fingerprint("a", fill_time="2025-01-08 00:00:00")


if __name__ == "__main__":
    unittest.main()
