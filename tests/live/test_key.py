"""The key check against a recording transport: the real request building, parsing and refusals, offline."""

import http.client
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

from engine.live_errors import LiveRefusal
from live import key, state

ALLOWED = {"enableWithdrawals": False, "ipRestrict": True, "enableFutures": True}


class KeyLimitsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.credentials = Path(temporary.name).resolve() / "credentials.json"
        state.write_new(self.credentials, b'{"api_key":"example-key","api_secret":"example-secret"}')
        self.seen = []

    def limits(self, answer):
        def respond(_opener, request, timeout):
            self.seen.append(request)
            if request.full_url.endswith("/api/v3/time"):
                return io.BytesIO(b'{"serverTime":123}')
            if isinstance(answer, Exception):
                raise answer
            return io.BytesIO(json.dumps(answer).encode())

        with patch("urllib.request.OpenerDirector.open", respond):
            return key.require_limits(self.credentials)

    def refused(self, answer):
        with self.assertRaises(LiveRefusal) as caught:
            self.limits(answer)
        return caught.exception

    def test_a_key_without_withdrawals_and_with_an_ip_restriction_passes_silently(self):
        self.assertIsNone(self.limits(ALLOWED))
        time, read = self.seen
        self.assertEqual(time.full_url, "https://api.binance.com/api/v3/time")
        self.assertTrue(read.full_url.startswith("https://api.binance.com/sapi/v1/account/apiRestrictions?"))
        self.assertIn("timestamp=123", read.full_url)
        self.assertIn("&signature=", read.full_url)
        self.assertEqual(read.get_method(), "GET")
        self.assertEqual(read.get_header("X-mbx-apikey"), "example-key")
        self.assertNotIn("example-secret", read.full_url)

    def test_every_run_needs_an_ip_restriction(self):
        # The user, 2026-11-13: a timed run too, not only one with no duration.
        self.assertEqual(self.refused({**ALLOWED, "ipRestrict": False}).code, "LIVE_KEY_IP_UNRESTRICTED")
        self.assertIsNone(self.limits(ALLOWED))

    def test_a_key_that_can_withdraw_is_refused(self):
        self.assertEqual(self.refused({**ALLOWED, "enableWithdrawals": True}).code, "LIVE_KEY_WITHDRAWAL")

    def test_anything_short_of_a_clear_answer_is_refused(self):
        answers = [{"ipRestrict": True}, {"enableWithdrawals": False}, [], {**ALLOWED, "enableWithdrawals": "false"},
                   {**ALLOWED, "ipRestrict": None}, OSError("unreachable"), http.client.IncompleteRead(b"{"),
                   http.client.BadStatusLine("junk"),
                   urllib.error.HTTPError("https://example.invalid", 401, "no", None, io.BytesIO())]
        for answer in answers:
            with self.subTest(answer=answer):
                self.assertEqual(self.refused(answer).code, "LIVE_KEY_UNVERIFIED")

    def test_a_refusal_says_what_binance_answered(self):
        answer = urllib.error.HTTPError("https://example.invalid", 451, "no", None, io.BytesIO())
        self.assertIn("HTTP 451", str(self.refused(answer)))

    def test_a_refusal_never_carries_the_signed_url_or_credentials(self):
        exc = self.refused(OSError("https://api.binance.com/sapi?signature=abc example-secret"))
        self.assertNotIn("signature", str(exc))
        self.assertNotIn("example-secret", str(exc))

    def test_an_unreadable_credential_file_is_refused(self):
        self.credentials.unlink()
        self.assertEqual(self.refused(ALLOWED).code, "LIVE_KEY_UNVERIFIED")

    def test_the_read_only_client_cannot_reach_any_other_path(self):
        with self.assertRaises(LiveRefusal):
            key._KeyRead(key.read_credentials(self.credentials)).get("/sapi/v1/capital/withdraw/apply")
