"""A research world on a throwaway Dolt service for the registration tests: a research line,
published candidates, sealed native prechecks with independent reviews, and stand-ins for the
later-phase runtime, market and qualification seams. Never the active ledger.

`World.close()` stops the service and removes every directory the world (and the code under test,
through the patched temporary root) created.
"""

from __future__ import annotations

from datetime import date
import hashlib
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

from ledger import db, evidence, judgments, lines, strategies, trials
from ledger.refusals import refuse
from market import universe
from registration import precheck, register, seams
from tests.ledger.dolt import (IDENTITY, MARKET_COMMIT, RUNTIME, Service, context, market as line_market, reviewed,
                               sha, source)


OTHER_COMMIT = "n" * 32
DAY = 86_400 * 10**9
DEC31 = 1_767_139_200 * 10**9  # 2025-12-31T00:00:00Z
JAN = DEC31 + DAY
FEB = JAN + 31 * DAY
LINE_WINDOW = {"start": DEC31, "trade_start": JAN, "end": FEB}
RUNNER_ARGV = ["--start", "2025-12-31T00:00:00Z", "--trade-start", "2026-01-01T00:00:00Z", "--end",
               "2026-02-01T00:00:00Z"]
SYMBOLS = ["AAAUSDT", "BBBUSDT"]
MONTHS = ["2025-11", "2025-12", "2026-01", "2026-02"]
ACCOUNT = {"starting_balance_usdt": "100000", "oms_type": "NETTING", "fees": "assumed-v1"}
DESIGN = {"method": "paired-circular-log-mean-v1", "block_days": 5, "resamples": 999, "inner_resamples": 99,
          "seed": 7, "alpha": 0.05, "minimum_effect": 0.01, "design_reason": "five-day blocks for weekly cycles"}
OUTCOMES = {"improved": "refine further", "not_significant": "keep priority, change control",
            "loss": "lower priority", "zero_activity": "check the volume cap", "invalid": "fix and retry"}


def config(symbols=SYMBOLS, start="2025-12-31T00:00:00Z", trade_start="2026-01-01T00:00:00Z",
           end="2026-02-01T00:00:00Z", account=ACCOUNT, root="/tmp/export-somewhere") -> dict:
    """An effective configuration with the engine's window keys; the fixtures replay daily bars."""
    return {"runtime_contract": IDENTITY["runtime_contract"], "execution_bar_minutes": 1440, "start": start,
            "end": end, "trade_start": trade_start, "symbols": list(symbols), "account": dict(account),
            "market_root": root, "universe_path": root + "/membership.json"}


class FakeMarket:
    """A market database stand-in: commits hold (month, symbol) universe rows; exports write
    deterministic files under the (patched) temporary root."""

    database = "market"

    def __init__(self, commits: dict[str, list[tuple[str, str]]], timeframe: str = "1m"):
        self.commits, self.timeframe, self.exports = commits, timeframe, 0

    def resolve_commit(self, at):
        if at not in self.commits:
            raise refuse("MARKET_COMMIT_UNRESOLVED", f"no market commit {at!r}", missing=(str(at),))
        return at

    def universe_rule(self, commit):
        return "pool-v1"

    def universe_month(self, commit):
        return list(self.commits[commit])

    def membership_path(self, commit, window_end):
        return {"universe_rule": "pool-v1", "membership": universe.merge_months(
            [(date.fromisoformat(month + "-01"), symbol) for month, symbol in self.commits[commit]])}

    def export_catalogs(self, commit, symbols, start_ns, end_ns, episodes, lifecycle_files, fresh):
        self.exports += 1
        root = Path(tempfile.mkdtemp(prefix="export-"))
        receipts = {}
        for symbol in symbols:
            (root / symbol).mkdir()
            (root / symbol / "bars.parquet").write_bytes(f"{commit}:{symbol}:{start_ns}:{end_ns}".encode())
            receipts[symbol] = {"symbol": symbol, "commit": commit, "timeframe": self.timeframe, "start_ns": start_ns,
                                "end_ns": end_ns, "seconds": self.exports * 0.1}
            (root / symbol / "export.json").write_text(json.dumps(receipts[symbol], indent=1))
        for name, data in (lifecycle_files or {}).items():
            (root / "lifecycle-evidence" / name).parent.mkdir(parents=True, exist_ok=True)
            (root / "lifecycle-evidence" / name).write_bytes(data)
        return {"commit": commit, "root": root, "exported": len(symbols), "reused": 0, "seconds": 0.1,
                "receipts": receipts}

    def validate_lifecycle(self, body, commit, files):
        if not isinstance(body, dict) or body.get("market_commit") != commit:
            raise refuse("LIFECYCLE_INPUT", "the lifecycle manifest is bound to another market commit")
        return body.get("episodes", {})


def months_rows(months=MONTHS, symbols=SYMBOLS) -> list[tuple[str, str]]:
    return [(month, symbol) for month in months for symbol in symbols]


class Qualification:
    """A stand-in for qualification.require / assess: runs listed in `unavailable` lack evidence."""

    def __init__(self):
        self.unavailable: set[int] = set()

    def assess(self, conn, run, **options):
        available = run["run_id"] not in self.unavailable
        return {"economic_evidence_available": available, "reasons": [] if available else ["zero_fills"]}

    def require(self, conn, run):
        value = self.assess(conn, run)
        if not value["economic_evidence_available"]:
            raise refuse("ECONOMIC_EVIDENCE_UNAVAILABLE", f"run {run['run_id']} has no economic evidence",
                         missing=(str(run["run_id"]),))
        return value


def inspect_stand_in(identity, runner_argv, inputs):
    return {"runtime_contract": identity["runtime_contract"],
            "effective_config": config(symbols=inputs["symbols"], root=str(inputs["root"]))}


def product_write(conn, kind: str, bundle: str, files: dict[str, bytes]) -> None:
    db.write(conn, kind, {"bundle": bundle, "files": evidence.digests(files)}, "evidence_bundle",
             lambda c, op: evidence.write_files(c, bundle, files, op))


def capture(conn, trial_id: int, source_bytes: bytes, purpose: str = "precheck", native_exit: int = 0,
            audit_exit: int | None = 0, outcome: str = "completed", runtime_errors: bytes = b"",
            extra: dict[str, bytes] | None = None, fingerprint: dict | None = None) -> str:
    """Seal trial-<id>-execution in the capture format execution.seal_capture writes: execution.json
    listing every file with its status, length and hash; the source and the coverage receipt hashed."""
    files = {"native.stdout.txt": b"native ran\n", "native.stderr.txt": b"",
             "reports/runtime_failures.jsonl": runtime_errors, **(extra or {})}
    if audit_exit is not None:
        files.update({"audit.stdout.txt": b"audit ran\n", "audit/audit.json": b'{"passed": true}'})
    if fingerprint is not None:
        files["fingerprint/fingerprint.json"] = json.dumps(fingerprint, sort_keys=True, indent=2).encode() + b"\n"
    listed, stored = {}, {}
    for path, data in files.items():
        if data:
            listed[path] = {"status": "captured", "sha256": hashlib.sha256(data).hexdigest(), "length": len(data)}
            stored[path] = data
        else:
            listed[path] = {"status": "captured_empty"}
    if audit_exit is None:
        listed["audit.stdout.txt"] = {"status": "not_started"}
    start = evidence.load_bundle(conn, f"trial-{trial_id}-execution-start")["files"]
    coverage = start["input-coverage.json"]
    for path, data in (("source/strategy.py", source_bytes), ("input-coverage.json", coverage)):
        listed[path] = {"status": "hashed", "sha256": hashlib.sha256(data).hexdigest(), "length": len(data)}
    trial = conn.one("SELECT source_sha256, image_ref FROM trial WHERE trial_id = %s", (trial_id,))
    manifest = {"format": "execution_capture_v1", "trial_id": trial_id, "purpose": purpose,
                "source_sha256": trial["source_sha256"],
                "runtime_identity": json.loads(start["execution.json"])["runtime_identity"],
                "argv": ["python", "-m", "engine"],
                "stages": {"native": {"state": "exited", "exit_code": native_exit},
                           "audit": None if audit_exit is None else {"state": "exited", "exit_code": audit_exit},
                           **({"fingerprint": {"state": "exited", "exit_code": 0}}
                              if fingerprint is not None else {})},
                "outcome": {"kind": outcome, "detail": None}, "files": listed}
    stored["execution.json"] = db.canonical_json(manifest).encode()
    product_write(conn, "seal_fixture", f"trial-{trial_id}-execution", stored)
    return f"trial-{trial_id}-execution"


def coverage_bytes(effective_config: dict, receipts: dict | None = None, input_identity: dict | None = None) -> bytes:
    """input-coverage.json: the effective configuration, the export receipts by symbol and (when
    given) the input identity, as replay.input_coverage writes them."""
    value = {"format": "execution-input-coverage-v1", "effective_config": effective_config,
             "export_receipts": receipts or {}}
    if input_identity is not None:
        value["input_identity"] = input_identity
    return json.dumps(value).encode()


class World:
    """One service, one research ledger and a selected line; helpers build the records around it."""

    def __init__(self, name: str = "registration"):
        self.service = Service()
        try:
            self.tmp = self.service.root / "tmp"
            self.tmp.mkdir()
            self._tempdir = patch.object(tempfile, "tempdir", str(self.tmp))
            self._tempdir.start()
            self.market = FakeMarket({MARKET_COMMIT: months_rows(), OTHER_COMMIT: months_rows()})
            self.qualification = Qualification()
            self._seams = seams.use(resolve_runtime=lambda ref: dict(IDENTITY), inspect_runtime=inspect_stand_in,
                                    market=lambda profile: profile, qualification_require=self.qualification.require,
                                    qualification_assess=self.qualification.assess)
            self._seams.__enter__()
            self.profile = self.service.ledger(name)
            self.conn = db.connect(self.profile, "writer")
            strategies.publish_candidate(self.profile, source("root"), "rsi", "Fixture", "the line's start")
            self.line = lines.select_line(self.conn, "market", MARKET_COMMIT, date(2026, 1, 1), date(2026, 2, 1),
                                          "rsi@1", slug="rsi-root", market=line_market(latest_complete_day=date(2026, 3, 31)),
                                          reviews=reviewed(source("root")))
            self.counter = 0
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        try:
            if getattr(self, "conn", None) is not None:
                self.conn.close()
            if getattr(self, "_seams", None) is not None:
                self._seams.__exit__(None, None, None)
            if getattr(self, "_tempdir", None) is not None:
                self._tempdir.stop()
        finally:
            self.service.close()

    # Candidates and prechecks

    def publish(self, tag: str, parent: str | None = "rsi@1", difference: str | None = "cap volume at 5%") -> dict:
        data = source(tag)
        published = strategies.publish_candidate(self.profile, data, "rsi", "Fixture", f"variant {tag}",
                                                 parent=parent, difference=difference if parent else None)
        return {**published, "source": data}

    def workdir(self) -> str:
        self.counter += 1
        return f"/tmp/replay-{self.counter}"

    def open_precheck(self, data: bytes, identity_overrides: dict | None = None, effective_config: dict | None = None,
                      runtime: dict | None = None, days: int = 2) -> int:
        """A precheck trading `days` days from 2026-01-06."""
        identity = {"market_database": "market", "market_commit": MARKET_COMMIT, "universe_rule": "pool-v1",
                    "symbols": ["AAAUSDT"], "export_content_sha256": "e" * 64, **(identity_overrides or {})}
        effective = effective_config or config(symbols=["AAAUSDT"], start="2026-01-05T00:00:00Z",
                                               trade_start="2026-01-06T00:00:00Z", end="2026-01-08T00:00:00Z")
        return trials.open_trial(self.conn, "precheck", sha(data), runtime or RUNTIME,
                                 {"identity": identity, "input_coverage": coverage_bytes(effective)},
                                 {"start": JAN + 4 * DAY, "trade_start": JAN + 5 * DAY, "end": JAN + (5 + days) * DAY},
                                 context(data, self.workdir()))["trial_id"]

    def review_body(self, trial_id: int, verdict: str = "passed", **items) -> dict:
        body = {"trial_id": trial_id, "verdict": verdict}
        for item in precheck.ITEMS:
            body[item] = items.get(item, {"status": "passed", "note": f"{item} checked against the capture"})
        return body

    def prechecked(self, data: bytes, days: int = 2, **capture_options) -> str:
        """Precheck, seal and review a source; returns the review bundle."""
        trial_id = self.open_precheck(data, days=days)
        capture(self.conn, trial_id, data, **capture_options)
        return precheck.record_review(self.profile, self.review_body(trial_id), "reviewer-b")["bundle"]

    # Registrations

    def body(self, grid: list[str], reviews: dict[str, str], parent: str | None = None, control_run: int | None = None,
             change: str | None = None, duties: list[str] | None = None, **overrides) -> dict:
        mechanism = [{"slice": "capital_scaled", "measure": "unit_return", "direction": "up", "duty": duty,
                      "reason": "smaller orders fill closer to the signal"} for duty in (duties or [])]
        body = {"prediction": {"mechanism": mechanism, "outcomes": dict(OUTCOMES)},
                "changed_duties": list(duties or []), "parent": parent, "control_run": control_run, "change": change,
                "rationale": {"external": "", "local": "the parent fills large orders late",
                              "conjecture": "capacity limits the edge"},
                "sources": [], "comparison": dict(DESIGN),
                "grid": [{"candidate": ref, "params": {"cap": index}} for index, ref in enumerate(grid)],
                "conditions": "the full pool in the development window",
                "window": {"trade_start": "2026-01-01", "trade_end": "2026-02-01"}, "prechecks": dict(reviews)}
        body.update(overrides)
        return body

    def register(self, bundle: str, body: dict, **kwargs) -> dict:
        return register.register(self.profile, bundle, body, None, kwargs.pop("market", self.market),
                                 kwargs.pop("runner_argv", RUNNER_ARGV), **kwargs)

    def plan(self, bundle: str) -> dict:
        return register.load_plan(self.conn, bundle)[0]

    def research_trial(self, bundle: str, data: bytes, execution: dict | None = None, window: dict | None = None,
                       binder=None, runtime: dict | None = None) -> int:
        """Open a research trial bound through registration.bind, recording `execution` (default: the
        registered one) in its start receipt; returns its trial ID."""
        actual = execution or self.plan(bundle)["execution"]
        return trials.open_trial(
            self.conn, "research", sha(data), runtime or RUNTIME,
            {"identity": actual["input_identity"],
             "input_coverage": coverage_bytes(actual["effective_config"], input_identity=actual["input_identity"])},
            window or LINE_WINDOW, context(data, self.workdir()), binder or register.binder(bundle, sha(data)))["trial_id"]

    def seal_run(self, trial_id: int, status: str = "passed") -> int:
        def insert(conn, op):
            passed = status == "passed"
            conn.rows("INSERT INTO run (trial_id, status, failure_reasons, audit, fingerprints, op_id, created_at) "
                      "VALUES (%s, %s, %s, '{}', %s, %s, UTC_TIMESTAMP(6))",
                      (trial_id, status, None if passed else '[{"code": "AUDIT"}]', '{}' if passed else None, op))
            (run_id,), = conn.rows("SELECT LAST_INSERT_ID()")
            return {"run_id": run_id}
        return db.write(self.conn, "ingest_fixture", {"trial_id": trial_id}, "run", insert)["record"]["run_id"]

    def judge(self, kind: str, subjects=None) -> int:
        from report import status
        return judgments.add_judgment(self.profile, kind, self.line["bundle"], db.head_commit(self.conn),
                                      f"{kind} fixture", subjects=subjects,
                                      compared=lambda line, at: status.compared_candidates(self.profile, line, at))[
            "judgment_id"]

    def seq(self) -> int:
        return self.service.sql(self.profile, "SELECT seq FROM ledger_head")[0][0]
