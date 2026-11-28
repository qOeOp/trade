"""The shared Telegram call and settings read, and the release tick's failure notices.

Every Telegram call is injected; no test reaches the network or Docker.
"""

import contextlib
import http.client
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import Mock, patch

from deploy import notices as notices_module, release, telegram


TOKEN = "123456789:" + "A" * 35
NOW = 1_763_700_000 * 10**9  # the tick's clock, in ns
HOUR = 3600 * 10**9
HEALTHY = {path: {"status": 200, "ok": True} for path, _ in notices_module.WEB_HEALTH}


class Telegram:
    """Records sends; `failures` makes the next sends fail."""

    def __init__(self, failures=()):
        self.failures, self.calls = list(failures), []

    def __call__(self, token, method, payload):
        self.calls.append((token, method, payload))
        if self.failures:
            raise self.failures.pop(0)
        return {"ok": True, "result": {}}

    def texts(self):
        return [payload["text"] for _, _, payload in self.calls]


class Call(unittest.TestCase):
    def test_a_failure_names_only_a_status_class_or_network(self):
        error = telegram.urllib.error.HTTPError("https://api.telegram.org/bot" + TOKEN, 401, "Unauthorized", {}, None)
        with patch.object(telegram.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(telegram.Failure) as caught:
                telegram.telegram(TOKEN, "sendMessage", {})
        self.assertEqual((caught.exception.code, caught.exception.status), ("http_4xx", 401))
        self.assertIsNone(caught.exception.__cause__)
        self.assertTrue(caught.exception.__suppress_context__)
        with patch.object(telegram.urllib.request, "urlopen", side_effect=telegram.urllib.error.URLError("x")):
            with self.assertRaises(telegram.Failure) as caught:
                telegram.telegram(TOKEN, "sendMessage", {})
        self.assertEqual(caught.exception.code, "network")
        self.assertNotIn(TOKEN, repr(caught.exception))
        with patch.object(telegram.urllib.request, "urlopen", side_effect=http.client.IncompleteRead(b"")):
            with self.assertRaises(telegram.Failure) as caught:
                telegram.telegram(TOKEN, "sendMessage", {})
        self.assertEqual(caught.exception.code, "network")


class Settings(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.path = self.directory / "telegram.json"

    def save(self, value, mode=0o600):
        self.path.unlink(missing_ok=True)
        self.path.write_text(json.dumps(value))
        self.path.chmod(mode)

    def test_a_shared_linked_or_malformed_file_is_refused_without_its_content(self):
        cases = [({"bot_token": TOKEN, "chat_id": 42}, 0o644), ({"bot_token": TOKEN}, 0o600),
                 ({"bot_token": TOKEN, "chat_id": "42"}, 0o600), ({"bot_token": "x", "chat_id": 42}, 0o600),
                 ([TOKEN], 0o600), (7, 0o600)]
        for value, mode in cases:
            self.save(value, mode)
            with self.assertRaises(ValueError) as caught:
                telegram.settings(self.directory)
            self.assertNotIn(TOKEN, str(caught.exception))
            self.assertIsNone(caught.exception.__cause__)
        self.save({"bot_token": TOKEN, "chat_id": 42})
        linked = self.directory / "linked"
        linked.mkdir()
        (linked / "telegram.json").symlink_to(self.path)
        with self.assertRaises(ValueError):
            telegram.settings(linked)


class Notices(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name).resolve()
        self.state = base / "release"
        self.root = root = self.state / "live-root"  # the custody root every release host has (deploy/live_host.py)
        (root / "notify").mkdir(parents=True, mode=0o700)
        root.chmod(0o700)
        self.saved = root / "notify/telegram.json"
        self.saved.write_text(json.dumps({"bot_token": TOKEN, "chat_id": 42}))
        self.saved.chmod(0o600)
        self.call = Telegram()
        self.logged: list[str] = []

    def tick(self, error=None, runs=None, ledger=None, call=None, web=HEALTHY, services=None):
        """One tick: its own outcome, then what the routed Web showed (None: the probe failed), and the compose
        services' containers by name (absent when not named; None: Docker could not be read)."""
        def probe(path, routed=False):
            if path in dict(notices_module.WEB_HEALTH):
                self.assertTrue(routed)
                if web.get(path) is None:
                    raise RuntimeError("probe failed")
                return web[path]
            self.assertFalse(routed)
            value = runs if path == "/api/paper/runs" else ledger
            if value is None:
                raise RuntimeError("probe failed")
            return {"runs": value} if path == "/api/paper/runs" else {"ledger": value}

        def condition(container):
            if services is None:
                raise RuntimeError("docker inspect failed")
            return services.get(container)

        notices = notices_module.Notices(self.state, call or self.call, self.logged.append, lambda: NOW)
        notices.released(None if error is None else release.failure_summary(error))
        notices.watch(probe, condition)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            notices.send()
        self.assertNotIn(TOKEN, stderr.getvalue() + "".join(self.logged))
        return stderr.getvalue()

    def test_a_release_failure_is_sent_once_while_it_lasts_and_again_after_it_cleared(self):
        failed = RuntimeError("router has an independent change; preserve transaction and stop")
        self.tick(failed)
        self.tick(failed)
        self.assertEqual(self.call.texts(), ["Release tick failed on the host: router identity changed. Web and the "
                                             "Paper controller each stay on the route they last committed; see "
                                             "journalctl -u trade-release.service."])
        self.assertEqual(self.call.calls[0][:2], (TOKEN, "sendMessage"))
        self.assertEqual(self.call.calls[0][2]["chat_id"], 42)
        self.assertEqual((self.state / "notices.json").stat().st_mode & 0o777, 0o600)
        self.assertNotIn(TOKEN, (self.state / "notices.json").read_text())
        self.tick(None)
        self.tick(RuntimeError("private payload " + TOKEN))
        self.tick(failed)
        self.assertEqual(len(self.call.texts()), 3)
        self.assertIn("unclassified runtime failure", self.call.texts()[1])
        self.assertNotIn("private payload", "".join(self.call.texts()))

    def test_a_paper_run_that_could_not_resume_is_named_by_its_code_and_a_failed_probe_resends_nothing(self):
        runs = [{"id": 7, "candidate": "rsi2@3", "state": "ended", "recovery": "PAPER_RECOVERY_UNAVAILABLE"},
                {"id": 8, "candidate": "<b>odd</b>", "state": "unsealed", "recovery": "free text, not a code"},
                {"id": 9, "candidate": "rsi2@4", "state": "running", "recovery": None}]
        self.tick(runs=runs)
        self.assertEqual(self.call.texts(), [
            "Paper run 7 (rsi2@3) stopped and could not resume: PAPER_RECOVERY_UNAVAILABLE. It stays stopped with "
            "its account and originals; see the Paper page.",
            "Paper run 8 stopped and could not resume: other. It stays stopped with its account and originals; "
            "see the Paper page."])
        self.tick(runs=None)  # the Web did not answer: unknown, not cleared
        self.tick(runs=runs[:1])
        self.assertEqual(len(self.call.texts()), 2)
        self.tick(runs=[])
        self.tick(runs=runs[:1])
        self.assertEqual(len(self.call.texts()), 3)

    def test_a_paper_run_that_ended_by_itself_is_sent_once_and_a_stop_the_user_asked_for_is_not(self):
        """Two runs ended at the same second on PAPER_CACHE_UNAVAILABLE (2026-11-20) and nothing was sent. The runs
        are as the runs probe gives them (deploy/release_host.py PROBE)."""
        def run(paper_id, stop, ended=HOUR, reasons=None, state="sealed"):
            return {"id": paper_id, "candidate": "rsi2@3", "state": state, "containers": 0, "last": None,
                    "recovery": None, "unprotected": [], "stop_reason": stop,
                    "stopped_ns": None if ended is None else NOW - ended,
                    "reasons": [f"STOPPED:{stop}"] if reasons is None else reasons}
        runs = [run(7, "PAPER_CACHE_UNAVAILABLE", reasons=["REFUSED:PAPER_CACHE_UNAVAILABLE",
                                                            "STOPPED:PAPER_CACHE_UNAVAILABLE"]),
                run(8, None, reasons=["RUNNER_EXIT_NONZERO", "SUMMARY_MISSING", "<b>"]),
                run(9, "STOP_FILE", reasons=[]), run(10, "DURATION", reasons=[]),
                run(11, "SIGTERM", ended=25 * HOUR),  # ended before the day this notice looks back over
                run(12, None, reasons=["START_FAILED", "JOURNAL_MISSING"]),
                run(13, None, ended=None, reasons=["JOURNAL_MISSING"]), run(14, None, state="ended", reasons=None)]
        self.tick(runs=runs)
        self.tick(runs=runs)
        self.assertEqual(self.call.texts(), [
            "Paper run 7 (rsi2@3) ended by itself: PAPER_CACHE_UNAVAILABLE. It is sealed with its journal and runner "
            "log (REFUSED:PAPER_CACHE_UNAVAILABLE, STOPPED:PAPER_CACHE_UNAVAILABLE); see the Paper page.",
            "Paper run 8 (rsi2@3) ended by itself: no_summary. It is sealed with its journal and runner log "
            "(RUNNER_EXIT_NONZERO, SUMMARY_MISSING); see the Paper page."])
        self.tick(runs=[run(7, "PAPER_CACHE_UNAVAILABLE", ended=25 * HOUR), runs[1]])  # a day later: cleared
        self.tick(runs=runs[:2])
        self.assertEqual(len(self.call.texts()), 3)

    def test_a_held_runs_unprotected_position_is_sent_once_while_it_lasts(self):
        """User 2026-11-17: a held position with no working stop stays held and is named at once."""
        runs = [{"id": 7, "candidate": "rsi2@3", "state": "running", "recovery": None, "unprotected": ["P-1", "<b>"]}]
        self.tick(runs=runs)
        self.tick(runs=runs)
        self.assertEqual(self.call.texts(), [
            "Paper run 7 (rsi2@3) is held after an interruption and its position P-1 has no working stop. It stays "
            "held until its other orders or a stop close it; see the Paper page.",
            "Paper run 7 (rsi2@3) is held after an interruption and its position other has no working stop. It "
            "stays held until its other orders or a stop close it; see the Paper page."])
        self.tick(runs=[{**runs[0], "unprotected": ["P-1", "<b>", "P-2"]}])
        self.assertEqual(len(self.call.texts()), 3, "a new unprotected position is its own notice")
        self.tick(runs=[{**runs[0], "unprotected": []}])
        self.tick(runs=[{**runs[0], "unprotected": ["P-1"]}])
        self.assertEqual(len(self.call.texts()), 4, "again only after it cleared")

    def test_the_ledger_is_named_once_its_publish_has_failed_for_half_an_hour_or_its_origin_diverged(self):
        self.tick(ledger={"unpublished": True, "behind_seconds": 600, "diverged": False})
        self.tick(ledger={"unpublished": True, "behind_seconds": None, "diverged": False})
        self.assertEqual(self.call.texts(), [])
        self.tick(ledger={"unpublished": True, "behind_seconds": 1860, "diverged": False})
        self.tick(ledger={"unpublished": True, "behind_seconds": 2400, "diverged": False})
        self.assertEqual(self.call.texts(), ["The research ledger has not been published for 31 minutes: its publish "
                                             "keeps failing (publish_failed)."])
        self.tick(ledger={"unpublished": True, "behind_seconds": None, "diverged": True})
        self.assertIn("origin history changed elsewhere", self.call.texts()[-1])
        self.tick(ledger=None)  # the ledger was not read: nothing clears
        self.tick(ledger={"unpublished": True, "behind_seconds": None, "diverged": True})
        self.assertEqual(len(self.call.texts()), 2)

    def test_an_unsent_notice_is_retried_in_order_and_one_telegram_refuses_is_not(self):
        failed = RuntimeError("Agent changed before commit")
        runs = [{"id": 7, "candidate": "rsi2@3", "recovery": "PAPER_FAILED"}]
        self.tick(failed, runs, call=Telegram([telegram.Failure("network")]))
        self.assertEqual([line.split(" ", 3)[2:] for line in self.logged], [
            ["release", "release:Agent identity changed not sent (network): retried next tick: \"Release tick failed "
                        "on the host: Agent identity changed. Web and the Paper controller each stay on the route "
                        "they last committed; see journalctl -u trade-release.service.\""],
            ["paper", "paper:7:PAPER_FAILED not sent (network): retried next tick: \"Paper run 7 (rsi2@3) stopped "
                      "and could not resume: PAPER_FAILED. It stays stopped with its account and originals; see the "
                      "Paper page.\""]])
        self.assertRegex(self.logged[0], r"\ANotice \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00 ")
        self.tick(failed, runs)
        self.assertEqual(len(self.call.texts()), 2)
        self.assertEqual([" sent: " in line for line in self.logged[2:]], [True, True])
        refusing = Telegram([telegram.Failure("http_4xx", 400)])
        self.tick(failed, [], {"unpublished": True, "behind_seconds": 3600, "diverged": False}, call=refusing)
        self.tick(failed, [], {"unpublished": True, "behind_seconds": 3600, "diverged": False}, call=refusing)
        self.assertEqual(len(refusing.calls), 1)
        self.assertIn("ledger:behind refused by Telegram (http_4xx): ", self.logged[-1])
        self.assertEqual(len(self.logged), 5, "a fact marked sent is not logged again")

    def test_without_a_custody_root_or_a_saved_token_nothing_is_sent_or_marked_and_nothing_raises(self):
        failed = OSError("disk")
        self.saved.unlink()
        self.tick(failed)
        self.assertIn(" release release:filesystem or operating-system operation failed not sent: no Telegram chat saved: ",
                      self.logged[-1])
        self.saved.write_text(json.dumps({"bot_token": TOKEN, "chat_id": 42}))
        self.saved.chmod(0o644)
        self.assertIn("Failure notices not sent: ValueError", self.tick(failed))
        self.assertEqual(self.call.calls, [])
        self.saved.chmod(0o600)
        self.tick(failed)  # saved later: a failure still present is sent then
        self.assertEqual(len(self.call.texts()), 1)
        shutil.rmtree(self.root)  # a host whose first paired release has not run yet
        self.tick(RuntimeError("Agent changed before commit"))
        self.assertEqual(len(self.call.texts()), 1)


    def test_a_routed_web_that_does_not_answer_is_one_notice_and_each_unhealthy_part_its_own(self):
        agent = {**HEALTHY, "/api/agent/health": {"status": 502, "ok": True}}
        self.tick(web=agent)
        self.tick(web=agent)
        self.assertEqual(self.call.texts(), ["The Agent does not answer healthy through the routed Web "
                                             "(/api/agent/health); its part of the IDE is unavailable."])
        self.tick(web={**HEALTHY, "/api/overview/health": {"status": 200, "ok": False}})
        self.assertIn("The Market overview does not answer healthy", self.call.texts()[-1])
        self.tick(web={})  # nothing answers: the Web itself, not three parts
        self.assertEqual(len(self.call.texts()), 3)
        self.assertIn("The routed Web does not answer on the host", self.call.texts()[-1])
        self.tick(web={})
        self.tick()  # answering again clears it
        self.tick(web={})
        self.assertEqual(len(self.call.texts()), 4)

    def test_an_unhealthy_market_import_quotes_what_its_check_printed_and_nothing_else(self):
        ledger, market = "trade-ide-ledger-1", "trade-ide-market-import-1"
        sick = {"running": True, "health": "unhealthy", "oom": False, "restarts": 0}
        self.tick(services={market: {**sick, "output": "status is 27.4 h old, a round running since "
                                                         "2026-11-20T08:30:00+00:00\n"},
                            ledger: {**sick, "output": "the ledger check printed this"}})
        self.tick(services={market: {**sick, "output": "metrics/BTCUSDT lagging"}})  # same fact: not sent again
        self.assertEqual(self.call.texts(), [
            "The ledger service reports unhealthy: its check cannot read the research ledger.",
            "The market-import service reports unhealthy: an import is stopped or lagging, or its status is a day "
            "old (its check: status is 27.4 h old, a round running since 2026-11-20T08:30:00+00:00)."])
        for output in ("token=" + TOKEN + "\n" + "x" * 400, "<b>html</b>", None, ""):
            self.tick(services={})
            self.tick(services={market: {**sick, "output": output}})
            self.assertTrue(self.call.texts()[-1].endswith("or its status is a day old."), output)

    def test_an_unhealthy_out_of_memory_or_restarted_service_is_named_and_restarts_only_as_they_double(self):
        ledger, market = "trade-ide-ledger-1", "trade-ide-market-import-1"
        well = {"running": True, "health": "healthy", "oom": False, "restarts": 0}
        self.tick(services={ledger: well, market: {**well, "health": "starting"}})
        self.tick(services={ledger: {**well, "health": None}})  # market-import is not deployed here
        self.assertEqual(self.call.texts(), [])
        self.tick(services={ledger: {**well, "health": "unhealthy"}, market: {**well, "oom": True, "restarts": 1}})
        self.assertEqual(self.call.texts(), [
            "The ledger service reports unhealthy: its check cannot read the research ledger.",
            "The market-import container was killed out of memory at its last exit.",
            "The market-import container has restarted 1 times since it was created; the next notice comes at 2."])
        for restarts in (2, 3, 3, 4, 7):
            self.tick(services={ledger: {**well, "health": "unhealthy"}, market: {**well, "restarts": restarts}})
        self.assertEqual(len(self.call.texts()), 5)
        self.assertIn("restarted 4 times", self.call.texts()[-1])
        self.tick(services=None)  # Docker was not read: unknown, nothing clears
        self.tick(services={ledger: {**well, "health": "unhealthy"}, market: {**well, "restarts": 7}})
        self.assertEqual(len(self.call.texts()), 5)
        self.tick(services={ledger: well, market: well})  # recreated: cleared
        self.tick(services={ledger: {**well, "health": "unhealthy"}, market: well})
        self.assertEqual(len(self.call.texts()), 6)


    def test_drift_is_sent_once_while_it_lasts_and_an_unreadable_one_clears_nothing(self):
        def tick(read):
            notices = notices_module.Notices(self.state, self.call)
            notices.drifted(read)
            notices.send()

        def unreadable():
            raise RuntimeError("docker inspect failed")

        drifted = {"drift:docker-api:sha256:" + "a" * 64: "docker-api runs another image."}
        tick(lambda: drifted)
        tick(lambda: drifted)
        tick(unreadable)
        tick(lambda: drifted)
        self.assertEqual(self.call.texts(), ["docker-api runs another image."])
        tick(dict)
        tick(lambda: drifted)
        self.assertEqual(len(self.call.texts()), 2)


class Tick(unittest.TestCase):
    def test_a_failed_fetch_is_named_and_noticed_only_when_the_fetch_before_it_failed_too(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Mock(state=Path(directory))
            notices = Mock()
            source = release.GitSource(Path(directory))
            source.repo.mkdir()
            (source.repo / "FETCH_HEAD").write_text("c" * 40 + "\t\tbranch 'main' of https://github.com/x/y\n")

            def git(*args, raw=False):
                if args[0] == "fetch":
                    (source.repo / "FETCH_HEAD").write_text("")  # as git does when a fetch fails
                    raise release.SourceUnreachable("fetch")
                return ""

            source.git = git
            with patch.object(release, "Release") as made:
                made.return_value.tick.side_effect = lambda: source.refresh()
                with self.assertRaises(RuntimeError):
                    release.tick(host, notices)
                notices.released.assert_not_called()  # the previous fetch succeeded: nothing new is sent
                with self.assertRaises(RuntimeError):
                    release.tick(host, notices)
                notices.released.assert_called_once_with("GitHub source unreachable (public git fetch failed)")
                made.return_value.tick.side_effect = release.SourceUnreachable("show")
                with self.assertRaises(RuntimeError):
                    release.tick(host, notices)  # any other git failure is noticed at once
                notices.released.assert_called_with("GitHub source unreachable (public git show failed)")

    def test_a_failed_tick_is_noticed_and_still_raises_and_the_routed_web_is_read_either_way(self):
        host = Mock(state=Path("/never"))
        host.disk_route.return_value = "trade-release-web-" + "a" * 40
        host.probe.return_value = {"runs": [], "ledger": None}
        notices = Mock()
        error = RuntimeError("Agent changed before commit")
        with patch.object(release, "Release") as made, patch.object(release, "GitSource"):
            made.return_value.tick.side_effect = error
            with self.assertRaises(RuntimeError):
                release.tick(host, notices)
            notices.released.assert_called_once_with("Agent identity changed")
            made.return_value.tick.side_effect = None
            release.tick(host, notices)
            notices.released.assert_called_with(None)
        self.assertEqual(notices.send.call_count, 2)
        probe, condition = notices.watch.call_args.args
        probe("/api/about")
        host.probe.assert_called_with("trade-release-web-" + "a" * 40, "/api/about", False)
        probe("/api/agent/health", routed=True)
        host.probe.assert_called_with("trade-release-web-" + "a" * 40, "/api/agent/health", True)
        self.assertEqual(condition, host.condition)
        self.assertEqual(notices.drifted.call_count, 2)
        with patch.object(release, "drift", return_value={}) as drift, patch.object(release, "GitSource") as source:
            notices.drifted.call_args.args[0]()
        drift.assert_called_once_with(host, source.return_value)
