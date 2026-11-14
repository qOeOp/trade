"""If this fails, a paper reconciliation misreports a run: a trade the replay also made shows as a difference, a
replay-only entry with no live-data cause is not flagged as a look-ahead suspect, a live gap or a live bar that
differs from the archive is not named as the cause, the journal's warm-up is not the run's, the replay is not the
run's own (interval, warm-up start, leverage, starting balance), or the replay's equity is read at another moment
than the paper snapshot it is set against. The comparison itself is replay.reconcile's (tests/replay)."""

from __future__ import annotations

import csv
import gzip
from pathlib import Path
import tempfile
import unittest

from shared.errors import Refusal
from paper import reconcile
from replay import reconcile as shared


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
    def test_the_same_trade_a_bar_later_on_live_data_is_the_same(self):
        paper = [initialized("P1", "ENTRY"), filled("P1", close_of(2) + 25 * 10**6, "100.0", "1")]
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(2), "100.0", "1")]
        found = reconcile.compare(journal(paper, 5), replay, {"BTCUSDT": archived(5)}, None, START, START + 5 * MINUTE)
        self.assertEqual(found["summary"]["same"], 1)
        self.assertEqual(found["groups"][0]["orders"][0]["delay_ms"], 25)
        self.assertNotIn("cause", found["groups"][0])

    def test_a_replay_only_entry_without_a_live_cause_is_a_look_ahead_suspect(self):
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(2), "100.0", "1")]
        found = reconcile.compare(journal([], 5), replay, {"BTCUSDT": archived(5)}, None, START, START + 5 * MINUTE)
        group = found["groups"][0]
        self.assertEqual((group["class"], group["cause"], group["look_ahead_suspect"]), ("replay_only", "unexplained", True))
        self.assertEqual(found["summary"]["look_ahead_suspects"], 1)

    def test_a_missing_live_bar_before_a_difference_is_its_cause(self):
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(3), "100.0", "1")]
        found = reconcile.compare(journal([], 5, skip=(2,)), replay, {"BTCUSDT": archived(5)}, None, START,
                                  START + 5 * MINUTE)
        group = found["groups"][0]
        self.assertEqual((group["cause"], group["look_ahead_suspect"]), ("missing_bar", False))
        self.assertEqual(found["summary"]["missing_bars"], 1)

    def test_a_live_bar_unlike_the_archive_explains_a_price_difference(self):
        paper = [initialized("P1", "ENTRY"), filled("P1", close_of(2), "100.5", "1")]
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(2), "100.0", "1")]
        found = reconcile.compare(journal(paper, 5, closes={2: "100.5"}), replay, {"BTCUSDT": archived(5)}, None,
                                  START, START + 5 * MINUTE)
        group = found["groups"][0]
        self.assertEqual((group["stage"], group["orders"][0]["class"], group["cause"]), ("fill", "price", "bar_mismatch"))
        self.assertEqual(found["inputs"]["BTCUSDT"]["bars"]["differing"][0]["fields"], {"close": ["100.5", "100.0"]})

    def test_the_journals_warm_up_is_the_runs(self):
        lines = journal([], 2) + [{"kind": "warmup", "instrument_id": BTC, "period": "1-HOUR", "fetched_ns": 1,
                                   "bars": 4, "first_ts_event": 1, "last_ts_event": 2, "sha256": "h"}]
        self.assertEqual(reconcile.run_record(lines, [])["warmup"],
                         {BTC: {"1-HOUR": {"bars": 4, "first_ts_event": 1, "last_ts_event": 2, "sha256": "h"}}})

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
            found = shared.replay_equity(reports, [START, START + MINUTE])
        self.assertEqual(found, [[START, "100000.00"], [START + MINUTE, "100001.50"]])


class InputTests(unittest.TestCase):
    """The replay is the run's own: its leverage; and what the replay did not write is not read as none."""

    def reconciled(self, events_written: bool) -> tuple[list[str], dict]:
        import json
        from unittest import mock
        from replay import entry

        row = {"config": {"candidate": "example@1", "leverage": "5", "fees": {}}, "symbols": ["BTCUSDT"], "market_day": "2026-10-25",
               "source_sha256": "s" * 64, "image_ref": "image"}
        lines = journal([initialized("P-1", "ENTRY"), filled("P-1", START + 30 * 10**9, "100.0", "1")], 3)
        lines += [{"kind": "warmup", "instrument_id": BTC, "period": period, "bars": count, "sha256": "h"}
                  for period, count in (("1-MINUTE", 5), ("1-HOUR", 2), ("1-DAY", 3))]
        argv: list[str] = []

        def replayed(market, commit, source, entry_class, image, given, output, name, timeout):
            argv.extend(given)
            reports = Path(output) / entry.REPORTS
            reports.mkdir(parents=True)
            if events_written:
                with gzip.open(reports / "order_events.jsonl.gz", "wt") as stream:
                    for event in (initialized("R-1", "ENTRY"), filled("R-1", START + 30 * 10**9, "100.0", "1")):
                        stream.write(json.dumps(event) + "\n")
            return {"path": str(output), "status": "passed", "problems": []}

        with tempfile.TemporaryDirectory() as name, \
                mock.patch.object(reconcile.db, "connect"), \
                mock.patch.object(reconcile.records, "read_paper_run", return_value=row), \
                mock.patch.object(reconcile.records, "seal_of", return_value={}), \
                mock.patch.object(reconcile.records, "read_source", return_value={"source": b"", "entry_class": "E"}), \
                mock.patch.object(reconcile, "_journal", return_value=lines), \
                mock.patch.object(reconcile, "window", return_value=(START, START + 3 * MINUTE)), \
                mock.patch.object(reconcile, "_archive", return_value=("c" * 32, {"BTCUSDT": archived(3)})), \
                mock.patch.object(reconcile, "_context", return_value=({}, {})), \
                mock.patch.object(reconcile.records, "published_settlements", return_value={}), \
                mock.patch.object(entry, "replay_unrecorded", side_effect=replayed), \
                mock.patch("paper.runs.ledger_key", return_value="k"):
            found = reconcile.reconcile(object(), {}, None, 7, Path(name) / "out")
            result = json.loads(Path(found["path"]).read_text(encoding="utf-8"))
        return argv, result

    def test_the_replay_runs_at_the_runs_leverage_balance_and_start_on_the_history_it_received(self):
        argv, result = self.reconciled(True)
        self.assertEqual(argv[argv.index("--leverage") + 1], "5")
        self.assertEqual(argv[argv.index("--starting-balance") + 1], reconcile.ACCOUNT_CONTRACT["starting_balance_usdt"])
        self.assertEqual(argv[argv.index("--trade-start") + 1], "2026-10-25T17:26:00Z")
        # The replay builds a history only from its window's minutes: the two hours before 17:00 open at 15:00 (and
        # the five minutes before 17:26 lie inside them); daily bars come from the market's own.
        self.assertEqual(argv[argv.index("--start") + 1], "2026-10-25T15:00:00Z")
        self.assertEqual((result["summary"]["same"], len(result["groups"])), (1, 1))

    def test_a_replay_without_order_events_has_no_order_comparison(self):
        _, result = self.reconciled(False)
        self.assertIsNone(result["groups"])
        self.assertEqual({key: result["summary"][key] for key in ("run_fills", "replay_fills", "same", "run_only")},
                         {"run_fills": 1, "replay_fills": None, "same": None, "run_only": None})

    def test_each_contract_counts_every_bar_its_list_leaves_out(self):
        minutes = shared.LISTED + 10
        found = reconcile.compare(journal([], minutes, skip=tuple(range(minutes))), [],
                                  {"BTCUSDT": archived(minutes, {0: "99.0"})}, None, START, START + minutes * MINUTE)
        listed = found["inputs"]["BTCUSDT"]["bars"]
        self.assertEqual((len(listed["missing"]), listed["missing_bars"]), (shared.LISTED, minutes))
        self.assertEqual(listed["differing_bars"], 0)

    def test_the_archive_reads_the_bars_alone(self):
        """CF-24: the reconciliation compares bars; it does not read the funding settlements beside them."""
        from unittest import mock
        from market import read
        rows = archived(3)
        with mock.patch.object(read, "stored_bars", return_value={"market_day": "c" * 32, "bars": {"rows": rows}}) as stored:
            commit, found = reconcile._archive({}, None, ["BTCUSDT"], START, START + 3 * MINUTE)
        self.assertEqual((commit, found), ("c" * 32, {"BTCUSDT": rows}))
        self.assertIs(stored.call_args.kwargs.get("funding"), False)


class ExportTests(unittest.TestCase):
    def test_a_reconciliations_market_export_is_fresh_so_it_goes_with_the_replay(self):
        # On the Paper host the temporary directory is a host directory: a reused export there is never evicted.
        from unittest import mock
        from replay import entry

        exported = {"root": "/tmp/export", "fresh": True}
        with tempfile.TemporaryDirectory() as name, \
                mock.patch.object(entry, "_export", return_value=({}, exported)) as export, \
                mock.patch.object(entry.registration_seams, "current",
                                  mock.Mock(resolve_runtime=mock.Mock(return_value={"runtime_contract": "c"}),
                                            inspect_runtime=mock.Mock(side_effect=RuntimeError("stop")))), \
                mock.patch.object(entry.registration_inputs, "cleanup") as cleanup:
            with self.assertRaises(RuntimeError):
                entry.replay_unrecorded({}, "c" * 40, b"", "S", "image", [], Path(name) / "out", "name")
        self.assertIs(export.call_args.args[3], True)
        cleanup.assert_called_once_with(exported)
