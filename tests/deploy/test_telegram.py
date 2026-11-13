"""The shared Telegram call and settings read, and the release tick's failure notices.

Every Telegram call is injected; no test reaches the network or Docker.
"""

import contextlib
import http.client
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from deploy import release, telegram
from deploy.live_configuration import DECLARATION, OPERATOR_FIELDS


TOKEN = "123456789:" + "A" * 35


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

    def test_absent_is_none_and_a_private_saved_file_is_its_token_and_chat(self):
        self.assertIsNone(telegram.settings(self.directory))
        self.save({"bot_token": TOKEN, "chat_id": 42})
        self.assertEqual(telegram.settings(self.directory), (TOKEN, 42))

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
        self.state, root = base / "release", base / "custody"
        (root / "notify").mkdir(parents=True, mode=0o700)
        root.chmod(0o700)
        (self.state / "live").mkdir(parents=True)
        (self.state / "live/configuration.json").write_text(json.dumps(
            {**dict.fromkeys(OPERATOR_FIELDS), "root": str(root), "format": DECLARATION}))
        self.saved = root / "notify/telegram.json"
        self.saved.write_text(json.dumps({"bot_token": TOKEN, "chat_id": 42}))
        self.saved.chmod(0o600)
        self.call = Telegram()

    def tick(self, error=None, runs=None, ledger=None, call=None):
        """One tick: its own outcome, then what the routed Web showed (None: the probe failed)."""
        def probe(path):
            value = runs if path == "/api/paper/runs" else ledger
            if value is None:
                raise RuntimeError("probe failed")
            return {"runs": value} if path == "/api/paper/runs" else {"ledger": value}

        notices = release.Notices(self.state, call or self.call)
        notices.released(error)
        notices.watch(probe)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            notices.send()
        self.assertNotIn(TOKEN, stderr.getvalue())
        return stderr.getvalue()

    def test_a_release_failure_is_sent_once_while_it_lasts_and_again_after_it_cleared(self):
        failed = RuntimeError("router has an independent change; preserve transaction and stop")
        self.tick(failed)
        self.tick(failed)
        self.assertEqual(self.call.texts(), ["Release tick failed on the host: router identity changed. The current "
                                             "Web and Paper controller stay; see journalctl -u trade-release.service."])
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
        self.assertIn("Failure notice not sent: network", self.tick(failed, runs, call=Telegram(
            [telegram.Failure("network")])))
        self.tick(failed, runs)
        self.assertEqual(len(self.call.texts()), 2)
        refusing = Telegram([telegram.Failure("http_4xx", 400)])
        self.tick(failed, [], {"unpublished": True, "behind_seconds": 3600, "diverged": False}, call=refusing)
        self.tick(failed, [], {"unpublished": True, "behind_seconds": 3600, "diverged": False}, call=refusing)
        self.assertEqual(len(refusing.calls), 1)

    def test_without_live_or_a_saved_token_nothing_is_sent_or_marked_and_nothing_raises(self):
        failed = OSError("disk")
        self.saved.unlink()
        self.tick(failed)
        self.saved.write_text(json.dumps({"bot_token": TOKEN, "chat_id": 42}))
        self.saved.chmod(0o644)
        self.assertIn("Failure notices not sent: ValueError", self.tick(failed))
        self.assertEqual(self.call.calls, [])
        self.saved.chmod(0o600)
        self.tick(failed)  # saved later: a failure still present is sent then
        self.assertEqual(len(self.call.texts()), 1)
        os.unlink(self.state / "live/configuration.json")
        self.tick(RuntimeError("Agent changed before commit"))
        self.assertEqual(len(self.call.texts()), 1)


class Tick(unittest.TestCase):
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
            notices.released.assert_called_once_with(error)
            made.return_value.tick.side_effect = None
            release.tick(host, notices)
            notices.released.assert_called_with(None)
        self.assertEqual(notices.send.call_count, 2)
        probe = notices.watch.call_args.args[0]
        probe("/api/about")
        host.probe.assert_called_with("trade-release-web-" + "a" * 40, "/api/about")
