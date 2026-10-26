"""If this fails, a paper reconciliation misreports a run: a market order filled in pieces counts as several
trades or at the wrong price, a fill the replay also made shows as a difference, a replay-only fill with no
live-data cause is not flagged as a look-ahead suspect, a live gap or a live bar that differs from the archive
is not named as the cause, a difference that follows from an earlier one on the same contract is taken for a
cause of its own, the replay interval is not the one the runner received bars for, or the replay's
equity is read at another moment than the paper snapshot it is set against."""

from __future__ import annotations

import csv
import gzip
from pathlib import Path
import tempfile
import unittest

from ledger.errors import Refusal
from paper import reconcile


MINUTE = reconcile.MINUTE_NS
START = 1_792_949_160 * 10**9  # 2026-10-25T17:26:00Z
BTC = "BTCUSDT-PERP.BINANCE"


def initialized(order: str, tag: str, side: str = "BUY") -> dict:
    return {"type": "OrderInitialized", "client_order_id": order, "instrument_id": BTC, "order_side": side,
            "tags": [tag], "ts_event": START}


def filled(order: str, ts: int, px: str, qty: str, side: str = "BUY") -> dict:
    return {"type": "OrderFilled", "client_order_id": order, "instrument_id": BTC, "order_side": side,
            "last_px": px, "last_qty": qty, "commission": "0.10 USDT", "ts_event": ts}


def bar(close_ns: int, close: str = "100.0") -> dict:
    return {"kind": "bar", "instrument_id": BTC, "ts_event": close_ns, "wall_ns": close_ns + 10**7, "open": "100.0",
            "high": "101.0", "low": "99.0", "close": close, "volume": "5"}


def archived(minutes: int, closes: dict[int, str] | None = None) -> list[list]:
    """Archive rows [open ms, close ms, o, h, l, c, v] of `minutes` minutes from START."""
    return [[START // 10**6 + i * 60_000, START // 10**6 + i * 60_000 + 59_999, "100.0", "101.0", "99.0",
             (closes or {}).get(i, "100.0"), "5"] for i in range(minutes)]


def close_of(i: int) -> int:
    return START + (i + 1) * MINUTE - 10**6


def journal(events: list[dict], minutes: int, skip: tuple[int, ...] = (), closes: dict[int, str] | None = None) -> list[dict]:
    lines = [{"kind": "started", "input_start_ns": START, "wall_ns": START - 10**9}]
    lines += [bar(close_of(i), (closes or {}).get(i, "100.0")) for i in range(minutes) if i not in skip]
    return lines + [{"kind": "order", "wall_ns": event["ts_event"], **event} for event in events]


class Reconcile(unittest.TestCase):
    def test_an_order_filled_in_pieces_is_one_fill_at_its_weighted_price(self):
        found = reconcile.orders([initialized("A", "ENTRY"), filled("A", close_of(2), "100.0", "1"),
                                  filled("A", close_of(2), "100.4", "3")])
        self.assertEqual(len(found), 1)
        self.assertEqual((found[0]["qty"], found[0]["px"], found[0]["role"]), (4, reconcile.Decimal("100.3"), "entry"))
        self.assertEqual(found[0]["commission"], reconcile.Decimal("0.20"))

    def test_the_same_trade_a_bar_later_on_live_data_is_the_same(self):
        paper = [initialized("P1", "ENTRY"), filled("P1", close_of(2) + 25 * 10**6, "100.0", "1")]
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(2), "100.0", "1")]
        found = reconcile.compare(journal(paper, 5), replay, {"BTCUSDT": archived(5)}, None, START, START + 5 * MINUTE)
        self.assertEqual(found["summary"]["same"], 1)
        self.assertEqual(found["fills"][0]["delay_ms"], 25)
        self.assertNotIn("cause", found["fills"][0])

    def test_a_replay_only_fill_without_a_live_cause_is_a_look_ahead_suspect(self):
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(2), "100.0", "1")]
        found = reconcile.compare(journal([], 5), replay, {"BTCUSDT": archived(5)}, None, START, START + 5 * MINUTE)
        item = found["fills"][0]
        self.assertEqual((item["class"], item["cause"], item["look_ahead_suspect"]), ("replay_only", "unexplained", True))
        self.assertEqual(found["summary"]["look_ahead_suspects"], 1)

    def test_differences_after_the_paths_part_follow_the_first_until_a_fill_agrees_again(self):
        paper = [initialized("P1", "ENTRY"), filled("P1", close_of(5), "100.0", "1"),
                 initialized("P2", "TAKE_PROFIT", "SELL"), filled("P2", close_of(7), "101.0", "1", "SELL")]
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(2), "100.0", "1"),
                  initialized("R2", "STOP_LOSS", "SELL"), filled("R2", close_of(4), "99.0", "1", "SELL"),
                  initialized("R3", "TAKE_PROFIT", "SELL"), filled("R3", close_of(7), "101.0", "1", "SELL"),
                  initialized("R4", "ENTRY"), filled("R4", close_of(9), "100.0", "1")]
        found = reconcile.compare(journal(paper, 12), replay, {"BTCUSDT": archived(12)}, None, START,
                                  START + 12 * MINUTE)
        self.assertEqual([(item["class"], item.get("cause"), item.get("follows"), item.get("look_ahead_suspect"))
                          for item in found["fills"]],
                         [("time", "unexplained", None, False),
                          ("replay_only", "consequence", reconcile._utc(close_of(2)), False),
                          ("same", None, None, None),
                          ("replay_only", "unexplained", None, True)])
        self.assertEqual(found["summary"]["look_ahead_suspects"], 1)

    def test_a_missing_live_bar_before_a_difference_is_its_cause(self):
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(3), "100.0", "1")]
        found = reconcile.compare(journal([], 5, skip=(2,)), replay, {"BTCUSDT": archived(5)}, None, START,
                                  START + 5 * MINUTE)
        item = found["fills"][0]
        self.assertEqual((item["cause"], item["look_ahead_suspect"]), ("live_gap", False))
        self.assertEqual(found["summary"]["missing_bars"], 1)

    def test_a_live_bar_unlike_the_archive_explains_a_price_difference(self):
        paper = [initialized("P1", "ENTRY"), filled("P1", close_of(2), "100.5", "1")]
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(2), "100.0", "1")]
        found = reconcile.compare(journal(paper, 5, closes={2: "100.5"}), replay, {"BTCUSDT": archived(5)}, None,
                                  START, START + 5 * MINUTE)
        item = found["fills"][0]
        self.assertEqual((item["class"], item["cause"]), ("price", "bar_mismatch"))
        self.assertEqual(found["bars"]["BTCUSDT"]["differing"][0]["fields"], {"close": ["100.5", "100.0"]})

    def test_fills_of_another_role_or_too_far_apart_do_not_pair(self):
        paper = [initialized("P1", "STOP_LOSS", "SELL"), filled("P1", close_of(1), "99.0", "1", "SELL")]
        replay = [initialized("R1", "TAKE_PROFIT", "SELL"), filled("R1", close_of(1), "101.0", "1", "SELL"),
                  initialized("R2", "STOP_LOSS", "SELL"), filled("R2", close_of(1) + reconcile.PAIR_NS + MINUTE, "99.0", "1", "SELL")]
        pairs = reconcile.pair(reconcile.orders(paper), reconcile.orders(replay))
        self.assertEqual([(a and a["order"], b and b["order"]) for a, b in pairs], [("P1", None), (None, "R1"), (None, "R2")])

    def test_the_interval_runs_from_the_input_start_to_the_minute_the_run_stopped(self):
        lines = journal([], 0)
        self.assertEqual(reconcile.window(lines, {"stopped_ns": START + 3 * MINUTE + 17 * 10**9}),
                         (START, START + 3 * MINUTE))
        with self.assertRaises(Refusal) as caught:
            reconcile.window(lines, {"stopped_ns": START + 30 * 10**9})
        self.assertEqual(caught.exception.code, "PAPER_RECONCILE_EMPTY")

    def test_the_replay_equity_is_read_at_each_snapshot_minutes_close(self):
        with tempfile.TemporaryDirectory() as root:
            reports = Path(root)
            with (reports / "account.csv").open("w", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["ts_event", "total"])
                writer.writerow(["2026-10-25 17:26:00+00:00", "100000.00"])
                writer.writerow(["2026-10-25 17:27:59.999000+00:00", "99999.50"])
            with gzip.open(reports / "exposures.csv.gz", "wt", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["ts_event_ns", "position_id", "notional_value", "unrealized_pnl", "realized_pnl"])
                writer.writerow([close_of(1), "P", "1000 USDT", "2.25 USDT", "0 USDT"])
                writer.writerow([close_of(1), "Q", "1000 USDT", "-0.25 USDT", "0 USDT"])
            found = reconcile.replay_equity(reports, [START, START + MINUTE])
        self.assertEqual(found, [[START, "100000.00"], [START + MINUTE, "100001.50"]])


if __name__ == "__main__":
    unittest.main()
