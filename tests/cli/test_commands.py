"""The command line driven as subprocesses: a temporary ledger made by `ledger temp`, a throwaway market
database with one contract, stand-in runtime images and containers (tests/cli/standin.py), and every
declared command with its JSON result or its coded refusal and catalogue repair. Never the active
ledger."""

from __future__ import annotations

from datetime import date
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np

from ledger import db
from ledger.refusals import refusal_catalogue
from tests.market.dolt import BINARY, SKIP, TemporaryMarket, seed
from tests.replay.world import clean_checkout


ROOT = Path(__file__).resolve().parents[2]
NOT_TEMPORARY = Path.home() / "trade-cli-test-not-temporary"  # never created: the refusal comes first
MINUTE = 60_000
DAY = 86_400_000
FIRST = 1_766_534_400_000  # 2025-12-24T00:00:00Z
END = 1_769_904_000_000  # 2026-02-01T00:00:00Z
RUNNER = ["--start", "2025-12-31T00:00:00Z", "--trade-start", "2026-01-01T00:00:00Z", "--end", "2026-02-01T00:00:00Z"]
PRECHECK = ["--start", "2026-01-05T00:00:00Z", "--trade-start", "2026-01-06T00:00:00Z", "--end",
            "2026-01-08T00:00:00Z"]
DESIGN = {"method": "paired-circular-log-mean-v1", "block_days": 5, "resamples": 999, "inner_resamples": 99,
          "seed": 7, "alpha": 0.05, "minimum_effect": 0.01, "design_reason": "five-day blocks for weekly cycles"}
OUTCOMES = {"improved": "refine further", "not_significant": "keep priority, change control",
            "loss": "lower priority", "zero_activity": "check the volume cap", "invalid": "fix and retry"}
SOURCE = ('"""A command line fixture strategy."""\nfrom nautilus_trader.trading import Strategy\n\n\n'
          'class Fixture(Strategy):\n    pass\n')
CHILD_RETURNS = [0.004, -0.001, 0.002, 0.003, -0.002, 0.001]


def _fill_market(profile: dict) -> None:
    """BTCUSDT one-minute LAST and MARK bars from 2025-12-24 to 2026-02-01, funding, and the January universe."""
    count = (END - FIRST) // MINUTE
    i = np.arange(count)
    price = (100000 + (i % 997) / 10) * 10**8
    columns = {"ts_open": FIRST + i * MINUTE, **{name: price.astype(np.int64) for name in ("open", "high", "low", "close")}}
    bars = {("BTCUSDT", "LAST"): {**columns, "volume": np.where(i % 5 != 0, 15_000, 0).astype(np.int64)},
            ("BTCUSDT", "MARK"): {**columns, "volume": np.zeros(count, np.int64)}}
    seed(profile, month="2026-01", through="2026-02-01", terms=[("BTCUSDT", {"price_increment": "0.10",
                                                                            "size_increment": "0.001"})],
         bars=bars, funding={"BTCUSDT": [(FIRST + 8 * 3_600_000 * k, "0.0001") for k in range(3 * 39)]},
         members=[(date(2026, 1, 1), "BTCUSDT")])  # the commit test: a member traded on its month's eve


@unittest.skipUnless(BINARY, SKIP)
class CommandTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.market = TemporaryMarket(kind="active")  # the default market of the commands below
        cls.addClassCleanup(cls.market.close)
        _fill_market(cls.market.profile)
        cls.tmp = Path(tempfile.mkdtemp(prefix="cli-", dir="/tmp"))
        cls.addClassCleanup(shutil.rmtree, cls.tmp, True)
        cls.checkout = clean_checkout(cls.tmp / "checkout")
        cls.env = {**os.environ, "TMPDIR": str(cls.tmp), "TRADE_LEDGER_HOME": str(cls.market.service.home),
                   "CLI_STANDIN_CHECKOUT": str(cls.checkout), "RESEARCH_DOLT_BINARY": BINARY}
        created = cls.ok("ledger", "temp")
        cls.ledger, cls.ledger_root = created["profile"], Path(created["root"])
        cls.addClassCleanup(cls.stop_temp)

    @classmethod
    def stop_temp(cls):
        cls.call("ledger", "service", "stop", "--ledger", cls.ledger)
        shutil.rmtree(cls.ledger_root, ignore_errors=True)

    @classmethod
    def call(cls, *argv, standin: bool = True, scenario: dict | None = None, env: dict | None = None):
        environment = {**cls.env, **(env or {}), "CLI_STANDIN_SCENARIO": json.dumps(scenario or {})}
        module = "tests.cli.standin" if standin else "cli.main"
        done = subprocess.run([sys.executable, "-m", module, *argv], cwd=ROOT, env=environment, capture_output=True,
                              text=True, timeout=600)
        out = json.loads(done.stdout) if done.stdout.strip() else None
        try:
            err = json.loads(done.stderr) if done.stderr.strip().startswith("{") else done.stderr
        except ValueError:
            err = done.stderr
        return done.returncode, out, err

    @classmethod
    def ok(cls, *argv, **options):
        code, out, err = cls.call(*argv, **options)
        if code != 0:
            raise AssertionError(f"{' '.join(argv)} exited {code}: {err}")
        return out

    def refused(self, code: str, *argv, **options) -> dict:
        exit_code, out, err = self.call(*argv, **options)
        self.assertEqual(exit_code, 1, f"{argv}: {out} {err}")
        self.assertIsInstance(err, dict, err)
        self.assertEqual(err["code"], code, err)
        self.assertEqual(err["next_actions"], refusal_catalogue(code)["next_actions"])
        self.assertIn(err["write_status"], ("not_written", "unknown", "written"))
        return err

    def write(self, name: str, value) -> str:
        path = self.tmp / name
        path.write_text(value if isinstance(value, str) else json.dumps(value), encoding="utf-8")
        return str(path)

    def review_items(self, name: str) -> str:
        return self.write(name, {item: {"status": "passed", "note": f"{item} read from the sealed precheck"}
                                 for item in ("api", "causal", "activity", "readiness")})

    def body(self, ref: str, review: str, **overrides) -> dict:
        body = {"prediction": {"mechanism": [], "outcomes": dict(OUTCOMES)}, "changed_duties": [], "parent": None,
                "control_trial_id": None, "change": None,
                "rationale": {"external": "", "local": "", "conjecture": "a fixture rule earns its keep"},
                "sources": [], "comparison": dict(DESIGN),
                "grid": [{"candidate": ref, "params": {}}], "conditions": "one contract, the development window",
                "window": {"trade_start": "2026-01-01", "trade_end": "2026-02-01"}, "prechecks": {ref: review}}
        body.update(overrides)
        return body

    def prechecked(self, ref: str, name: str) -> str:
        """replay precheck and source review of a published candidate; returns the review bundle."""
        found = self.ok("replay", "precheck", "--ledger", self.ledger, "--at", "main", "--candidate", ref,
                        "--runtime", "stand-in:main", "--output", str(self.tmp / f"precheck-{name}"), "--", *PRECHECK)
        self.assertEqual((found["purpose"], found["status"]), ("precheck", "passed"))
        reviewed = self.ok("source", "review", "--ledger", self.ledger, "--candidate", ref, "--runtime", "stand-in:main",
                           "--precheck-trial", str(found["trial_id"]), "--verdict", "passed",
                           "--items", self.review_items(f"items-{name}.json"), "--reviewer", "reviewer-b")
        self.assertEqual(reviewed["precheck_trial"], found["trial_id"])
        return reviewed["bundle"]

    def test_a_research_line_from_selection_to_the_comparison(self):
        ledger = ("--ledger", self.ledger)
        # Service and reads
        status = self.ok("ledger", "service", "status", *ledger)
        self.assertTrue(status["running"])
        found = self.ok("ledger", "sql", *ledger, "SELECT version FROM ledger_schema")
        self.assertEqual((found["columns"], found["rows"]), (["version"], [[db.SCHEMA_VERSION]]))
        explained = self.ok("ledger", "sql", *ledger, "EXPLAIN SELECT * FROM trial WHERE purpose = 'explore'")
        self.assertTrue(explained["rows"])
        estimates = [explained["columns"].index(name) for name in ("rows", "filtered")]
        self.assertTrue(any(row[index] is None for row in explained["rows"] for index in estimates))
        self.assertEqual(self.ok("ledger", "sql", *ledger, "SELECT 'NULL' AS literal, NULL AS absent, 7 AS n")["rows"],
                         [["NULL", None, 7]], "EXPLAIN compatibility does not change ordinary query types")
        self.refused("WRITE_VIA_SQL", "ledger", "sql", *ledger, "DELETE FROM candidate")
        self.refused("WRITE_VIA_SQL", "ledger", "sql", *ledger, "SELECT 1; SELECT 2")
        self.assertEqual(self.ok("ledger", "sql", *ledger, "SELECT REPLACE('a-b', '-', '') AS joined")["rows"],
                         [["ab"]], "a read is never refused for a keyword inside it")
        failed = self.refused("SQL_STATEMENT_FAILED", "ledger", "sql", *ledger, "SELECT bundle_name FROM evidence_bundles")
        self.assertIn("evidence_bundles", failed["message"], "the server's own text")
        state = self.ok("research", "state", *ledger)
        self.assertEqual((state["line"], state["next_actions"]), (None, ["Select the user's research line with "
                                                                          "`line select`."]))

        # Candidates
        root_file = self.write("root.py", SOURCE)
        root = self.ok("candidate", "publish", *ledger, "--file", root_file, "--strategy-id", "fixture",
                       "--entry-class", "Fixture", "--description", "the line's root")
        self.assertEqual((root["candidate"], root["parent"], root["replayed"]), ("fixture@1", None, False))
        self.refused("SOURCE_EXISTS", "candidate", "publish", *ledger, "--file", root_file, "--strategy-id", "other",
                     "--entry-class", "Fixture", "--description", "same bytes")
        link = self.tmp / "link.py"
        link.symlink_to(root_file)
        self.refused("SOURCE_UNREADABLE", "candidate", "publish", *ledger, "--file", str(link), "--strategy-id",
                     "fixture", "--entry-class", "Fixture", "--description", "a link")
        shown = self.ok("candidate", "show", *ledger, "--candidate", "fixture@1")
        self.assertEqual((shown["source_sha256"], shown["parent"]), (root["source_sha256"], None))
        self.assertNotIn("source", shown)
        self.refused("UNKNOWN_CANDIDATE", "candidate", "show", *ledger, "--candidate", "fixture@9")
        self.refused("BAD_REF", "candidate", "show", *ledger, "--candidate", "fixture")
        exported = self.ok("candidate", "export", *ledger, "--candidate", "fixture@1",
                           "--output", str(self.tmp / "work" / "strategy.py"))
        self.assertEqual(Path(exported["path"]).read_text(), SOURCE)
        self.refused("PATH_EXISTS", "candidate", "export", *ledger, "--candidate", "fixture@1",
                     "--output", exported["path"])
        notes = Path(exported["path"]).parent / "AGENTS.md"
        original_notes = notes.read_bytes()
        collision = Path(exported["path"]).with_name("another.py")
        refused = self.refused("PATH_EXISTS", "candidate", "export", *ledger, "--candidate", "fixture@1",
                               "--output", str(collision))
        self.assertIn("fresh working directory", refused["message"])
        self.assertFalse(collision.exists())
        self.assertEqual(notes.read_bytes(), original_notes)
        self.refused("NOT_TEMPORARY_PATH", "candidate", "export", *ledger, "--candidate", "fixture@1",
                     "--output", str(NOT_TEMPORARY / "strategy.py"))

        # Evidence
        added = self.ok("evidence", "add", *ledger, "--bundle", "note-1", "--note", "why this line")
        self.assertEqual((added["write_status"], list(added["files"])), ("written", ["note.md"]))
        self.assertEqual(self.ok("evidence", "add", *ledger, "--bundle", "note-1", "--note", "why this line")[
            "write_status"], "replayed")
        self.refused("EMPTY_EVIDENCE", "evidence", "add", *ledger, "--bundle", "note-2")
        self.refused("RESERVED_BUNDLE", "evidence", "add", *ledger, "--bundle", "registration-x", "--note", "n")
        out = self.ok("evidence", "export", *ledger, "--bundle", "note-1", "--output", str(self.tmp / "note-1"))
        self.assertEqual((self.tmp / "note-1" / "note.md").read_text(), "why this line")
        self.assertEqual(out["files"][0]["name"], "note.md")

        # The line
        self.refused("WINDOW_INVALID", "line", "select", *ledger, "--start", "fixture@1", "--window-start", "2026-1-1",
                     "--window-end", "2026-02-01", "--slug", "fixture-trend")
        self.refused("WINDOW_OUT_OF_COVERAGE", "line", "select", *ledger, "--start", "fixture@1",
                     "--window-start", "2026-01-01", "--window-end", "2026-03-01", "--slug", "fixture-trend")
        selection = ("line", "select", *ledger, "--start", "fixture@1", "--window-start", "2026-01-01",
                     "--window-end", "2026-02-01", "--note", "the user's choice", "--slug", "fixture-trend")
        self.refused("START_REVIEW_REQUIRED", *selection)

        # Market facts and the lifecycle bundle
        coverage = self.ok("market", "coverage", "--start", "2025-12-31T00:00:00Z", "--end", "2026-01-02T00:00:00Z")
        commit = coverage["commit"]
        self.assertEqual((coverage["scope"]["symbols"], coverage["scope"]["expanded"]), (["BTCUSDT"], True))
        self.assertEqual(coverage["coverage"][0]["last"]["missing_minutes"], 0)
        manifest = self.write("lifecycle.json", {"format": "native-lifecycle-v1", "market_commit": commit, "episodes": [
            {"symbol": "BTCUSDT", "instrument_id": "BTCUSDT-E1-PERP.BINANCE", "start_ns": 0, "sources": ["notice.txt"],
             "events": []}]})
        notice = self.write("notice.txt", "the exchange notice")
        written = self.ok("market", "lifecycle", *ledger, "--manifest", manifest, "--notice", notice)
        self.assertEqual((written["bundle"], written["episodes"]), (f"lifecycle-{commit}", {"BTCUSDT": 1}))
        self.refused("LIFECYCLE_INPUT", "market", "lifecycle", *ledger, "--manifest", manifest)
        listed = self.ok("market", "coverage", "--symbols", "BTCUSDT", "--start", "2025-12-31T00:00:00Z",
                         "--end", "2026-01-02T00:00:00Z", *ledger, "--lifecycle-bundle", written["bundle"])
        self.assertEqual((listed["lifecycle_missing"], len(listed["lifecycle"]["BTCUSDT"])), ([], 1))
        self.refused("INTERVAL_INVALID", "market", "coverage", "--symbols", "BTCUSDT", "--start",
                     "2025-12-31T00:00:30Z", "--end", "2026-01-02T00:00:00Z")
        bars = ("market", "bars", "--symbol", "BTCUSDT", "--start", "2026-01-01T00:00:00Z", "--end",
                "2026-01-03T00:00:00Z")
        page = self.ok(*bars, "--at", commit[:12])
        jan = FIRST + 8 * DAY
        self.assertEqual((page["commit"], page["bars"]["count"], page["next_start"], page["funding"]["count"]),
                         (commit, 1440, "2026-01-02T00:00:00Z", 3))
        self.assertEqual(page["bars"]["rows"][0], [jan, jan + MINUTE - 1, *["100055.30000000"] * 4, "0.0000"])
        whole = self.ok(*bars, "--output", str(self.tmp / "bars.json"))
        self.assertEqual((whole["bars"], whole["next_start"]), ({"columns": page["bars"]["columns"], "count": 2880}, None))
        written = json.loads(Path(whole["output"]).read_text(encoding="utf-8"))
        self.assertEqual((len(written["bars"]["rows"]), written["bars"]["rows"][:1440], written["funding"]["count"]),
                         (2880, page["bars"]["rows"], 6))
        daily = self.ok(*bars, "--timeframe", "1d")
        self.assertEqual([row[:2] for row in daily["bars"]["rows"]], [[jan, jan + DAY - 1], [jan + DAY, jan + 2 * DAY - 1]])
        self.refused("PATH_EXISTS", *bars, "--output", whole["output"])
        self.refused("NOT_TEMPORARY_PATH", *bars, "--output", str(NOT_TEMPORARY / "bars.json"))
        self.refused("USAGE_ERROR", *bars, "--timeframe", "1d", "--price-type", "MARK")
        self.refused("NO_TERMS", "market", "bars", "--symbol", "ZZZUSDT", "--start", "2026-01-01T00:00:00Z", "--end",
                     "2026-01-02T00:00:00Z")
        self.refused("MONTH_INVALID", "market", "import", "--month", "2026-13")
        self.refused("MONTH_EXISTS", "market", "import", "--month", "2026-01")
        self.refused("MONTH_EXISTS", "market", "import", "--month", "2025-12")  # the January import's warm-up rows
        self.refused("MONTH_INVALID", "market", "import", "--month", "2025-11")

        # An exploration
        explored = self.ok("replay", "explore", *ledger, "--strategy-file", self.write("draft.py", SOURCE + "# draft\n"),
                           "--strategy-class", "Fixture", "--output", str(self.tmp / "explore"), "--", *PRECHECK)
        self.assertEqual((explored["purpose"], explored["status"]), ("explore", "passed"))
        self.refused("RUNNER_OPTION_RESERVED", "replay", "explore", *ledger, "--strategy-file", root_file,
                     "--strategy-class", "Fixture", "--output", str(self.tmp / "explore-2"), "--", *PRECHECK,
                     "--output", "/x")
        directory = self.ok("replay", "report", *ledger, "--directory", str(self.tmp / "explore"))
        self.assertEqual((directory["source"], directory["availability"]["unverified"]),
                         ("directory", "unsealed, source unverified, not evidence"))

        # The root: precheck, review, registration and the sealed replay
        root_review = self.prechecked("fixture@1", "root")
        line = self.ok(*selection)
        self.assertRegex(line["bundle"], r"\Aresearch-line-[0-9]{8}-fixture-trend\Z")
        self.assertEqual((line["created"], line["market_commit"]), (True, commit))
        self.refused("PRECHECK_NOT_FOUND", "source", "review", *ledger, "--candidate", "fixture@1", "--runtime",
                     "stand-in:main", "--precheck-trial", str(explored["trial_id"]), "--verdict", "passed",
                     "--items", self.review_items("items-x.json"), "--reviewer", "reviewer-b")
        registered = self.ok("registration", "add", *ledger, "--bundle", "registration-root",
                             "--body", self.write("root-body.json", self.body("fixture@1", root_review)),
                             "--", *RUNNER)
        self.assertEqual((registered["grid_points"], registered["replayed"]), (1, False))
        self.assertEqual([item["name"] for item in registered["files"]], ["research-plan.json"])
        leftovers = sorted(path.name for path in self.tmp.iterdir() if path.name.startswith(("market-export-",
                                                                                             "registration-inputs-")))
        self.assertEqual(leftovers, [])  # registration removes its fresh export and membership file
        self.refused("REGISTRATION_REQUIRED", "replay", "run", *ledger, "--at", commit, "--candidate", "fixture@1",
                     "--", *RUNNER)
        ran = self.ok("replay", "run", *ledger, "--at", commit, "--candidate", "fixture@1", "--hypothesis",
                      "registration-root", "--", *RUNNER)
        self.assertEqual((ran["purpose"], ran["status"]), ("research", "passed"))
        self.refused("GRID_ALREADY_ATTEMPTED", "replay", "run", *ledger, "--at", commit, "--candidate", "fixture@1",
                     "--hypothesis", "registration-root", "--", *RUNNER)
        report = self.ok("replay", "report", *ledger, "--trial-id", str(ran["trial_id"]))
        self.assertEqual(report["source"], "sealed")
        self.assertTrue(report["availability"]["economic_evidence_available"], report["availability"])
        tables = self.ok("replay", "report", *ledger, "--trial-id", str(ran["trial_id"]), "--tables")
        self.assertEqual(tables["tables"]["reconciled"]["closed_cycles"], 1)
        self.refused("UNKNOWN_RUN", "replay", "report", *ledger, "--trial-id", "99")

        # Judgments before the derived registration
        head = self.ok("ledger", "sql", *ledger, "SELECT DOLT_HASHOF('HEAD')")["rows"][0][0]
        judged = self.ok("judgment", "add", *ledger, "--kind", "interpretation", "--line", line["bundle"],
                         "--based-on", head, "--body", self.write("interpretation.md", "the root trades once"),
                         "--subject", f"role=about,trial={ran['trial_id']}")
        self.assertFalse(judged["replayed"])
        state = self.ok("research", "state", *ledger, "--history")
        self.assertEqual(state["judgment_history"]["entries"][0]["judgment_id"], judged["judgment_id"])
        older = self.ok("research", "state", *ledger, "--history-before", str(judged["judgment_id"]))
        self.assertEqual(older["judgment_history"]["entries"], [])

        # The child, registered against the root run as its control
        child_file = self.write("child.py", SOURCE.replace("pass", "WIDER = True"))
        child = self.ok("candidate", "publish", *ledger, "--file", child_file, "--strategy-id", "fixture",
                        "--entry-class", "Fixture", "--description", "the wider child", "--parent", "fixture@1",
                        "--difference", "widen the stop")
        self.assertEqual((child["candidate"], child["parent"]), ("fixture@2", "fixture@1"))
        child_review = self.prechecked("fixture@2", "child")
        mechanism = [{"slice": None, "measure": None, "direction": "up", "duty": "F3",
                      "reason": "no slice measures the stop"}]
        child_body = self.body("fixture@2", child_review, parent="fixture@1", control_trial_id=ran["trial_id"],
                               change="widen the stop", changed_duties=["F3"],
                               prediction={"mechanism": mechanism, "outcomes": dict(OUTCOMES)},
                               rationale={"external": "", "local": "the root's stop is hit early", "conjecture": ""})
        self.ok("registration", "add", *ledger, "--bundle", "registration-child",
                "--body", self.write("child-body.json", child_body), "--", *RUNNER)
        second = self.ok("replay", "run", *ledger, "--at", commit, "--candidate", "fixture@2", "--hypothesis",
                         "registration-child", "--", *RUNNER, standin=True, scenario={"returns": CHILD_RETURNS})
        self.assertEqual(second["status"], "passed")
        compared = self.ok("hypothesis", "compare", *ledger, "--bundle", "registration-child",
                           "--trial-id", str(second["trial_id"]))
        self.assertEqual((compared["trial_id"], compared["control_trial_id"]), (second["trial_id"], ran["trial_id"]))
        self.assertIn("evidence", compared)
        self.assertIn("attribution", compared)
        self.refused("RUN_NOT_IN_GRID", "hypothesis", "compare", *ledger, "--bundle", "registration-child",
                     "--trial-id", str(ran["trial_id"]))

        # Research facts and the candidate list
        counts = self.ok("research", "status", *ledger)
        self.assertEqual((counts["trials"], counts["research_attempts"]), (5, 2))  # an exploration, two prechecks
        state = self.ok("research", "state", *ledger)
        self.assertEqual((state["trials_on_line"], state["review_every"]), (2, 5))
        self.assertIn("fixture@1", counts["comparison"]["candidates"])
        candidates = self.ok("candidate", "list", *ledger)
        self.assertEqual([item["revision"] for item in candidates["candidates"]], [1, 2])
        self.assertEqual(len(candidates["candidates"][1]["attempts"]), 1)

        # Reproduction, out-of-sample registration, witness, recovery, review and export
        reproduced = self.ok("replay", "reproduce", *ledger, "--trial-id", str(ran["trial_id"]),
                             "--output", str(self.tmp / "reproduce"))
        self.assertTrue(reproduced["fingerprints_match"])
        validation = self.ok("validation", "registration", *ledger, "--candidate", "fixture@2",
                             "--window-start", "2030-01-01T00:00:00Z", "--window-end", "2030-02-01T00:00:00Z",
                             "--universe-rule", "usdt-perp-listed30d-v1", "--design", self.write("design.json", DESIGN),
                             "--tsa-url", "https://timestamp.example.invalid")
        self.assertEqual(validation["witness"]["status"], "failed")
        self.assertTrue(validation["next_actions"])
        self.refused("WINDOW_INVALID", "validation", "registration", *ledger, "--candidate", "fixture@2",
                     "--window-start", "2030-01-01T00:00:00+01:00", "--window-end", "2030-02-01T00:00:00Z",
                     "--universe-rule", "usdt-perp-listed30d-v1", "--design", self.write("design2.json", DESIGN))
        reported = self.ok("validation", "report", *ledger, "--registration-id", str(validation["registration_id"]))
        self.assertIsNone(reported["binding"])
        code, witnessed, err = self.call("ledger", "witness", *ledger, "--tsa-url", "https://timestamp.example.invalid")
        self.assertIsNotNone(witnessed, err)
        self.assertEqual((code, witnessed["checked"], len(witnessed["failed"])), (1, 1, 1))
        self.assertEqual(witnessed["failed"][0]["registration_ids"], [validation["registration_id"]])
        self.refused("RECOVERY_NOT_APPLICABLE", "execution", "recover", *ledger, "--trial-id", str(ran["trial_id"]),
                     "--workdir", str(self.tmp), "--failure-receipt", str(self.tmp / "none.json"))
        code, review, _ = self.call("ledger", "review", *ledger)
        self.assertIn("WITNESS_MISSING", {finding["code"] for finding in review["findings"]})  # the failed witness
        self.assertEqual(code, 1)
        self.assertEqual(review["runs_checked"], 2)
        self.refused("BACKUP_TARGET_UNSET", "ledger", "export", *ledger, "--kind", "backup")
        export = self.ok("ledger", "export", *ledger, "--kind", "reproduce", "--output", str(self.tmp / "export"))
        self.assertEqual(export["runs"], 2)
        self.assertTrue(Path(export["manifest_path"]).is_file())
        self.refused("PATH_EXISTS", "ledger", "export", *ledger, "--kind", "reproduce", "--output", str(self.tmp / "export"))

    def test_init_creates_a_profile_once_and_reads_it_back(self):
        home = self.tmp / "init-home"
        env = {"TRADE_LEDGER_HOME": str(home)}
        created = self.ok("ledger", "init", "--name", "probe-init", "--kind", "isolated", "--service-root",
                          str(self.tmp / "init-service"), env=env)
        self.addCleanup(self.call, "ledger", "service", "stop", "--ledger", created["profile"], env=env)
        self.assertEqual((created["database"], created["branch_grant"], created["schema_version"]),
                         ("probe_init", "main", db.SCHEMA_VERSION))
        self.assertEqual(created["accounts"], {"writer": "probe_init_writer", "reader": "probe_init_reader"})
        self.assertNotIn("password", json.dumps(created))
        self.refused("LEDGER_EXISTS", "ledger", "init", "--name", "probe-init", "--kind", "isolated", "--service-root",
                     str(self.tmp / "init-service"), env=env)
        self.assertFalse(self.ok("ledger", "service", "stop", "--ledger", "probe-init", env=env)["running"])
        self.assertFalse(self.ok("ledger", "service", "status", "--ledger", "probe-init", env=env)["running"])
        self.refused("LEDGER_UNAVAILABLE", "candidate", "list", "--ledger", "probe-init", env=env)
        self.assertTrue(self.ok("ledger", "service", "start", "--ledger", "probe-init", env=env)["running"])

    def test_market_init_records_a_backup_that_market_backup_syncs_and_market_review_checks(self):
        self.refused("BACKUP_TARGET_UNSET", "market", "backup")
        unchecked = self.ok("market", "review")
        self.assertEqual((unchecked["history"]["status"], len(unchecked["limitations"])), ("no_backup", 1))
        created = self.ok("market", "init", "--name", "market-kept", "--kind", "isolated", "--service-root",
                          str(self.market.service.service_root), "--backup-root", str(self.tmp / "market-kept"))
        self.assertEqual(json.loads(Path(created["profile"]).read_text())["backup"], str(self.tmp / "market-kept"))
        self.assertNotIn("password", json.dumps(created))
        copy = self.write("market-backed.json", {**self.market.profile, "role": "isolated",
                                                 "backup": str(self.tmp / "market-backup")})
        synced = self.ok("market", "backup", "--market", copy)
        checked = self.ok("market", "review", "--market", copy)
        self.assertEqual((checked["ok"], checked["history"]["status"], checked["history"]["head"]),
                         (True, "ancestor", synced["market_commit"]))

    def test_scaffolds_usage_and_refusals_outside_a_ledger(self):
        made = self.ok("candidate", "new", "--output", str(self.tmp / "scaffold"), "--strategy-id", "fresh",
                       "--entry-class", "Fresh")
        self.assertEqual(made["files"][0], "strategy.py")  # tests/cli/test_scaffold.py loads it natively
        self.refused("PATH_EXISTS", "candidate", "new", "--output", str(self.tmp / "scaffold"), "--strategy-id", "x")
        self.refused("NOT_TEMPORARY_PATH", "candidate", "new", "--output", str(NOT_TEMPORARY / "scaffold"), "--strategy-id", "x")
        self.refused("USAGE_ERROR", "nothing", "here")
        self.refused("USAGE_ERROR", "candidate", "publish", "--ledger", self.ledger)
        self.refused("USAGE_ERROR", "candidate", "list", "--ledger", self.ledger, "--", "--start", "x")
        self.refused("LEDGER_UNKNOWN", "candidate", "list", "--ledger", "no-such-profile")
        self.refused("NOT_TEMPORARY_PATH", "ledger", "temp", "--root", str(NOT_TEMPORARY / "ledger"))


if __name__ == "__main__":
    unittest.main()
