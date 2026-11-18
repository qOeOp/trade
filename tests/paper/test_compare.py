"""If this fails, a paper comparison misreports a run: a trade the replay also made shows as a difference, a
live gap or a live bar that differs from the archive is not named as the cause, the journal's warm-up is not the
run's, the replay is not the run's own (interval, warm-up start, leverage, starting balance), or the replay's equity
is read at another moment than the paper snapshot it is set against. The comparison itself is replay.comparison's
(tests/replay)."""

from __future__ import annotations

import csv
from decimal import Decimal
import gzip
from pathlib import Path
import tempfile
import unittest

from paper import compare
from replay import comparison as shared
from tests.helpers import refused


MINUTE = shared.MINUTE_NS
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


def compared(lines: list[dict], replay: list[dict], archive: dict, end: int) -> dict:
    return shared.compare(compare.run_record(lines, []), replay, archive, None, START, end)


class Compare(unittest.TestCase):
    def test_the_same_trade_a_bar_later_on_live_data_is_the_same(self):
        paper = [initialized("P1", "ENTRY"), filled("P1", close_of(2) + 25 * 10**6, "100.0", "1")]
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(2), "100.0", "1")]
        found = compared(journal(paper, 5), replay, {"BTCUSDT": archived(5)}, START + 5 * MINUTE)
        self.assertEqual(found["summary"]["same"], 1)
        self.assertEqual(found["groups"][0]["orders"][0]["delay_ms"], 25)
        self.assertNotIn("cause", found["groups"][0])

    def test_a_journal_decision_is_stamped_by_its_ts_event_as_engine_paper_writes_it(self):
        # engine.paper journals an event's ts_event, never its ts_init; the replay's native events carry both.
        decided = close_of(2) + 25 * 10**6
        paper = [{**initialized("P1", "ENTRY"), "ts_event": decided}, filled("P1", decided, "100.0", "1")]
        replay = [{**initialized("R1", "ENTRY"), "ts_event": close_of(2), "ts_init": close_of(2)},
                  filled("R1", close_of(2), "100.0", "1")]
        found = compared(journal(paper, 5), replay, {"BTCUSDT": archived(5)}, START + 5 * MINUTE)
        self.assertEqual(found["summary"]["same"], 1)
        self.assertEqual(found["groups"][0]["orders"][0]["run"]["init_ns"], decided)

    def test_a_missing_live_bar_before_a_difference_is_its_cause(self):
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(3), "100.0", "1")]
        found = compared(journal([], 5, skip=(2,)), replay, {"BTCUSDT": archived(5)}, START + 5 * MINUTE)
        group = found["groups"][0]
        self.assertEqual((group["cause"], group["look_ahead_suspect"]), ("missing_bar", False))
        self.assertEqual(found["summary"]["missing_bars"], 1)

    def test_after_a_held_resume_a_difference_is_the_holds_not_unexplained(self):
        """A source without the recovery protocol is held after an interruption (engine.paper_session): it sends no
        entry, so an entry only the replay made after the first `resumed` is the hold's, not a look-ahead suspect;
        one before it, or a run whose source declares recovery, stays unexplained (user 2026-11-17)."""
        held = START + 2 * MINUTE
        undeclared = {"kind": "started", "recovery_declared": False}  # the runner's verdict
        declared = {"kind": "started", "recovery_declared": True}
        rest = [*journal([], 5), {"kind": "resumed", "wall_ns": held}]
        self.assertEqual(compare.held_since([undeclared, *rest]), held)
        self.assertIsNone(compare.held_since([declared, *rest]))
        self.assertIsNone(compare.held_since([undeclared, *journal([], 5)]), "never resumed")
        self.assertIsNone(compare.held_since(rest), "no `started` line, nothing taken as held")
        self.assertIsNone(compare.held_since([{"kind": "started"}, *rest]), "no verdict, nothing taken as held")
        # A source with the protocol is held from a recovery that crossed a funding settlement: the runner follows
        # `resumed` with a refusal at once and goes on; a refused recovery stops without another bar.
        fell = [declared, {"kind": "resumed", "wall_ns": held},
                {"kind": "refusal", "code": "PAPER_RECOVERY_UNAVAILABLE", "reason": "funding"}]
        bar = {"kind": "bar", "instrument_id": "BTCUSDT-PERP.BINANCE", "ts_event": close_of(4)}
        self.assertEqual(compare.held_since(fell + [bar]), held)
        self.assertIsNone(compare.held_since(fell), "refused and stopped")
        self.assertIsNone(compare.held_since(fell + [{"kind": "resumed", "wall_ns": held + 1}, bar]))
        self.assertIsNone(compare.held_since([declared, fell[1], bar, fell[2], bar]), "a refusal that came later")
        for at, since, cause in ((close_of(3), held, "held"), (close_of(1), held, "unexplained"),
                                 (close_of(3), None, "unexplained")):
            with self.subTest(at=at, since=since):
                replay = [initialized("R1", "ENTRY"), {**filled("R1", at, "100.0", "1")}]
                replay[0]["ts_event"] = at
                found = shared.compare(compare.run_record([undeclared, *rest], [], held=since), replay, {"BTCUSDT": archived(5)},
                                       None, START, START + 5 * MINUTE)
                group = found["groups"][0]
                self.assertEqual((group["cause"], group["look_ahead_suspect"]), (cause, cause == "unexplained"))

    def test_a_live_bar_unlike_the_archive_explains_a_price_difference(self):
        paper = [initialized("P1", "ENTRY"), filled("P1", close_of(2), "100.5", "1")]
        replay = [initialized("R1", "ENTRY"), filled("R1", close_of(2), "100.0", "1")]
        found = compared(journal(paper, 5, closes={2: "100.5"}), replay, {"BTCUSDT": archived(5)}, START + 5 * MINUTE)
        group = found["groups"][0]
        self.assertEqual((group["stage"], group["orders"][0]["class"], group["cause"]), ("fill", "price", "bar_mismatch"))
        self.assertEqual(found["inputs"]["BTCUSDT"]["bars"]["differing"][0]["fields"], {"close": ["100.5", "100.0"]})

    def test_the_journals_warm_up_is_the_runs(self):
        lines = journal([], 2) + [{"kind": "warmup", "instrument_id": BTC, "period": "1-HOUR", "fetched_ns": 1,
                                   "bars": 4, "first_ts_event": 1, "last_ts_event": 2, "sha256": "h"}]
        self.assertEqual(compare.run_record(lines, [])["warmup"],
                         {BTC: {"1-HOUR": {"bars": 4, "first_ts_event": 1, "last_ts_event": 2, "sha256": "h"}}})

    def test_the_side_connections_states_and_each_process_start_are_the_runs(self):
        """A process begins with its side connection down until its first `up` (engine.kline_events): the journal's
        `started` and each `resumed` mark where."""
        side = {"kind": "kline_socket", "state": "up", "at_ns": START + 10**9, "wall_ns": START + 2 * 10**9}
        lines = [{"kind": "started", "wall_ns": START - 10**9}, side, {"kind": "resumed", "wall_ns": START + MINUTE}]
        run = compare.run_record(lines, [])
        self.assertEqual((run["kline_sockets"], run["side_starts"]), ([side], [START - 10**9, START + MINUTE]))

    def test_the_metrics_the_journal_holds_are_checked_as_live_compare_checks_them(self):
        """engine.paper journals each metrics row the Feed hands the source and each unsubscribe (`metrics`,
        `metrics_unsubscribed`); the comparison expects rows from the first received until the unsubscribe."""
        fives = [START + i * 5 * MINUTE for i in range(1, 5)]  # instants the rows reach the source

        def received(at: int, position_ratio: str) -> dict:
            return {"kind": "metrics", "instrument_id": BTC, "ts_event": at - shared.METRICS_VISIBLE_NS,
                    "wall_ns": at + 10**9, "sum_open_interest": "97897.5650000000000000",
                    "count_toptrader_long_short_ratio": "3.6904000000000000",
                    "sum_toptrader_long_short_ratio": position_ratio, "count_long_short_ratio": None}

        lines = journal([], 20) + [received(fives[0], "1.8441000000000000"), received(fives[1], "1.8442000000000000"),
                                   {"kind": "metrics_unsubscribed", "instrument_id": BTC, "wall_ns": fives[2] - MINUTE}]
        stored = {"BTCUSDT": [[at - shared.METRICS_VISIBLE_NS, "97897.565", "3.6904", "1.8441", None, {}]
                              for at in fives]}
        run = compare.run_record(lines, [])
        self.assertEqual([line["kind"] for line in run["metrics"]], ["metrics", "metrics", "metrics_unsubscribed"])
        found = shared.compare(run, [], {"BTCUSDT": archived(20)}, None, START, START + 20 * MINUTE,
                               archived_metrics=stored)
        metrics = found["inputs"]["BTCUSDT"]["metrics"]
        # fives[2] and fives[3] are due after the unsubscribe: not expected.
        self.assertEqual((metrics["archive"], metrics["live"], metrics["missing"], metrics["differing"]),
                         (2, 2, [], [{"at": shared.utc_text(fives[1]), "fields": {
                             "sum_toptrader_long_short_ratio": ["1.8442000000000000", "1.8441"]}}]))
        self.assertEqual(found["summary"]["differing_metrics"], 1)

    def test_the_interval_runs_from_the_input_start_to_the_minute_the_run_stopped(self):
        lines = journal([], 0)
        self.assertEqual(compare.window(lines, {"stopped_ns": START + 3 * MINUTE + 17 * 10**9}),
                         (START, START + 3 * MINUTE))
        self.assertEqual(refused(compare.window, lines,
                                 {"stopped_ns": START + 30 * 10**9}).code, "PAPER_COMPARE_EMPTY")

    def test_an_equity_difference_names_a_fill_the_run_took_after_its_snapshot(self):
        """Audit runs 52 to 54: the replay fills at its bar's close, inside the minute; Paper fills once the bar reached
        it, after it took the minute's snapshot, so the fill counts a minute later there."""
        replayed = [initialized("R-1", "ENTRY"), filled("R-1", close_of(1), "100.0", "1")]
        lines = journal([initialized("P-1", "ENTRY"), filled("P-1", START + 2 * MINUTE + 900 * 10**6, "100.0", "1")], 3)
        lines += [{"kind": "snapshot", "minute_ns": START + i * MINUTE, "wall_ns": START + (i + 1) * MINUTE - 10**8,
                   "balance_total": "100", "unrealized_pnl": "0"} for i in range(3)]
        found = shared.compare(compare.run_record(lines, []), replayed, {"BTCUSDT": archived(3)}, None, START, START + 3 * MINUTE)
        groups = found["groups"]
        self.assertEqual(groups[0]["class"], "same")
        cuts = {START + i * MINUTE: START + (i + 1) * MINUTE - 10**8 for i in range(3)}
        replay_equity = {START: Decimal(100), START + MINUTE: Decimal("99.9"),
                         START + 2 * MINUTE: Decimal("99.85")}
        run_equity = [(START, Decimal(100)), (START + MINUTE, Decimal(100)),
                      (START + 2 * MINUTE, Decimal("99.9"))]
        explained = shared.equity_differences(run_equity, replay_equity, groups, cuts)
        self.assertEqual([(item["minute_ns"], item["cause"], item["orders"]) for item in explained],
                         [(START + MINUTE, "fill_timing", ["P-1"]), (START + 2 * MINUTE, "unexplained", [])])
        self.assertEqual(found["summary"]["equity_unexplained_minutes"], 0)  # no replay reports: no replay equity

    def test_the_replay_equity_is_read_at_each_snapshot_minutes_close(self):
        with tempfile.TemporaryDirectory() as root:
            reports = Path(root)
            with (reports / "account.csv").open("w", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["ts_event", "total"])
                writer.writerow(["2026-10-25 17:26:00+00:00", "100000.00"])
                # Nautilus writes a balance per account event: a fill's, at its bar's close, follows the one before it.
                writer.writerow(["2026-10-25 17:27:59.999000+00:00", "100010.00"])
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

    def compared_run(self, events_written: bool) -> tuple[list[str], dict]:
        import json
        from unittest import mock
        from replay import entry

        row = {"config": {"candidate": "example@1", "leverage": "5", "fees": {}}, "symbols": ["BTCUSDT"], "market_day": "2026-10-25",
               "source_sha256": "s" * 64, "image_ref": "image"}
        lines = journal([initialized("P-1", "ENTRY"), filled("P-1", START + 30 * 10**9, "100.0", "1")], 3)
        lines += [{"kind": "warmup", "instrument_id": BTC, "period": period, "bars": count, "sha256": "h"}
                  for period, count in (("1-MINUTE", 5), ("1-HOUR", 2), ("1-DAY", 3))]
        argv: list[str] = []

        def replayed(market, commit, source, entry_class, image, given, output, name, timeout, membership_end):
            argv.extend(given)
            reports = Path(output) / entry.REPORTS
            reports.mkdir(parents=True)
            if events_written:
                with gzip.open(reports / "order_events.jsonl.gz", "wt") as stream:
                    for event in (initialized("R-1", "ENTRY"), filled("R-1", START + 30 * 10**9, "100.0", "1")):
                        stream.write(json.dumps(event) + "\n")
            return {"path": str(output), "status": "passed", "problems": []}

        with tempfile.TemporaryDirectory() as name, \
                mock.patch.object(compare.db, "connect"), \
                mock.patch.object(compare.records, "read_paper_run", return_value=row), \
                mock.patch.object(compare.records, "seal_of", return_value={}), \
                mock.patch.object(compare.records, "read_source", return_value={"source": b"", "entry_class": "E"}), \
                mock.patch.object(compare, "_journal", return_value=lines), \
                mock.patch.object(compare, "window", return_value=(START, START + 3 * MINUTE)), \
                mock.patch.object(shared, "archive", return_value=("c" * 32, {"BTCUSDT": archived(3)})), \
                mock.patch("market.files.open_market"), mock.patch("market.instrument.terms", return_value={}), \
                mock.patch.object(shared, "archive_warmup", return_value={}), \
                mock.patch.object(compare.records, "published_settlements", return_value={}), \
                mock.patch.object(entry, "replay_unrecorded", side_effect=replayed), \
                mock.patch("paper.runs.ledger_key", return_value="k"):
            found = compare.compare(object(), {}, None, 7, Path(name) / "out")
            result = json.loads(Path(found["path"]).read_text(encoding="utf-8"))
        return argv, result

    def test_the_replay_runs_at_the_runs_leverage_balance_and_start_on_the_history_it_received(self):
        argv, result = self.compared_run(True)
        self.assertEqual(argv[argv.index("--leverage") + 1], "5")
        self.assertEqual(argv[argv.index("--starting-balance") + 1], compare.ACCOUNT_CONTRACT["starting_balance_usdt"])
        self.assertEqual(argv[argv.index("--trade-start") + 1], "2026-10-25T17:26:00Z")
        # The replay builds a history only from its window's minutes: the two hours before 17:00 open at 15:00 (and
        # the five minutes before 17:26 lie inside them); daily bars come from the market's own.
        self.assertEqual(argv[argv.index("--start") + 1], "2026-10-25T15:00:00Z")
        self.assertEqual((result["summary"]["same"], len(result["groups"])), (1, 1))

    def test_a_replay_without_order_events_has_no_order_comparison(self):
        _, result = self.compared_run(False)
        self.assertIsNone(result["groups"])
        self.assertEqual({key: result["summary"][key] for key in ("run_fills", "replay_fills", "same", "run_only")},
                         {"run_fills": 1, "replay_fills": None, "same": None, "run_only": None})

    def test_each_contract_counts_every_bar_its_list_leaves_out(self):
        minutes = shared.LISTED + 10
        found = compared(journal([], minutes, skip=tuple(range(minutes))), [],
                         {"BTCUSDT": archived(minutes, {0: "99.0"})}, START + minutes * MINUTE)
        listed = found["inputs"]["BTCUSDT"]["bars"]
        self.assertEqual((len(listed["missing"]), listed["missing_bars"]), (shared.LISTED, minutes))
        self.assertEqual(listed["differing_bars"], 0)

    def test_the_archive_reads_the_bars_alone(self):
        """CF-24: the comparison compares bars; it does not read the funding settlements beside them."""
        from unittest import mock
        from market import read
        rows = archived(3)
        with mock.patch.object(read, "stored_bars", return_value={"market_day": "c" * 32, "bars": {"rows": rows}}) as stored:
            commit, found = shared.archive({}, None, ["BTCUSDT"], START, START + 3 * MINUTE,
                                           "PAPER_COMPARE_UNCOVERED")
        self.assertEqual((commit, found), ("c" * 32, {"BTCUSDT": rows}))
        self.assertIs(stored.call_args.kwargs.get("funding"), False)


class ExportTests(unittest.TestCase):
    def test_a_comparisons_market_export_is_fresh_so_it_goes_with_the_replay(self):
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
