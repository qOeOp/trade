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

from ledger import db, trials, witness
from ledger.errors import Refusal
from registration import inputs as registration_inputs, seams, validation
from report import comparison, review as ledger_review
from tests.ledger.dolt import (BINARY, IDENTITY, MARKET_COMMIT, RUNTIME, SKIP, attempt_binder, context,
                               product_bundle, sha, source)
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

    def test_a_checkout_containing_main_is_fresh_whatever_its_work_tree_holds(self):
        self.assertEqual(stale(self.clone), "fresh")
        git(self.clone, "commit", "-q", "--allow-empty", "-m", "ahead")
        (self.clone / "README").write_text("edited\n")
        (self.clone / "draft.py").write_text("x = 1\n")
        self.assertEqual(stale(self.clone), "fresh", "a local commit ahead of main and local changes are fine")

    def test_behind_or_unprovable_checkouts_are_stale(self):
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
                                  "s" * 32: months_rows(self.months[:3]),
                                  "b" * 32: months_rows(self.months[:2]) + months_rows(self.months[2:3], ["AAAUSDT"])
                                  + months_rows(self.months[3:])})
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
        self.assertEqual(self.code(self.inputs("b" * 32)), "MEMBERSHIP_CHANGED", "the registration month changed")
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
        labels = ("bound", "consumed", "interrupted", "checks", "unrun", "unwitnessed", "baseline",
                  "retry-baseline", "retry-members", "corrected", "successful", "legacy-design", "witness-report",
                  "released")
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
             identity: dict | None = None, start=None, end=None, checkout_root=None, binder_source=None,
             purpose: str = "validation") -> int:
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
            return trials.open_trial(self.conn, purpose, sha(data), RUNTIME,
                                     {"identity": inputs["identity"], "input_coverage": coverage},
                                     {"start": _ns(start.replace(second=0)), "trade_start": _ns(start), "end": _ns(end)},
                                     context(data, f"/tmp/validation-{self.id()}-{self.binds}"), binder)["trial_id"]

    def refused_bind(self, label, **kwargs) -> str:
        seq = self.world.seq()
        code = self.code(self.bind, label, **kwargs)
        self.assertEqual(self.world.seq(), seq, "a refused binding writes no trial")
        return code

    def later_research(self, data: bytes, account: dict) -> int:
        """Append sealed research facts in this isolated fixture, without exercising registration
        admission again; the validation binder must not adopt these later account terms."""
        execution = self.world.plan("registration-root")["execution"]
        execution = {**execution, "effective_config": {**execution["effective_config"], "account": account}}
        bundle = f"registration-later-{self.world.counter + 1}"
        product_bundle(self.conn, bundle, {"research-plan.json": b"{}"})
        trial_id = self.world.research_trial("registration-root", data, execution=execution,
                                             binder=attempt_binder(bundle, sha(data)))
        return self.world.seal_run(trial_id)

    def test_account_terms_stay_at_registration_even_when_later_research_changes_them(self):
        changed = {**config()["account"], "starting_balance_usdt": "5000"}
        later = self.later_research(source("root"), changed)
        self.assertEqual(trials.latest_research(self.conn, sha(source("root"))), later)
        self.assertEqual(self.refused_bind("baseline", inspection={"effective_config": config(account=changed)}),
                         "CONFIG_MISMATCH")
        self.bind("baseline")  # Original terms still bind, despite the newer research run.

    def test_retries_keep_the_original_account_baseline_across_multiple_hops(self):
        original = self.registered["retry-baseline"]
        trial_id = self.bind("retry-baseline")
        self.world.seal_run(trial_id, "invalid")
        changed = {**config()["account"], "fees": "changed-after-registration"}
        self.later_research(source("root"), changed)
        start, end = self.windows["retry-baseline"]
        for index in range(2):
            label = f"baseline-retry-{index}"
            retry = self.register(label, retry_of=original["registration_id"], window_start=start, window_end=end)
            self.registered[label], self.windows[label] = retry, (start, end)
            self.assertEqual(self.refused_bind(label, inspection={"effective_config": config(account=changed)}),
                             "CONFIG_MISMATCH")
            trial_id = self.bind(label)
            self.world.seal_run(trial_id, "invalid")
            original = retry

    def test_later_research_cannot_supply_a_missing_original_baseline(self):
        self.later_research(self.unrun["source"], config()["account"])
        self.assertEqual(self.refused_bind("unrun", data=self.unrun["source"]), "CONFIG_MISMATCH")

    def test_corrected_input_identity_can_bind_the_original_unused_registration(self):
        corrected = "c" * 32
        self.world.market.commits[corrected] = list(self.world.market.commits[MARKET_COMMIT])
        start, end = self.windows["corrected"]
        window = {"start": _ns(start.replace(second=0)), "trade_start": _ns(start), "end": _ns(end)}
        inputs = registration_inputs.market_inputs(self.world.market, corrected, window, {"universe": True},
                                                   None, True)
        self.assertNotEqual(inputs["identity"]["export_content_sha256"],
                            self.market_inputs(start, end)["identity"]["export_content_sha256"])
        self.bind("corrected", inputs=inputs)
        self.assertEqual(self.refused_bind("corrected", inputs=inputs), "REGISTRATION_CONSUMED")

    def test_retry_market_commit_cannot_rebase_the_original_membership_check(self):
        trial_id = self.bind("retry-members")
        self.world.seal_run(trial_id, "invalid")
        changed = "d" * 32
        self.world.market.commits[changed] = self.world.market.commits[MARKET_COMMIT][1:]
        start, end = self.windows["retry-members"]
        retry = self.register("members-retry", retry_of=self.registered["retry-members"]["registration_id"],
                              window_start=start, window_end=end, market=changed)
        self.registered["members-retry"], self.windows["members-retry"] = retry, (start, end)
        window = {"start": _ns(start.replace(second=0)), "trade_start": _ns(start), "end": _ns(end)}
        inputs = registration_inputs.market_inputs(self.world.market, changed, window, {"universe": True}, None,
                                                   True)
        self.assertEqual(self.refused_bind("members-retry", inputs=inputs), "MEMBERSHIP_CHANGED")
        self.bind("members-retry")  # The refused trial did not consume the retry.

    def test_data_correction_does_not_make_a_successful_validation_retryable(self):
        trial_id = self.bind("successful")
        self.world.seal_run(trial_id)
        start, end = self.windows["successful"]
        corrected = "e" * 32
        self.world.market.commits[corrected] = list(self.world.market.commits[MARKET_COMMIT])
        seq = self.world.seq()
        self.assertEqual(self.code(self.register, "successful-retry", market=corrected,
                                   retry_of=self.registered["successful"]["registration_id"],
                                   window_start=start, window_end=end), "RETRY_NOT_ALLOWED")
        self.assertEqual(self.world.seq(), seq)

    def test_a_legacy_unbound_retry_with_changed_design_cannot_bind(self):
        trial_id = self.bind("legacy-design")
        self.world.seal_run(trial_id, "invalid")
        start, end = self.windows["legacy-design"]
        # Model the previous release's admission only while creating an old-style retry;
        # binding below uses the real checks and leaves that historical record intact.
        with patch.object(validation, "_design", return_value={**DESIGN, "seed": 8}):
            retry = self.register("legacy-retry", retry_of=self.registered["legacy-design"]["registration_id"],
                                  window_start=start, window_end=end, design={**DESIGN, "seed": 8})
        self.registered["legacy-retry"], self.windows["legacy-retry"] = retry, (start, end)
        self.assertEqual(self.refused_bind("legacy-retry"), "RETRY_NOT_ALLOWED")

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
        seq = self.world.seq()
        for field, value in (("seed", 8), ("alpha", 0.01), ("minimum_effect", 0.02),
                             ("design_reason", "a different rationale after seeing the window")):
            with self.subTest(field=field):
                self.assertEqual(self.code(self.register, f"retry-changed-{field}",
                                           retry_of=original["registration_id"], window_start=start, window_end=end,
                                           design={**DESIGN, field: value}), "RETRY_NOT_ALLOWED")
                self.assertEqual(self.world.seq(), seq)
        retry = self.register("retry", retry_of=original["registration_id"], window_start=start, window_end=end)
        self.assertEqual(retry["witness"]["status"], "stamped")
        self.registered["retry"], self.windows["retry"] = retry, (start, end)
        self.bind("retry")

    def test_a_bound_registration_without_a_run_is_retried_only_after_an_interrupted_capture(self):
        original = self.registered["interrupted"]
        start, end = self.windows["interrupted"]
        trial_id = self.bind("interrupted")
        retry = {"retry_of": original["registration_id"], "window_start": start, "window_end": end}
        self.assertEqual(self.code(self.register, "interrupted-retry", **retry), "RETRY_NOT_ALLOWED")
        capture(self.conn, trial_id, source("root"), purpose="validation", outcome="interrupted")
        self.assertEqual(self.register("interrupted-retry", **retry)["witness"]["status"], "stamped")

    def test_retry_reports_use_the_original_witness_even_when_a_later_stamp_fails(self):
        original = previous = self.registered["witness-report"]
        start, end = self.windows["witness-report"]
        trial_id = self.bind("witness-report")
        capture(self.conn, trial_id, source("root"), purpose="validation", outcome="interrupted")
        (commit,), = self.world.service.sql(self.world.profile,
            "SELECT to_commit FROM dolt_diff_validation_registration WHERE to_registration_id = %s "
            "AND diff_type = 'added'", (original["registration_id"],))
        registrations = {str(original["registration_id"])}

        def audit_findings(at=None):
            with db.connect(self.world.profile, "reader") as conn:
                audited = ledger_review.review_all(conn, at, trial_ids=[])
            return [item for item in audited["findings"] if item["code"].startswith("WITNESS_")
                    and item["record_id"] in registrations]

        with patch.object(witness, "_roots", return_value=self.authority.roots):
            expected = comparison.validation_report(self.world.profile, original["registration_id"])["witness"]
            self.assertEqual((expected["registration_id"], expected["commit_hash"], expected["verified"]),
                             (original["registration_id"], commit, True))
            self.assertEqual(expected["stamped_at"], original["witness"]["stamped_at"])
            self.assertLess(expected["stamped_at"], start)
            historical = db.head_commit(self.conn)
            for index in range(2):
                label = f"witness-retry-{index}"
                post = self.authority.respond if index == 0 else OSError("offline")
                with patch.object(witness, "_post", side_effect=post):
                    retry = self.register(label, retry_of=previous["registration_id"],
                                          window_start=start, window_end=end)
                if index == 0:
                    self.assertEqual(retry["witness"]["status"], "stamped")
                    self.assertGreaterEqual(retry["witness"]["stamped_at"], start)
                else:
                    self.assertEqual(retry["witness"]["status"], "failed")
                self.registered[label], self.windows[label] = retry, (start, end)
                registrations.add(str(retry["registration_id"]))
                trial_id = self.bind(label)
                capture(self.conn, trial_id, source("root"), purpose="validation", outcome="interrupted")
                with patch.object(witness, "_post", side_effect=AssertionError("report must verify offline")):
                    found = comparison.validation_report(self.world.profile, retry["registration_id"])
                    self.assertEqual(audit_findings(), [])
                self.assertEqual(found["witness"], expected)
                self.assertEqual(found["registration"]["retry_of"], previous["registration_id"])
                self.assertEqual(found["binding"]["trial_id"], trial_id)
                self.assertFalse(any(item.startswith("UNWITNESSED") for item in found["limitations"]))
                previous = retry
            with patch.object(witness, "token_time", side_effect=Refusal("WITNESS_INVALID", "invalid fixture",
                                                                       write_status="not_written")):
                invalid = comparison.validation_report(self.world.profile, previous["registration_id"])
            self.assertEqual(invalid["witness"], {**expected, "verified": False, "stamped_at": None})
            self.assertTrue(any(item.startswith("UNWITNESSED") for item in invalid["limitations"]))
            # A report at the original ledger version uses that version's existing relationship.
            self.assertEqual(comparison.validation_report(self.world.profile, original["registration_id"],
                                                          historical)["witness"], expected)
            self.assertEqual(audit_findings(historical), [])
            read_stamp = witness.stamped_at
            for stamp, code in ((None, "WITNESS_MISSING"), (start, "WITNESS_LATE"),
                                (start + timedelta(microseconds=1), "WITNESS_LATE"),
                                (Refusal("WITNESS_INVALID", "invalid original token", write_status="not_written"),
                                 "WITNESS_MISSING")):
                with self.subTest(original_stamp=stamp):
                    def original_stamp(conn, target, *args, **kwargs):
                        if target != commit:
                            return read_stamp(conn, target, *args, **kwargs)
                        if isinstance(stamp, Refusal):
                            raise stamp
                        return stamp
                    with patch.object(witness, "stamped_at", side_effect=original_stamp):
                        findings = audit_findings()
                    self.assertEqual({item["record_id"] for item in findings}, registrations)
                    self.assertTrue(all(item["code"] == code and item["commit"] == commit for item in findings))
                    self.assertTrue(all(f"original registration {original['registration_id']}" in item["detail"]
                                        for item in findings))

    def test_the_same_op_id_with_other_content_conflicts(self):
        start, end = self.windows["bound"]
        cases = [{"universe_rule": "pool-v2"}, {"design": {**DESIGN, "seed": 8}}, {"window_end": end + timedelta(1)},
                 {"candidate": self.unrun["candidate"]}]
        seq = self.world.seq()
        for overrides in cases:
            with self.subTest(overrides=overrides):
                self.assertEqual(self.code(self.register, "bound", **overrides), "OP_ID_CONFLICT")
        self.assertEqual(self.world.seq(), seq)
        self.assertTrue(self.register("bound")["replayed"])

    def test_a_failing_witness_after_the_commit_leaves_the_registration_and_reports_it(self):
        later = datetime.now(UTC) + timedelta(days=60)
        registered = self.register("insecure-witness", window_start=later, window_end=later + timedelta(days=1),
                                   tsa_url="http://timestamp.example.invalid")
        self.assertEqual((registered["witness"]["status"], registered["witness"]["stamped_at"]), ("failed", None))
        self.assertIn("https", registered["witness"]["error"])
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM validation_registration "
                                                                    "WHERE registration_id = %s",
                                                (registered["registration_id"],)), [(1,)])

    def test_an_unbound_registration_reserves_its_window_for_its_candidate(self):
        start, end = self.windows["released"]
        identity = self.market_inputs(start, end)["identity"]

        def trial(data: bytes, trade_start: datetime, trade_end: datetime, purpose: str = "explore") -> int:
            window = {"start": _ns(trade_start.replace(second=0)), "trade_start": _ns(trade_start),
                      "end": _ns(trade_end)}
            self.binds += 1
            return trials.open_trial(self.conn, purpose, sha(data), RUNTIME,
                                     {"identity": identity, "input_coverage": coverage_bytes(config())}, window,
                                     context(data, f"/tmp/reserved-{self.binds}"))["trial_id"]

        seq = self.world.seq()
        for purpose in ("explore", "precheck"):
            with self.subTest(purpose=purpose):
                self.assertEqual(self.code(trial, source("root"), start - timedelta(seconds=30),
                                           start + timedelta(milliseconds=1), purpose), "OUT_OF_SAMPLE_RESERVED")
        self.assertEqual(self.world.seq(), seq)
        trial(source("root"), end, end + timedelta(seconds=1))  # touching the last window is outside it
        trial(self.unrun["source"], start, end)  # another candidate's source
        self.bind("released")
        trial(source("root"), start, end)

    def test_the_replay_must_match_the_registration_in_every_identity(self):
        root = source("root")
        plain = self.git_root / "plain"
        plain.mkdir()
        self.assertEqual(self.refused_bind("checks", checkout_root=plain), "STALE_CHECKOUT")
        with seams.use(require_main_build=lambda identity, inspection: (_ for _ in ()).throw(
                Refusal("RUNTIME_NOT_MAIN", "not a main build", write_status="not_written"))):
            self.assertEqual(self.code(validation.validation_bind, self.conn, 1, 1, sha(root), IDENTITY, {},
                                       market=self.world.market, checkout=self.checkout), "RUNTIME_NOT_MAIN")
        other_image = {**IDENTITY, "image_digest": "sha256:" + "c" * 64}
        self.assertEqual(self.refused_bind("checks", identity=other_image), "RUNTIME_NOT_MAIN")
        self.assertEqual(self.refused_bind(999_999), "REGISTRATION_UNKNOWN")
        self.assertEqual(self.refused_bind("checks", purpose="research"), "BINDING_NOT_ALLOWED")
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
