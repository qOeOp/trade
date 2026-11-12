"""If this fails, a Live run is compared with a replay that is not its own (another source, image, contract, leverage,
starting wallet or window than the minutes its source received from the warm-up's T), its evidence pack is misread
(bars, warm-up bars, native order events, the start observation, each minute's result), its fee rates are not
named as the cause of a fee difference, or a pack without the facts a comparison needs is compared anyway."""

from __future__ import annotations

import csv
from decimal import Decimal
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from engine.live_errors import LiveRefusal
from shared.errors import Refusal
from live import compare
from replay import reconcile as shared


MINUTE = shared.MINUTE_NS
START = 1_794_355_200 * 10**9  # 2026-11-11T00:00:00Z, the warm-up's T
BTC = "BTCUSDT-PERP.BINANCE"
MINUTE_BAR = f"{BTC}-1-MINUTE-LAST-EXTERNAL"
SOURCE = b"class S:\n    WARMUP = {'1-MINUTE': 3}\n"
TERMS = {"price_increment": "0.10", "size_increment": "0.001", "min_notional": "100"}


def close_of(i: int) -> int:
    return START + (i + 1) * MINUTE - 10**6


def bar_row(i: int, kind: str = "bar", close: str = "100.0") -> dict:
    return {"kind": kind, "wall_ns": close_of(i) + 3 * 10**8, "bar_type": MINUTE_BAR, "instrument_id": BTC,
            "ts_event": close_of(i), "ts_init": close_of(i), "open": "100.0", "high": "101.0", "low": "99.0",
            "close": close, "volume": "5.000"}


def order(name: str, tag: str, side: str, at: int, qty: str = "0.002", price: str | None = "100.0",
          trigger: str | None = None, kind: str = "LIMIT") -> dict:
    return {"type": "OrderInitialized", "client_order_id": name, "instrument_id": BTC, "order_side": side,
            "order_type": kind, "quantity": qty, "price": price, "trigger_price": trigger, "tags": [tag],
            "reduce_only": tag != "ENTRY", "ts_init": at, "ts_event": at}


def fill(name: str, at: int, px: str, side: str, position: str, commission: str, qty: str = "0.002") -> dict:
    return {"type": "OrderFilled", "client_order_id": name, "instrument_id": BTC, "order_side": side, "last_px": px,
            "last_qty": qty, "commission": f"{commission} USDT", "position_id": position, "ts_event": at}


def trade(prefix: str, position: str, entry_commission: str, at: int = 3) -> list[dict]:
    """A limit entry at the close of minute `at`, its stop, and a target that fills five minutes later."""
    return [order(f"{prefix}-E", "ENTRY", "BUY", close_of(at)),
            fill(f"{prefix}-E", close_of(at), "100.0", "BUY", position, entry_commission),
            order(f"{prefix}-S", "STOP_LOSS", "SELL", close_of(at), price=None, trigger="95.0", kind="STOP_MARKET"),
            order(f"{prefix}-T", "TAKE_PROFIT", "SELL", close_of(at), price="101.0"),
            fill(f"{prefix}-T", close_of(at + 5), "101.0", "SELL", position, entry_commission)]


class Pack:
    """A Live run's private directory as prepare, the runner and its evidence pack leave it."""

    def __init__(self, root: Path, *, minutes: int = 12, maker: str = "0.0002", source: bytes = SOURCE,
                 reports: bool = True, warmed: bool = True):
        self.root, self.run_id = root, "trial-1"
        directory = root / "runs" / self.run_id
        (directory / "inputs").mkdir(parents=True)
        evidence = directory / "out" / "evidence"
        evidence.mkdir(parents=True)
        manifest = {"run_id": self.run_id, "candidate": {"strategy_id": "s", "revision": 1},
                    "source": {"source_sha256": hashlib.sha256(SOURCE).hexdigest(), "entry_class": "S"},
                    "runtime": {"image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "e" * 64},
                    "symbols": ["BTCUSDT"], "config": {"leverage": "5"},
                    "market": {"market_day": "2026-11-10", "terms": {"BTCUSDT": TERMS}}}
        (directory / "inputs" / "manifest.json").write_text(json.dumps(manifest))
        (directory / "inputs" / "strategy.py").write_bytes(source)
        account = {"observed_ns": START - 10**9, "account": {"assets": [{"asset": "USDT", "walletBalance": "57.50000000"}]},
                   "symbols": {"BTCUSDT": {"commission": {"makerCommissionRate": maker, "takerCommissionRate": "0.0005"}}}}
        (directory / "out" / "connected-account-1.json").write_text(json.dumps(account))
        commission = str(round(0.2 * float(maker), 8))  # 0.002 BTC at 100: 0.2 USDT notional
        self.orders = trade("L", "P-1", commission)
        events = [{"event": "started", "observation": "connected-account-1.json", "observed_ns": START - 10**9},
                  *([{"event": "warmup", "at_ns": START, "fetched_ns": START + 10**9, "bars": {"1-MINUTE": 3}}]
                    if warmed else []),
                  {"event": "position", "observed_ns": close_of(3) + 10**8,
                   "native": {"type": "PositionOpened", "instrument_id": BTC, "position_id": "P-1", "side": "LONG",
                              "quantity": "0.002", "signed_qty": 0.002}},
                  {"event": "position", "observed_ns": close_of(8) + 10**8,
                   "native": {"type": "PositionClosed", "instrument_id": BTC, "position_id": "P-1", "side": "FLAT",
                              "quantity": "0", "signed_qty": 0.0}},
                  *({"event": "order", "native": event} for event in self.orders),
                  *({"event": "minute_result", "minute_ns": START + i * MINUTE, "result": "0"} for i in range(minutes))]
        (directory / "out" / "events.jsonl").write_text("".join(json.dumps(row) + "\n" for row in events) + '{"torn')
        market = [*(bar_row(i, "historical_bar") for i in (-3, -2, -1)), *(bar_row(i) for i in range(minutes)),
                  {**bar_row(0), "bar_type": f"{BTC}-1-HOUR-LAST-INTERNAL@1-MINUTE-EXTERNAL", "close": "7"}]
        (evidence / "market.jsonl").write_text("".join(json.dumps(row) + "\n" for row in market))
        if reports:
            for name, written in (("reports-5", self.orders[:2]), ("reports-9", self.orders)):
                (evidence / name).mkdir()
                with gzip.open(evidence / name / "order_events.jsonl.gz", "wt") as stream:
                    stream.writelines(json.dumps(event) + "\n" for event in written)
        self.minutes = minutes


def archived(first: int, minutes: int) -> list[list]:
    return [[(close_of(i) + 10**6 - MINUTE) // 10**6, (close_of(i)) // 10**6, "100.0", "101.0", "99.0", "100.0", "5.000"]
            for i in range(first, first + minutes)]


class Compare(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def compared(self, pack: Pack, replay_events: list[dict] | None = None) -> tuple[dict, dict]:
        """(the arguments the replay ran with, reconcile.json)."""
        given: dict = {}

        def replayed(market, market_day, source, entry_class, image_ref, symbols, start, end, leverage, balance,
                     output, name, timeout):
            given.update(source=source, entry_class=entry_class, image_ref=image_ref, symbols=symbols, start=start,
                         end=end, leverage=leverage, balance=balance)
            reports = Path(output) / "reports"
            reports.mkdir(parents=True)
            with (reports / "account.csv").open("w", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["ts_event", "total"])
                writer.writerow(["2026-11-11 00:00:00+00:00", balance])
            # The replay's fees at the market's assumed maker rate, 0.0002 of 0.2 USDT.
            events = trade("R", "R-1", "0.00004") if replay_events is None else replay_events
            return {"status": "passed", "problems": [], "path": str(output)}, events, reports

        def stored(market, day, symbol, price_type, interval, start, end, limit, funding=True):
            first = (int(shared.datetime.fromisoformat(start.replace("Z", "+00:00")).timestamp()) * 10**9 - START) // MINUTE
            last = (int(shared.datetime.fromisoformat(end.replace("Z", "+00:00")).timestamp()) * 10**9 - START) // MINUTE
            return {"market_day": "2026-11-11", "bars": {"rows": archived(first, last - first)}}

        with mock.patch.object(shared, "replay", side_effect=replayed), \
                mock.patch("market.read.stored_bars", side_effect=stored), \
                mock.patch("market.files.open_market"), \
                mock.patch("market.instrument.terms", return_value=TERMS), \
                mock.patch.object(compare.records, "published_settlements", return_value={}):
            found = compare.compare(self.root, pack.run_id, {}, None, self.root / "out")
        return given, json.loads(Path(found["path"]).read_text())

    def test_the_replay_is_the_runs_own_from_its_warm_up_to_its_last_minute(self):
        pack = Pack(self.root)
        given, result = self.compared(pack)
        self.assertEqual(given, {"source": SOURCE, "entry_class": "S", "image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "e" * 64,
                                 "symbols": ["BTCUSDT"], "start": START, "end": close_of(pack.minutes - 1) + 10**6,
                                 "leverage": "5", "balance": "57.5"})
        self.assertEqual((result["kind"], result["starting_balance_usdt"]), ("live", "57.5"))

    def test_the_entries_the_gate_changed_are_read_from_the_journal(self):
        events = [{"event": "entry_released", "client_order_id": "O-1"},
                  {"event": "entry_cancel_requested", "client_order_id": "O-2", "reason": "disconnected"},
                  {"event": "entry_cancel_requested", "client_order_id": "O-3", "reason": "stop"},
                  {"event": "entry_refused", "client_order_id": "O-4", "ts_init": 5, "held_ns": 1},
                  {"event": "entry_refused", "client_order_id": "O-5", "ts_init": 6, "held_ns": None}]
        self.assertEqual(compare.gate(events), {"released": ["O-1"], "withdrawn": ["O-2"], "refused": [5]})

    def test_a_pack_that_agrees_with_its_replay_is_the_same_from_bars_to_equity(self):
        _, result = self.compared(Pack(self.root))
        summary = result["summary"]
        self.assertEqual({key: summary[key] for key in ("groups", "same", "missing_bars", "late_bars", "differing_bars",
                                                        "warmup_differs", "terms_differ", "look_ahead_suspects")},
                         {"groups": 1, "same": 1, "missing_bars": 0, "late_bars": 0, "differing_bars": 0,
                          "warmup_differs": 0, "terms_differ": 0, "look_ahead_suspects": 0})
        self.assertEqual(result["inputs"]["BTCUSDT"]["bars"]["live"], 12)  # the hourly aggregation is no minute
        self.assertTrue(result["inputs"]["BTCUSDT"]["warmup"]["same"])
        [group] = result["groups"]
        self.assertEqual([row["role"] for row in group["orders"]], ["entry", "stop", "target"])
        self.assertEqual(result["equity"]["run"][0], [START, "57.5"])
        self.assertEqual(Decimal(summary["equity_max_difference"]), 0)

    def test_the_accounts_fee_rates_explain_a_fee_difference(self):
        _, result = self.compared(Pack(self.root, maker="0.00018"))
        [group] = result["groups"]
        self.assertEqual((group["stage"], group["cause"], group["look_ahead_suspect"]), ("fee", "contract_terms", False))
        self.assertEqual(group["evidence"]["terms"], ["maker: run 0.00018, replay 0.0002"])

    def test_the_newest_reports_hold_the_runs_orders_and_without_any_the_journal_does(self):
        _, result = self.compared(Pack(self.root))
        self.assertEqual(result["summary"]["run_orders"], 3)
        other = self.root / "other"
        pack = Pack(other, reports=False)
        self.assertEqual(len(compare.read_pack(other / "runs" / pack.run_id)["orders"]), len(pack.orders))

    def test_a_pack_whose_source_changed_or_that_never_warmed_is_refused(self):
        for given, code in (({"source": b"changed"}, "LIVE_IDENTITY_CHANGED"), ({"warmed": False}, "LIVE_COMPARE_EMPTY")):
            with self.subTest(code), tempfile.TemporaryDirectory() as name:
                Pack(Path(name), **given)
                with self.assertRaises((LiveRefusal, Refusal)) as caught:
                    compare.compare(Path(name), "trial-1", {}, None, Path(name) / "out")
                self.assertEqual(caught.exception.code, code)


if __name__ == "__main__":
    unittest.main()
