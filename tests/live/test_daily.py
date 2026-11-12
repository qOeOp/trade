"""If this fails, the Live control's daily comparison (live.daily) compares the wrong day or trading starts, keeps a
record that loses a failure, a killed attempt or a reported decision, reports the same decision again, runs two
comparisons at once, leaves another comparison's leftovers, runs outside its own temporary directory, or starts its
container without the control's image, user, mounts and its own memory limit."""

from __future__ import annotations

import itertools
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from live import compare, daily
from shared.refusals import refuse
from tests.live.test_compare import MINUTE, RESTART, START, Pack, restart


DAY = daily.DAY_NS
TODAY = "2026-11-12"  # Y is 2026-11-11, the day of the Pack's trading


def measures(groups=1, fills=1, slippage=None, held=(), equity=("1", "1")) -> dict:
    return {"groups": groups, "entries_unfilled": 0, "partial_fills": 0, "fills_paired": fills,
            "adverse_slippage_bps": slippage, "fees": {"run": "0.1", "replay": "0.1", "difference": "0"},
            "equity_change": {"run": equity[0], "replay": equity[1],
                              "difference": str(float(equity[0]) - float(equity[1]))},
            "holds": {"held": len(held), "held_ns": list(held), "held_ns_median": None, "held_ns_p90": None,
                      "ended_runs": 0}}


class Daily(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name) / "account"
        self.root.mkdir(mode=0o700)
        (self.root / "account.lock").touch(mode=0o600)
        self.pack = Pack(self.root)
        restart(self.pack)
        self.status = {"state": "running", "mode": "run"}
        self.calls: list[tuple] = []
        self.results: dict = {}
        observe = mock.patch.object(daily.runs, "observe", side_effect=lambda root, run_id: dict(self.status))
        observe.start()
        self.addCleanup(observe.stop)
        compared = mock.patch.object(compare, "compare", side_effect=self.compare)
        compared.start()
        self.addCleanup(compared.stop)

    def compare(self, root, run_id, market, at, output, timeout, number, since, until):
        self.calls.append((number, since, until, timeout))
        found = self.results.get(number, {})
        if isinstance(found, Exception):
            raise found
        return {"segment": {"number": number, "of": 2}, "window": {"start": "s", "end": "e"}, "market_day": "2026-11-11",
                "summary": {"look_ahead_suspects": found.get("suspects", 0)}, "replay": {"status": "passed"},
                "measures": found.get("measures", measures()), "unexplained": found.get("unexplained", [])}

    def day(self, today: str = TODAY) -> dict | None:
        record = daily.compare_run(self.root, {}, self.pack.run_id, daily._ns(today), self.root / "out")
        if record is not None:
            daily._write(self.root, self.pack.run_id, record)
        return record

    def test_a_running_run_compares_every_trading_start_in_the_week_to_yesterday_cut_at_its_end(self):
        bound = daily._ns(TODAY)
        self.results = {1: {"measures": measures(fills=1, slippage=2.0, held=(5,), equity=("1", "2"))},
                        2: {"measures": measures(fills=3, slippage=6.0, held=(1, 9), equity=("2", "0")),
                            "unexplained": [{"at": "b", "at_ns": RESTART + MINUTE, "class": "run_only"},
                                            {"at": "a", "at_ns": START - 8 * DAY, "class": "differs"}]}}
        record = self.day()
        self.assertEqual(self.calls, [(1, bound - 7 * DAY, bound, 3600), (2, bound - 7 * DAY, bound, 3600)])
        self.assertEqual((record["day"], record["state"], record["done"], record["failures"]),
                         ("2026-11-11", "done", "2026-11-11", 0))
        self.assertEqual([row["at"] for row in record["unexplained"]], ["b"])  # the other is outside the week
        self.assertEqual((record["unexplained_count"], record["unexplained_week"]), (1, 1))
        found = record["measures"]
        self.assertEqual((found["fills_paired"], found["adverse_slippage_bps"]), (4, 5.0))  # weighted by fills
        self.assertEqual(found["holds"]["held_ns"], [1, 5, 9])
        self.assertEqual((found["holds"]["held_ns_median"], found["equity_change"]["difference"]), (5, "1"))
        self.assertEqual(daily.read_record(self.root / "runs" / self.pack.run_id)["state"], "done")
        self.assertIsNone(self.day())  # done for the day: not compared again
        self.assertEqual(len(self.calls), 2)

    def test_a_trading_start_outside_the_week_or_after_the_cut_is_not_replayed(self):
        self.day("2026-11-19")  # Y is 11-18: the week from 11-12 holds neither start (the second runs on)
        self.assertEqual([call[0] for call in self.calls], [2])
        self.calls.clear()
        self.status = {"state": "clean_stopped", "mode": "run"}
        os.remove(self.root / "runs" / self.pack.run_id / daily.RECORD)
        self.day("2026-11-13")  # ended on 11-11: compared to the end of that day, not yesterday
        self.assertEqual({call[2] for call in self.calls}, {daily._ns("2026-11-12")})

    def test_an_uncovered_day_waits_and_is_tried_again_and_an_empty_one_is_final(self):
        self.results = {1: refuse("LIVE_COMPARE_UNCOVERED", "not yet")}
        self.assertEqual((self.day()["state"], self.day()["state"]), ("waiting", "waiting"))
        self.results = {1: refuse("LIVE_COMPARE_EMPTY", "no minute"), 2: refuse("LIVE_COMPARE_EMPTY", "no minute")}
        self.assertEqual(self.day()["state"], "empty")
        self.assertIsNone(self.day())

    def test_failures_count_days_in_a_row_and_a_killed_attempt_is_a_failure_not_retried_forever(self):
        self.results = {1: compare.fail("LIVE_IDENTITY_CHANGED", "changed")}
        self.assertEqual((self.day()["code"], self.day("2026-11-12"), self.day("2026-11-13")["failures"]),
                         ("LIVE_IDENTITY_CHANGED", None, 2))
        directory = self.root / "runs" / self.pack.run_id
        stopped = {**daily.read_record(directory), "day": "2026-11-13", "state": "running", "failures": 2}
        daily._write(self.root, self.pack.run_id, {key: value for key, value in stopped.items() if key != "format"})
        killed = self.day("2026-11-14")
        self.assertEqual((killed["state"], killed["code"], killed["failures"]), ("failed", "stopped", 3))
        self.results = {}
        record = self.day("2026-11-15")
        self.assertEqual((record["state"], record["failures"]), ("done", 0))

    def test_a_decision_already_reported_is_not_reported_again(self):
        late = {"at": "late", "at_ns": daily._ns("2026-11-12") + DAY // 2, "class": "replay_only"}
        early = {"at": "early", "at_ns": START + MINUTE, "class": "run_only"}
        self.results = {2: {"unexplained": [early]}}
        self.assertEqual(self.day()["unexplained_count"], 1)
        self.results = {2: {"unexplained": [early, late]}}
        record = self.day("2026-11-13")
        self.assertEqual(([row["at"] for row in record["unexplained"]], record["unexplained_week"]), (["late"], 2))

    def test_a_reconciliation_a_run_that_never_traded_or_one_ended_over_a_week_ago_is_left_alone(self):
        self.status = {"state": "running", "mode": "reconcile"}
        self.assertIsNone(self.day())
        self.status = {"state": "clean_stopped", "mode": "run"}
        self.assertIsNone(self.day("2026-11-30"))
        self.assertEqual(self.calls, [])


class Pass(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name) / "account"
        self.root.mkdir(mode=0o700)
        (self.root / "account.lock").touch(mode=0o600)
        (self.root / "runs" / "run-a").mkdir(parents=True)
        tmpdir = os.environ.get("TMPDIR")
        self.addCleanup(lambda: os.environ.__setitem__("TMPDIR", tmpdir) if tmpdir else os.environ.pop("TMPDIR", None))
        self.addCleanup(setattr, tempfile, "tempdir", None)

    def test_one_pass_holds_the_lock_cleans_leftovers_and_works_in_its_own_temporary_directory(self):
        leftover = self.root / daily.TMP / "day-old"
        leftover.mkdir(parents=True)
        seen = {}

        def compared(root, market, run_id, today, output):
            seen.update(run_id=run_id, market=market, output=output, temporary=tempfile.gettempdir(),
                        leftover=leftover.exists())
            return {"day": "2026-11-11", "state": "done"}

        docker = mock.Mock(return_value=mock.Mock(stdout="trade-live-compare-run-a-1a2b\nother\n"))
        with mock.patch.object(daily, "compare_run", side_effect=compared), \
                mock.patch.object(daily.subprocess, "run", docker):
            found = daily.run(self.root, Path("/market"), TODAY)
        self.assertEqual(found, {"state": "done", "runs": {"run-a": "done"}})
        self.assertEqual(seen["market"], {"holds": "market", "root": "/market"})
        self.assertEqual(Path(seen["temporary"]), Path(seen["output"]))
        self.assertEqual(Path(seen["output"]).parent, (self.root / daily.TMP).resolve())
        self.assertFalse(seen["leftover"])
        self.assertFalse(Path(seen["output"]).exists())
        removed = [call.args[0] for call in docker.call_args_list if call.args[0][:2] == ["docker", "rm"]]
        self.assertEqual(removed, [["docker", "rm", "trade-live-compare-run-a-1a2b"]])
        self.assertEqual(json.loads((self.root / "runs" / "run-a" / daily.RECORD).read_text())["state"], "done")

    def test_a_second_pass_while_one_holds_the_lock_does_nothing(self):
        with daily._exclusive(self.root) as held, mock.patch.object(daily, "compare_run") as compared:
            self.assertTrue(held)
            self.assertEqual(daily.run(self.root, Path("/market"), TODAY), {"state": "busy", "runs": {}})
        compared.assert_not_called()

    def test_a_record_behind_a_link_is_never_read(self):
        directory = self.root / "runs" / "run-a"
        (self.root / "elsewhere.json").write_text(json.dumps({"format": daily.FORMAT, "state": "done"}))
        (directory / daily.RECORD).symlink_to(self.root / "elsewhere.json")
        self.assertIsNone(daily.read_record(directory))


class Container(unittest.TestCase):
    INSPECTED = {"Id": "c0ffee", "Image": "sha256:" + "a" * 64,
                 "Config": {"User": "1000:1000", "Env": ["HOME=/tmp", "DOCKER_HOST=unix:///var/run/docker.sock",
                                                         "TRADE_PAGE=https://x", "DOCKER_CONFIG=/tmp/docker-public"]},
                 "HostConfig": {"NetworkMode": "trade-backend", "GroupAdd": ["988"], "CapDrop": ["ALL"],
                                "CapAdd": ["DAC_READ_SEARCH"], "SecurityOpt": ["no-new-privileges:true"]}}

    def test_the_comparison_container_is_the_controls_own_with_its_own_limits(self):
        argv = daily.launch_argv(self.INSPECTED, Path("/srv/live"), Path("/srv/market"), TODAY)
        self.assertEqual(argv[:4], ["docker", "run", "--rm", "--init"])
        pairs = list(itertools.pairwise(argv))
        for pair in (("--volumes-from", "c0ffee"), ("--network", "trade-backend"), ("--memory", "2g"),
                     ("--memory-swap", "2g"), ("--cpus", "1"), ("--user", "1000:1000"), ("--group-add", "988"),
                     ("--cap-drop", "ALL"), ("--cap-add", "DAC_READ_SEARCH"),
                     ("--security-opt", "no-new-privileges:true"), ("--env", "HOME=/tmp")):
            self.assertIn(pair, pairs)
        self.assertNotIn(("--env", "TRADE_PAGE=https://x"), pairs)
        self.assertEqual(argv[argv.index("--entrypoint"):], [
            "--entrypoint", "python", "sha256:" + "a" * 64, "-m", "cli.main", "live", "compare-daily",
            "--root", "/srv/live", "--market-root", "/srv/market", "--today", TODAY])

    def test_it_starts_from_half_past_midnight_at_most_once_an_hour(self):
        midnight = daily._ns(TODAY)
        minute = 60 * 10**9
        self.assertFalse(daily.due(midnight + 29 * minute, None))
        self.assertTrue(daily.due(midnight + 31 * minute, None))
        self.assertFalse(daily.due(midnight + 59 * minute, midnight + 31 * minute))
        self.assertTrue(daily.due(midnight + 61 * minute, midnight + 59 * minute))
        self.assertFalse(daily.due(midnight + 61 * minute + 20 * minute, midnight + 61 * minute))

    def test_outside_a_container_the_control_starts_nothing(self):
        with mock.patch.object(daily, "CONTAINER_MARK", Path("/nonexistent")), \
                mock.patch.object(daily.subprocess, "run") as docker:
            self.assertEqual(daily.launch(Path("/r"), Path("/m"), 0), "outside")
        docker.assert_not_called()


if __name__ == "__main__":
    unittest.main()
