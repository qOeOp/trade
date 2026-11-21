"""Live admission's Paper reconciliation (doctor 20261120-06; decided 2026-11-21 in
docs/plans/stored-fields.zh.md).

Live prepares a run only for a candidate with a reconciled Paper run: a sealed, complete run (ledger.run_journal.verdict) of
the same source on the same contracts, whose image runs Live's replay code (live.admission.replay_code), not held after an
interruption (paper.compare.held_since), whose `paper compare` on the archive (never the preliminary REST overlay) has
at least one order group, no group whose difference is `unexplained`, no look-ahead suspect and no unexplained equity
minute (`unreconciled`). Leverage need not match, and no duration is required.

Nothing is stored. The serving control derives it in the background (`Reconciliation`): it lists the matching runs in
the Paper database through its reader profile and compares each in a child container of its own image (`live
paper-compare`, `compare_one`, under the root's paper-compare.lock in paper-compare-tmp/), whose standard output returns
the result to the control's memory. A restart, each release included, derives it again. Preparation, which runs in
`live web-command`, asks the serving control over its socket (`require`) and refuses LIVE_PAPER_UNRECONCILED, saying
why, until the answer is reconciled.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from contextlib import contextmanager
import fcntl
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from urllib.parse import quote

from engine.live_errors import LiveRefusal
from ledger import db
from shared.errors import Refusal
from live import admission, configuration, daily, runs, state


TMP = "paper-compare-tmp"
LOCK = "paper-compare.lock"
CONTAINER_SECONDS = 6 * 3600  # the control stops a comparison container still running after this
UNCOVERED = "the market does not cover the run's minutes yet"
NOT_READ = "the serving Live control has not finished comparing this candidate's Paper runs"


def unreconciled(result: Mapping) -> str | None:
    """Why a `paper compare` result (its comparison.json) does not reconcile the run, or None when it does."""
    summary = result.get("summary") or {}
    if result.get("data_source") != "archive" or result.get("preliminary"):
        return "the comparison read the preliminary REST minutes, not the archive"
    if (result.get("replay") or {}).get("status") != "passed" or summary.get("groups") is None:
        return "the replay did not pass or wrote no order events"
    if summary["groups"] < 1:
        return "the run and its replay have no order group"
    unexplained = sum((group or {}).get("cause") == "unexplained" for group in result.get("groups") or [])
    if unexplained:
        return f"{unexplained} order group(s) differ for no known cause"
    if summary.get("look_ahead_suspects"):
        return f"{summary['look_ahead_suspects']} look-ahead suspect(s)"
    if summary.get("equity_unexplained_minutes"):
        return f"{summary['equity_unexplained_minutes']} equity minute(s) differ for no known cause"
    return None


def _paper(paper_ledger: Path) -> db.LedgerProfile:
    return db.LedgerProfile.from_json(state.read(paper_ledger))


def matching(paper_ledger: Path, source_sha256: str, symbols: list[str]) -> list[dict]:
    """The sealed, complete Paper runs of this source on exactly these contracts, newest first, as
    {paper_id, image_ref}."""
    from ledger import paper as records, run_journal
    with db.connect(_paper(paper_ledger), "reader") as conn:
        found = [row for row in records.paper_runs(conn)
                 if row["source_sha256"] == source_sha256 and set(row["symbols"]) == set(symbols)
                 and row.get("seal") is not None and run_journal.verdict(row["seal"].get("reasons")) == "complete"]
    return [{"paper_id": row["paper_id"], "image_ref": row["image_ref"]}
            for row in sorted(found, key=lambda row: -row["paper_id"])]


@contextmanager
def _exclusive(root: Path):
    descriptor = os.open(root / LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)  # one comparison at a time; a second waits
        yield


def compare_one(root: Path, paper_ledger: Path, market_root: Path, paper_id: int, *,
                compare: Callable[..., dict], held_since: Callable[[list[dict]], int | None]) -> dict:
    """live paper-compare: {paper_id, market_day, reason (None: reconciled), retry (the comparison was not done, such
    as when the market does not cover the run yet)} of one sealed Paper run, compared in a new working directory under
    paper-compare-tmp/, removed after. `compare` and `held_since` are paper.compare's (Paper sits beside Live in the
    package layers, so the command line passes them)."""
    from ledger import paper as records, run_journal
    root = Path(root).expanduser().absolute()
    profile = _paper(paper_ledger)
    with state.reading(root) as root, _exclusive(root):
        scratch = root / TMP
        if scratch.is_symlink():
            raise state.fail("LIVE_DIRECTORY", "the Paper comparison's working directory is a symbolic link")
        scratch.mkdir(mode=0o700, exist_ok=True)
        for path in scratch.iterdir():  # what a stopped comparison left
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path, ignore_errors=True)
        attempt = Path(tempfile.mkdtemp(prefix="paper-", dir=scratch))
        os.environ["TMPDIR"] = str(attempt)  # the stage containers mount what the replay writes here
        tempfile.tempdir = None
        try:
            with db.connect(profile, "reader") as conn:
                lines = run_journal.sealed_journal(records.paper_files(conn, paper_id, "events/"))
            if held_since(lines) is not None:
                return {"paper_id": paper_id, "market_day": None, "retry": False,
                        "reason": "the run was held after an interruption"}
            try:
                found = compare(profile, {"holds": "market", "root": str(market_root)}, None, paper_id,
                                attempt / "compare")
            except Refusal as exc:  # the comparison was not done: compared again after RETRY_NS
                return {"paper_id": paper_id, "market_day": None, "retry": True,
                        "reason": UNCOVERED if exc.code == "COMPARE_UNCOVERED" else f"{exc.code}: {exc.message}"}
            result = json.loads(Path(found["path"]).read_text(encoding="utf-8"))
            return {"paper_id": paper_id, "market_day": result["market_day"], "retry": False,
                    "reason": unreconciled(result)}
        finally:
            shutil.rmtree(attempt, ignore_errors=True)


def launch(config: configuration.Configuration, paper_id: int) -> dict:
    """Run `live paper-compare` of one run in a child container of this control's image (daily.launch_argv) and read
    its result; outside a container (the control run by hand) it compares nothing."""
    argv = ["live", "paper-compare", "--root", str(config.root), "--paper-ledger", str(config.paper_ledger),
            "--market-root", str(config.market_root), "--paper-id", str(paper_id)]
    identity = os.environ.get("HOSTNAME", "")
    if not daily.CONTAINER_MARK.exists() or not identity:
        return {"paper_id": paper_id, "market_day": None, "retry": False,
                "reason": "the Live control runs outside a container and compares no Paper run"}
    found = json.loads(subprocess.run(["docker", "inspect", "--type", "container", identity], capture_output=True,
                                      text=True, timeout=60, check=True).stdout)[0]
    command = daily.launch_argv(found, "trade-live-paper", argv)
    name = command[command.index("--name") + 1]
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=CONTAINER_SECONDS, check=False)
    except subprocess.TimeoutExpired:
        subprocess.run(["docker", "stop", name], capture_output=True, timeout=120, check=False)
        raise
    value = json.loads(done.stdout)
    if not isinstance(value, dict) or value.get("paper_id") != paper_id:
        raise ValueError("the Paper comparison container returned no result for its run")
    return value


Key = tuple[str, tuple[str, ...]]  # a source hash and the contracts, in the run's order


class Reconciliation:
    """The Paper reconciliation of each (source, contracts) asked about, derived in the background and held in memory
    only. Each run's comparison is kept for the control's life, except one that was not done (the market did not
    cover the run yet, a refusal), which is compared again after RETRY_NS; the runs matching a key are listed again at every check, so a run sealed later
    counts. The LIMIT most recently asked keys are kept."""

    RETRY_NS = 3600 * 1_000_000_000
    LIMIT = 32

    def __init__(self, compare: Callable[[configuration.Configuration, int], dict] = launch,
                 replay_code: Callable[[str, list[str]], dict | None] = admission.replay_code) -> None:
        self._compare, self._replay_code = compare, replay_code
        self._answers: dict[Key, dict | None] = {}
        self._compared: dict[int, dict] = {}
        self._codes: dict[tuple[str, tuple[str, ...]], dict | None] = {}  # a digest-pinned image's code never changes
        self._lock = threading.Lock()
        self._reading = False

    def view(self, key: Key) -> dict:
        with self._lock:
            found = self._answers.pop(key, None)
            self._answers[key] = found
            while len(self._answers) > self.LIMIT:
                del self._answers[next(iter(self._answers))]
        return found or {"state": "checking", "paper_id": None, "reasons": [NOT_READ]}

    def request(self, config: configuration.Configuration, key: Key) -> dict:
        """view(), and a check of the asked keys started now unless one is under way."""
        result = self.view(key)
        with self._lock:
            idle = not self._reading
            if idle:
                self._reading = True
        if idle:
            threading.Thread(target=self._run, args=(config,), daemon=True).start()
        return result

    def _run(self, config: configuration.Configuration) -> None:
        try:
            self.check(config)
        finally:
            with self._lock:
                self._reading = False

    def check(self, config: configuration.Configuration) -> None:
        """Answer every asked key once."""
        with self._lock:
            keys = list(self._answers)
        for key in keys:
            try:
                answer = self.answer(config, key)
            except Exception as exc:
                answer = {"state": "checking", "paper_id": None,
                          "reasons": [f"the Paper runs could not be read now ({type(exc).__name__})"]}
            with self._lock:
                if key in self._answers:
                    self._answers[key] = answer

    def _code(self, image_ref: str, symbols: tuple[str, ...]) -> dict | None:
        found = self._codes.get((image_ref, symbols))
        if found is None:
            found = self._replay_code(image_ref, runs._describe(list(symbols)))
            if found is not None:  # an image that cannot be read now is asked again next time
                self._codes[(image_ref, symbols)] = found
        return found

    def answer(self, config: configuration.Configuration, key: Key) -> dict:
        source_sha256, symbols = key
        live = self._code(config.runtime, symbols)
        found = [row for row in matching(config.paper_ledger, source_sha256, list(symbols))
                 if live is not None and self._code(row["image_ref"], symbols) == live]
        if not found:
            return {"state": "unreconciled", "paper_id": None,
                    "reasons": ["no sealed, complete Paper run of this source on these contracts runs Live's replay "
                                "code"]}
        reasons, waiting = [], False
        for row in found:
            result = self._compared.get(row["paper_id"])
            if result is None or (result["retry"] and time.monotonic_ns() - result["at"] >= self.RETRY_NS):
                result = {**self._compare(config, row["paper_id"]), "at": time.monotonic_ns()}
                self._compared[row["paper_id"]] = result
            if result["reason"] is None:
                return {"state": "reconciled", "paper_id": row["paper_id"], "reasons": []}
            waiting = waiting or result["retry"]
            reasons.append(f"Paper run {row['paper_id']}: {result['reason']}")
        return {"state": "checking" if waiting else "unreconciled", "paper_id": None, "reasons": reasons}


class _Connection(http.client.HTTPConnection):
    def __init__(self, path: Path):
        super().__init__("live-control", timeout=30)
        self._path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(self._path))


def ask(config: configuration.Configuration, candidate: str, symbols: list[str]) -> dict:
    """The serving control's answer for `candidate` (strategy_id@revision) on `symbols` (control.paper_view)."""
    strategy_id, revision = candidate.rsplit("@", 1)
    connection = _Connection(config.socket)
    try:
        connection.request("GET", f"/api/live/candidates/{quote(strategy_id)}/{revision}/paper/"
                                  + ",".join(quote(symbol) for symbol in symbols))
        body = json.loads(connection.getresponse().read())
    finally:
        connection.close()
    if not isinstance(body, dict) or body.get("ok") is not True or not isinstance(body.get("data"), dict):
        raise ValueError("the Live control gave no Paper reconciliation")
    return body["data"]


def require(config: configuration.Configuration, candidate: str, source_sha256: str, symbols: list[str]) -> None:
    """LIVE_PAPER_UNRECONCILED unless the serving control holds a reconciled Paper run of this source on `symbols`."""
    try:
        found = ask(config, candidate, symbols)
    except (OSError, ValueError, http.client.HTTPException, LiveRefusal):
        raise state.fail("LIVE_PAPER_UNRECONCILED", NOT_READ) from None
    if found.get("source_sha256") != source_sha256:
        raise state.fail("LIVE_PAPER_UNRECONCILED", "the candidate's source changed since the control compared it; "
                                                    + NOT_READ)
    if found.get("state") != "reconciled":
        raise state.fail("LIVE_PAPER_UNRECONCILED", "; ".join(found.get("reasons") or [NOT_READ]))
