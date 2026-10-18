"""Out-of-sample validation: the product checkout freshness gate, the universe check, registration with
its RFC 3161 witness (a local authority, no network) and the one binding of a validation replay."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

from ledger import trials, witness
from ledger.errors import Refusal
from registration import inputs as registration_inputs, seams, validation
from tests.ledger.dolt import BINARY, IDENTITY, MARKET_COMMIT, RUNTIME, SKIP, context, sha, source
from tests.ledger.tsa import LocalAuthority
from tests.registration.world import (DESIGN, MONTHS, SYMBOLS, FakeMarket, World, capture, config, coverage_bytes,
                                      months_rows)

GIT_ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid", "GIT_COMMITTER_NAME": "t",
           "GIT_COMMITTER_EMAIL": "t@example.invalid", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"}


def git(cwd: Path, *argv: str) -> str:
    return subprocess.run(["git", *argv], cwd=cwd, env=GIT_ENV, check=True, capture_output=True, text=True).stdout


def checkout(root: Path) -> tuple[Path, Path]:
    """A bare remote with one main commit and a clean clone of it."""
    remote, clone = root / "remote.git", root / "clone"
    git(root, "init", "--bare", "-b", "main", str(remote))
    git(root, "clone", "-q", str(remote), str(clone))
    (clone / "README").write_text("product\n")
    git(clone, "add", "README")
    git(clone, "commit", "-q", "-m", "first")
    git(clone, "push", "-q", "origin", "HEAD:main")
    return remote, clone


def stale(checkout_root, remote="origin") -> str:
    with patch.dict(os.environ, GIT_ENV):
        try:
            validation.require_fresh(checkout_root, remote)
        except Refusal as exc:
            return exc.code
    return "fresh"


class FreshCheckoutTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="fresh-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.remote, self.clone = checkout(self.root)

    def test_a_clean_checkout_containing_main_is_fresh(self):
        self.assertEqual(stale(self.clone), "fresh")
        (self.clone / ".gitignore").write_text("ignored.log\n")
        git(self.clone, "add", ".gitignore")
        git(self.clone, "commit", "-q", "-m", "ignore logs")
        (self.clone / "ignored.log").write_text("ignored")
        self.assertEqual(stale(self.clone), "fresh", "a local commit ahead of main and ignored files are fine")

    def test_dirty_behind_or_unprovable_checkouts_are_stale(self):
        (self.clone / "README").write_text("edited\n")
        self.assertEqual(stale(self.clone), "STALE_CHECKOUT")
        git(self.clone, "checkout", "-q", "README")
        (self.clone / "draft.py").write_text("x = 1\n")
        self.assertEqual(stale(self.clone), "STALE_CHECKOUT")
        (self.clone / "draft.py").unlink()
        other = self.root / "other"
        git(self.root, "clone", "-q", str(self.remote), str(other))
        (other / "NEW").write_text("new\n")
        git(other, "add", "NEW")
        git(other, "commit", "-q", "-m", "second")
        git(other, "push", "-q", "origin", "HEAD:main")
        self.assertEqual(stale(self.clone), "STALE_CHECKOUT")
        git(self.clone, "pull", "-q", "--ff-only")
        self.assertEqual(stale(self.clone), "fresh")
        self.assertEqual(stale(self.clone, "nowhere"), "STALE_CHECKOUT")
        plain = self.root / "plain"
        plain.mkdir()
        self.assertEqual(stale(plain), "STALE_CHECKOUT")


class MembershipTests(unittest.TestCase):
    months = ["2026-08", "2026-09", "2026-10", "2026-11"]

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="members-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        patcher = patch.object(tempfile, "tempdir", str(self.root))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.market = FakeMarket({MARKET_COMMIT: months_rows(self.months[:3]), "n" * 32: months_rows(self.months),
                                  "a" * 32: months_rows(self.months[:2], ["AAAUSDT"]) + months_rows(self.months[2:]),
                                  "s" * 32: months_rows(self.months[:3])})
        self.registration = {"market_commit": MARKET_COMMIT, "universe_rule": "pool-v1",
                             "created_at": datetime(2026, 10, 19, 12), "window_start": datetime(2026, 11, 2),
                             "window_end": datetime(2026, 11, 9)}

    def inputs(self, commit: str, selection=None) -> dict:
        window = {"start": int(datetime(2026, 11, 1, tzinfo=UTC).timestamp()) * 10**9,
                  "trade_start": int(datetime(2026, 11, 2, tzinfo=UTC).timestamp()) * 10**9,
                  "end": int(datetime(2026, 11, 9, tzinfo=UTC).timestamp()) * 10**9}
        with seams.use(market=lambda profile: profile):
            return registration_inputs.market_inputs(self.market, commit, window, selection or {"universe": True},
                                                     None, True)

    def code(self, inputs, registration=None) -> str:
        with seams.use(market=lambda profile: profile):
            try:
                validation.membership_unchanged(self.market, registration or self.registration, inputs)
            except Refusal as exc:
                return exc.code
        return "unchanged"

    def test_the_registered_months_window_months_and_members_must_hold(self):
        fresh = self.inputs("n" * 32)
        self.assertEqual(self.code(fresh), "unchanged")
        self.assertEqual(self.code({**fresh, "identity": {**fresh["identity"], "universe_rule": "pool-v2"}}),
                         "MEMBERSHIP_CHANGED")
        self.assertEqual(self.code(self.inputs("a" * 32)), "MEMBERSHIP_CHANGED", "a month before registration changed")
        self.assertEqual(self.code(self.inputs("s" * 32, {"symbols": SYMBOLS})), "MEMBERSHIP_CHANGED", "the window month is not produced")
        removed = {**fresh, "identity": {**fresh["identity"], "membership": {"AAAUSDT": fresh["identity"]["membership"][
            "AAAUSDT"]}}}
        self.assertEqual(self.code(removed), "MEMBERSHIP_CHANGED")
        start = int(datetime(2026, 11, 5, tzinfo=UTC).timestamp()) * 10**9
        shortened = {**fresh, "identity": {**fresh["identity"], "membership": {
            **fresh["identity"]["membership"], "BBBUSDT": [[start, start + 10**18]]}}}
        self.assertEqual(self.code(shortened), "MEMBERSHIP_CHANGED")


def _ns(moment: datetime) -> int:
    return int(moment.timestamp()) * 10**9 + moment.microsecond * 1000


@unittest.skipUnless(BINARY and shutil.which("openssl"), SKIP)
class ValidationTests(unittest.TestCase):
    """Registrations whose windows open seconds after they are witnessed; the replays bind once the
    windows have ended."""

    @classmethod
    def setUpClass(cls):
        cls.world = world = World("validation")
        cls.addClassCleanup(world.close)
        now = datetime.now(UTC)
        months = [f"{(now + timedelta(days=31 * k)).year}-{(now + timedelta(days=31 * k)).month:02d}"
                  for k in range(-3, 2)]
        world.market.commits[MARKET_COMMIT] = months_rows(sorted(set(months) | set(MONTHS)))
        cls.authority = LocalAuthority()
        cls.addClassCleanup(cls.authority.close)
        cls.git_root = Path(tempfile.mkdtemp(prefix="product-", dir="/tmp"))
        cls.addClassCleanup(shutil.rmtree, cls.git_root, ignore_errors=True)
        cls.remote, cls.checkout = checkout(cls.git_root)
        environment = patch.dict(os.environ, GIT_ENV)
        environment.start()
        cls.addClassCleanup(environment.stop)
        posted = patch.object(witness, "_post", side_effect=cls.authority.respond)
        posted.start()
        cls.addClassCleanup(posted.stop)
        # The validated candidate's research run: the account terms the validation must keep.
        review = world.prechecked(source("root"))
        world.register("registration-root", world.body(["rsi@1"], {"rsi@1": review}))
        world.seal_run(world.research_trial("registration-root", source("root")))
        cls.unrun = world.publish("never researched", parent=None)
        # One-second windows, one per registration: an unbound registration reserves its own window.
        labels = ("bound", "consumed", "interrupted", "checks", "unrun", "unwitnessed", "released")
        first = (datetime.now(UTC) + timedelta(seconds=5)).replace(microsecond=0)
        cls.windows = {label: (first + timedelta(seconds=k), first + timedelta(seconds=k + 1))
                       for k, label in enumerate(labels)}
        cls.registered = {label: cls.register(label) for label in labels if label != "unwitnessed"}
        with patch.object(witness, "_post", side_effect=OSError("offline")):
            cls.registered["unwitnessed"] = cls.register("unwitnessed")
        time.sleep(max(0.0, (cls.windows[labels[-1]][1] - datetime.now(UTC)).total_seconds()) + 1.2)

    @classmethod
    def register(cls, label: str, **overrides) -> dict:
        start, end = cls.windows.get(label, cls.windows["bound"])
        arguments = {"candidate": cls.unrun["candidate"] if label == "unrun" else "rsi@1", "window_start": start,
                     "window_end": end, "universe_rule": "pool-v1", "market": MARKET_COMMIT, "design": DESIGN,
                     "retry_of": None, "op_id": f"validation:{label}", **overrides}
        return validation.validation_register(cls.world.profile, market_profile=cls.world.market,
                                              tsa_roots=cls.authority.roots, **arguments)

    def setUp(self):
        self.world = self.__class__.world
        self.conn = self.world.conn
        self.binds = 0

    def code(self, function, *args, **kwargs) -> str:
        with self.assertRaises(Refusal) as caught:
            function(*args, **kwargs)
        return caught.exception.code

    def market_inputs(self, start, end) -> dict:
        window = {"start": _ns(start.replace(second=0)), "trade_start": _ns(start), "end": _ns(end)}
        return registration_inputs.market_inputs(self.world.market, MARKET_COMMIT, window, {"universe": True}, None,
                                                 True)

    def bind(self, label: str, data: bytes | None = None, inputs: dict | None = None, inspection: dict | None = None,
             identity: dict | None = None, start=None, end=None, checkout_root=None, binder_source=None) -> int:
        """Open a validation trial whose start receipt records `inputs` and the effective configuration
        of `inspection`, bound to the registration `label`."""
        data = data if data is not None else source("root")
        window = self.windows.get(label, self.windows["bound"])
        start, end = start or window[0], end or window[1]
        inputs = inputs or self.market_inputs(start, end)
        inspection = inspection or {"effective_config": config(symbols=inputs["symbols"])}
        self.binds += 1
        binder = validation.validation_binder(
            self.registered[label]["registration_id"] if label in self.registered else label,
            sha(binder_source if binder_source is not None else data), identity or dict(IDENTITY), inspection,
            market=self.world.market, checkout=checkout_root or self.checkout, tsa_roots=self.authority.roots)
        coverage = coverage_bytes(inspection["effective_config"], inputs["receipts"])
        with seams.use(require_main_build=lambda identity, inspection: "a" * 40):
            return trials.open_trial(self.conn, "validation", sha(data), RUNTIME,
                                     {"identity": inputs["identity"], "input_coverage": coverage},
                                     {"start": _ns(start.replace(second=0)), "trade_start": _ns(start), "end": _ns(end)},
                                     context(data, f"/tmp/validation-{self.id()}-{self.binds}"), binder)["trial_id"]

    def refused_bind(self, label, **kwargs) -> str:
        seq = self.world.seq()
        code = self.code(self.bind, label, **kwargs)
        self.assertEqual(self.world.seq(), seq, "a refused binding writes no trial")
        return code

    def test_a_registration_is_witnessed_and_its_one_replay_binds_it(self):
        registered, start = self.registered["bound"], self.windows["bound"][0]
        self.assertEqual(registered["witness"]["status"], "stamped")
        self.assertLess(registered["witness"]["stamped_at"], start)
        self.assertLess(registered["created_at"], start.replace(tzinfo=None))
        again = self.register("bound")
        self.assertEqual((again["registration_id"], again["replayed"], again["witness"]["status"]),
                         (registered["registration_id"], True, "stamped"))
        trial_id = self.bind("bound")
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT trial_id FROM validation_binding WHERE "
                                                                    "registration_id = %s",
                                                (registered["registration_id"],)), [(trial_id,)])
        self.assertEqual(self.refused_bind("bound"), "REGISTRATION_CONSUMED")

    def test_registration_refusals_write_nothing(self):
        seq = self.world.seq()
        later = datetime.now(UTC) + timedelta(days=30)
        cases = [({"candidate": "ghost@1"}, "CANDIDATE_UNKNOWN"),
                 ({"design": {**DESIGN, "alpha": 0.9}}, "DESIGN_INVALID"),
                 ({"window_start": later.replace(tzinfo=None)}, "WINDOW_INVALID"),
                 ({"window_start": later.astimezone(timezone(timedelta(hours=8)))}, "WINDOW_INVALID"),
                 ({"window_start": later, "window_end": later}, "WINDOW_INVALID"),
                 ({"window_start": later, "window_end": later + timedelta(days=1), "market": "x" * 32},
                  "MARKET_COMMIT_UNRESOLVED"),
                 ({"window_start": later, "window_end": later + timedelta(days=1), "retry_of": 999_999},
                  "RETRY_NOT_ALLOWED"),
                 ({"window_start": later, "window_end": later + timedelta(days=1),
                   "retry_of": self.registered["unwitnessed"]["registration_id"]}, "RETRY_NOT_ALLOWED"),
                 ({"retry_of": self.registered["unwitnessed"]["registration_id"]}, "RETRY_NOT_ALLOWED"),
                 ({"window_start": datetime.now(UTC) - timedelta(days=1)}, "REGISTRATION_TOO_LATE")]
        for overrides, expected in cases:
            with self.subTest(overrides=overrides):
                self.assertEqual(self.code(self.register, f"refused-{expected}", **overrides), expected)
        self.assertEqual(self.world.seq(), seq)

    def test_an_unwitnessed_registration_stays_but_cannot_bind(self):
        unwitnessed = self.registered["unwitnessed"]
        self.assertEqual((unwitnessed["witness"]["status"], unwitnessed["witness"]["error"]),
                         ("failed", "WITNESS_UNAVAILABLE"))
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM validation_registration "
                                                                    "WHERE registration_id = %s",
                                                (unwitnessed["registration_id"],)), [(1,)])
        self.assertEqual(self.refused_bind("unwitnessed"), "REGISTRATION_TOO_LATE")

    def test_a_consumed_registration_with_an_invalid_run_may_be_retried_once(self):
        original = self.registered["consumed"]
        trial_id = self.bind("consumed")
        self.world.seal_run(trial_id, "invalid")
        start, end = self.windows["consumed"]
        retry = self.register("retry", retry_of=original["registration_id"], window_start=start, window_end=end)
        self.assertEqual(retry["witness"]["status"], "stamped")
        self.registered["retry"], self.windows["retry"] = retry, (start, end)
        self.bind("retry")

    def test_the_replay_must_match_the_registration_in_every_identity(self):
        root = source("root")
        dirty = self.git_root / "dirty"
        git(self.git_root, "clone", "-q", str(self.remote), str(dirty))
        (dirty / "draft.py").write_text("x = 1\n")
        self.assertEqual(self.refused_bind("checks", checkout_root=dirty), "STALE_CHECKOUT")
        with seams.use(require_main_build=lambda identity, inspection: (_ for _ in ()).throw(
                Refusal("RUNTIME_NOT_MAIN", "not a main build", write_status="not_written"))):
            self.assertEqual(self.code(validation.validation_bind, self.conn, 1, 1, sha(root), IDENTITY, {},
                                       market=self.world.market, checkout=self.checkout), "RUNTIME_NOT_MAIN")
        other_image = {**IDENTITY, "image_digest": "sha256:" + "c" * 64}
        self.assertEqual(self.refused_bind("checks", identity=other_image), "RUNTIME_NOT_MAIN")
        self.assertEqual(self.refused_bind(999_999), "REGISTRATION_UNKNOWN")
        self.assertEqual(self.refused_bind("checks", data=self.unrun["source"]), "SOURCE_MISMATCH")
        self.assertEqual(self.refused_bind("checks", data=self.unrun["source"], binder_source=root), "SOURCE_MISMATCH")
        start, end = self.windows["checks"]
        inputs = self.market_inputs(start, end)
        changed = {**inputs, "identity": {**inputs["identity"], "universe_rule": "pool-v2"}}
        self.assertEqual(self.refused_bind("checks", inputs=changed), "MEMBERSHIP_CHANGED")
        wider = {**inputs, "identity": {**inputs["identity"], "membership": {
            **inputs["identity"]["membership"], "CCCUSDT": inputs["identity"]["membership"]["AAAUSDT"]}}}
        self.assertEqual(self.refused_bind("checks", inputs=wider), "MEMBERSHIP_CHANGED")
        self.assertEqual(self.refused_bind("checks", start=start - timedelta(seconds=1)), "WINDOW_MISMATCH")
        self.assertEqual(self.refused_bind("checks", end=end + timedelta(seconds=1)), "WINDOW_MISMATCH")
        uncovered = {**inputs, "receipts": {SYMBOLS[0]: inputs["receipts"][SYMBOLS[0]]}}
        self.assertEqual(self.refused_bind("checks", inputs=uncovered), "COVERAGE_INCOMPLETE")
        other_account = {"effective_config": config(account={"balance_usdt": "5000"})}
        self.assertEqual(self.refused_bind("checks", inspection=other_account), "CONFIG_MISMATCH")
        self.assertEqual(self.refused_bind("unrun", data=self.unrun["source"]), "CONFIG_MISMATCH")
        self.bind("checks")


if __name__ == "__main__":
    unittest.main()
