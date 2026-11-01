"""Paper runs on the host (`paper.start`, `paper.stop`, `paper.seal`, `paper.delete`, `paper.listing`).

Each run is two containers of the same digest-pinned runtime image on a Docker network of its own that
has no route out (`--internal`):

- the runner, ``python -m engine.paper``: the candidate's source, live Binance public data, Sandbox fills;
- the egress proxy, ``python -m engine.egress``: the one container also on the outbound bridge network,
  tunnelling to Binance's public USD-M hosts only.

Docker is called with an allowlisted environment and passes no variable into a container beyond the
image's own, so no credential of the host's shell can reach a run (docs/plans/paper-trading-design.zh.md
§3). The run is declared in the ledger before its containers start and sealed after they end; its working
directory lives beside the ledger's service (``<service>/paper/<database>/<paper_id>``) until it is sealed,
or deleted (the user's own: a sealed run leaves the ledger and its directory goes with it).
At most MAX_RUNNING runs per ledger run at once, and one per source.
"""

from __future__ import annotations

from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import uuid

from ledger import db, paper as records, strategies
from ledger.refusals import refuse
from runtime import container, image


MAX_RUNNING = 4
RUNNER_MEMORY = "4g"  # an uncalibrated example value
EGRESS_MEMORY = "256m"
EGRESS_PORT = 3128
STOP_SECONDS = 60  # the STOP file to SIGTERM: the runner cancels its orders and writes its summary
STOP_KILL_SECONDS = 30  # SIGTERM to SIGKILL
DOCKER_SECONDS = 120
EGRESS_START_SECONDS = 3
LOG_TAIL_LINES = "20000"
# The docker client's own variables; nothing else of the host's environment reaches it.
DOCKER_ENV = ("PATH", "HOME", "TMPDIR", "USER", "LANG", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT",
              "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY")
LABEL = "trade.paper"


def _docker(*argv: str, timeout: float = DOCKER_SECONDS) -> subprocess.CompletedProcess:
    env = {name: os.environ[name] for name in DOCKER_ENV if name in os.environ}
    try:
        return subprocess.run(["docker", *argv], capture_output=True, check=False, timeout=timeout, env=env)
    except subprocess.TimeoutExpired as exc:
        raise refuse("RUNTIME_UNAVAILABLE", f"docker {argv[0]} did not finish within {timeout:g} s",
                     missing=("docker",)) from exc


def _checked(*argv: str, timeout: float = DOCKER_SECONDS) -> str:
    found = _docker(*argv, timeout=timeout)
    if found.returncode:
        raise refuse("RUNTIME_UNAVAILABLE", f"docker {argv[0]} failed: {found.stderr.decode(errors='replace').strip()}",
                     missing=("docker",))
    return found.stdout.decode(errors="replace")


def ledger_key(profile: db.LedgerProfile) -> str:
    """The label value that tells one ledger's paper containers from another's on the same Docker host."""
    return hashlib.sha256(f"{profile.service_root.resolve()}\0{profile.database}".encode()).hexdigest()[:12]


def names(profile: db.LedgerProfile, paper_id: int) -> dict[str, str]:
    base = f"trade-paper-{ledger_key(profile)}-{paper_id}"
    return {"network": base, "runner": base + "-runner", "egress": base + "-egress"}


def run_dir(profile: db.LedgerProfile, paper_id: int) -> Path:
    return profile.service_root / "paper" / profile.database / str(paper_id)


def containers(profile: db.LedgerProfile) -> list[dict]:
    """This ledger's paper containers: {name, paper_id, role, source_sha256, running}."""
    found = _checked("ps", "--all", "--no-trunc", "--filter", f"label={LABEL}.ledger={ledger_key(profile)}",
                     "--format", "{{json .}}")
    result = []
    for line in found.splitlines():
        item = json.loads(line)
        labels = dict(pair.split("=", 1) for pair in item.get("Labels", "").split(",") if "=" in pair)
        result.append({"name": item["Names"], "paper_id": int(labels.get(f"{LABEL}.id", "0")),
                       "role": labels.get(f"{LABEL}.role"), "source_sha256": labels.get(f"{LABEL}.source"),
                       "running": item.get("State") == "running"})
    return result


def _membership(market: dict, at: str | None, symbols: list[str] | None, now_ns: int) -> tuple[str, dict, list[str]]:
    """The market commit, its membership object for the chosen contracts and the contracts: the given ones,
    or (symbols None) every member of the current month."""
    from market import store, universe
    with store.connect(market, "reader") as conn:
        commit = store.resolve_commit(conn, at)
        found = universe.membership_path(conn, commit, now_ns)
    members = found["membership"]
    if symbols is None:
        symbols = sorted(symbol for symbol, intervals in members.items()
                         if any(low <= now_ns < high for low, high in intervals))
        if not symbols:
            raise refuse("EMPTY_SYMBOLS", f"market commit {commit} has no member for the current month",
                         missing=("symbols",))
    if not symbols or len(set(symbols)) != len(symbols):
        raise refuse("EMPTY_SYMBOLS", "the contract list is empty or repeats a contract", missing=("symbols",))
    return commit, {"universe_rule": found["universe_rule"],
                    "membership": {symbol: members.get(symbol, []) for symbol in symbols}}, list(symbols)


def _run_containers(identity: dict, profile: db.LedgerProfile, row: dict, entry_class: str, directory: Path,
                    memory: str, duration_seconds: int | None) -> dict[str, str]:
    named = names(profile, row["paper_id"])
    labels = {f"{LABEL}.ledger": ledger_key(profile), f"{LABEL}.id": str(row["paper_id"]),
              f"{LABEL}.source": row["source_sha256"]}
    _checked("network", "create", "--internal", "--label", f"{LABEL}.ledger={ledger_key(profile)}",
             "--label", f"{LABEL}.id={row['paper_id']}", named["network"])
    egress = container.paper_command(identity, [(directory / "egress", container.REPORTS, False)], "engine.egress",
                                     ["--port", str(EGRESS_PORT), "--log", f"{container.REPORTS}/egress.log"],
                                     name=named["egress"], network=named["network"], memory=EGRESS_MEMORY,
                                     labels={**labels, f"{LABEL}.role": "egress"})
    _checked(*egress[1:])
    _checked("network", "connect", "bridge", named["egress"])
    time.sleep(EGRESS_START_SECONDS)
    if not _running(named["egress"]):
        raise refuse("RUNTIME_UNAVAILABLE", "the egress proxy exited at start: " + _logs(named["egress"]).decode(
            errors="replace")[-2000:], missing=(named["egress"],))
    fees = row["config"]["fees"]
    argv = ["--strategy-file", "/inputs/strategy.py", "--strategy-class", entry_class,
            "--strategy-sha256", row["source_sha256"], "--symbols", *row["symbols"],
            "--universe", "/inputs/universe.json", "--output", container.REPORTS,
            "--maker-fee", fees["maker"], "--taker-fee", fees["taker"],
            "--proxy-url", f"http://{named['egress']}:{EGRESS_PORT}"]
    if duration_seconds is not None:
        argv += ["--duration-seconds", str(duration_seconds)]
    runner = container.paper_command(identity, [(directory / "inputs", "/inputs", True),
                                                (directory / "out", container.REPORTS, False)], "engine.paper", argv,
                                     name=named["runner"], network=named["network"], memory=memory,
                                     labels={**labels, f"{LABEL}.role": "runner"})
    _checked(*runner[1:])
    return named


def _running(name: str) -> bool:
    found = _docker("inspect", "--format", "{{.State.Running}}", name)
    return found.returncode == 0 and found.stdout.strip() == b"true"


def _exit_code(name: str) -> int | None:
    found = _docker("inspect", "--format", "{{.State.ExitCode}}", name)
    return int(found.stdout.strip()) if found.returncode == 0 and found.stdout.strip().lstrip(b"-").isdigit() else None


def killed_before(profile: db.LedgerProfile, paper_id: int, at: float) -> bool:
    """Whether the run's runner was killed (exit 137) before `at`, in epoch seconds, and not for running out of
    its memory: Docker records a kill at the container's limit as OOMKilled (probed 2026-11-01)."""
    found = _docker("inspect", "--format", "{{json .State}}", names(profile, paper_id)["runner"])
    if found.returncode:
        return False
    state = json.loads(found.stdout)
    # FinishedAt is RFC 3339 with up to nine fractional digits; datetime keeps six.
    finished = re.sub(r"(\.\d{6})\d+", r"\1", state.get("FinishedAt") or "").replace("Z", "+00:00")
    try:
        ended = datetime.fromisoformat(finished).timestamp()
    except ValueError:
        return False
    return state.get("ExitCode") == 137 and not state.get("OOMKilled") and ended < at


def _logs(name: str) -> bytes:
    found = _docker("logs", "--tail", LOG_TAIL_LINES, name)
    return found.stdout + found.stderr if found.returncode == 0 else b""


def _remove(profile: db.LedgerProfile, paper_id: int) -> None:
    named = names(profile, paper_id)
    _docker("rm", "--force", named["runner"])
    _docker("rm", "--force", named["egress"])
    _docker("network", "rm", named["network"])


def start(profile: db.LedgerProfile, market: dict, at: str | None, candidate: str, symbols: list[str] | None,
          runtime: str | None, memory: str = RUNNER_MEMORY, duration_seconds: int | None = None,
          op_id: str | None = None) -> dict:
    """paper start: declare one run of a published candidate and start its containers; returns at once."""
    from market.instrument import ASSUMED
    with db.connect(profile, "reader") as conn:
        found = strategies.read_candidate(conn, candidate)
        if not records.held(conn):
            raise refuse("LEDGER_UPGRADE_REQUIRED", f"the ledger has no {records.TABLE} table",
                         missing=(records.TABLE,))
    identity = image.resolve(runtime)
    running = [item for item in containers(profile) if item["role"] == "runner" and item["running"]]
    if any(item["source_sha256"] == found["source_sha256"] for item in running):
        raise refuse("PAPER_RUN_ACTIVE", f"{candidate} already has a running paper run", missing=(candidate,))
    if len(running) >= MAX_RUNNING:
        raise refuse("PAPER_CONCURRENCY_LIMIT", f"{len(running)} paper runs are running; stop one first",
                     expected=f"at most {MAX_RUNNING} running paper runs")
    if duration_seconds is not None and duration_seconds < 1:
        raise refuse("USAGE_ERROR", "--duration-seconds must be positive")
    commit, membership, chosen = _membership(market, at, symbols, time.time_ns())
    config = {"execution": "paper-bars", "fees": {"maker": ASSUMED["maker_fee"], "taker": ASSUMED["taker_fee"]},
              "universe_rule": membership["universe_rule"], "memory": memory, "duration_seconds": duration_seconds,
              "candidate": candidate}
    with db.connect(profile, "writer") as conn:
        row = records.open_paper_run(conn, found["source_sha256"], identity["image_ref"], chosen, commit, config,
                                     op_id or f"paper-start:{uuid.uuid4().hex}")
    directory = run_dir(profile, row["paper_id"])
    if row["write_status"] == "replayed":
        return {"paper_id": row["paper_id"], "write_status": "replayed", "directory": str(directory)}
    for part in ("inputs", "out", "egress"):
        (directory / part).mkdir(parents=True, exist_ok=False)
    (directory / "inputs" / "strategy.py").write_bytes(found["source"])
    (directory / "inputs" / "universe.json").write_text(json.dumps(membership, sort_keys=True), encoding="utf-8")
    try:
        named = _run_containers(identity, profile, row, found["entry_class"], directory, memory, duration_seconds)
    except Exception as exc:
        sealed = seal(profile, row["paper_id"], start_error=f"{type(exc).__name__}: {exc}")
        raise refuse("PAPER_START_FAILED", f"paper run {row['paper_id']} did not start and was sealed invalid: {exc}",
                     missing=(sealed["bundle"],), write_status="written") from exc
    return {"paper_id": row["paper_id"], "candidate": candidate, "source_sha256": row["source_sha256"],
            "image_ref": identity["image_ref"], "symbols": chosen, "market_commit": commit,
            "directory": str(directory), "containers": named, "ledger_commit": row["ledger_commit"],
            "write_status": row["write_status"]}


def seal(profile: db.LedgerProfile, paper_id: int, start_error: str | None = None) -> dict:
    """paper seal: capture an ended run into the ledger, then remove its containers and network."""
    with db.connect(profile, "reader") as conn:
        row = records.read_paper_run(conn, paper_id)
        stored = records.seal_of(conn, paper_id)
    if stored is not None:  # its containers are gone, so a new capture would differ: the seal stands
        return {"paper_id": paper_id, "bundle": records.bundle_name(paper_id), "seal": stored,
                "write_status": "replayed"}
    named = names(profile, paper_id)
    if _running(named["runner"]):
        raise refuse("PAPER_RUN_ACTIVE", f"paper run {paper_id} is still running; stop it first",
                     missing=(str(paper_id),))
    directory = run_dir(profile, paper_id)
    runner_log = start_error.encode() if start_error else _logs(named["runner"])
    files = records.capture(row, directory / "out", directory / "egress" / "egress.log", runner_log,
                            None if start_error else _exit_code(named["runner"]), start_failed=start_error is not None)
    with db.connect(profile, "writer") as conn:
        sealed = records.seal_paper_run(conn, paper_id, files)
    _remove(profile, paper_id)
    return {"paper_id": paper_id, **sealed}


def stop(profile: db.LedgerProfile, paper_id: int, wait_seconds: int = STOP_SECONDS) -> dict:
    """paper stop: ask the runner to stop through its STOP file (it cancels its working orders, journals
    the cancels and writes its summary), SIGTERM it after `wait_seconds` and SIGKILL after STOP_KILL_SECONDS
    more, then seal the run. SIGTERM is only the fallback: the node then shuts down on its own as well,
    and the strategy no longer receives the cancels (measured 2026-10-25)."""
    with db.connect(profile, "reader") as conn:
        records.read_paper_run(conn, paper_id)
    named = names(profile, paper_id)
    if _running(named["runner"]):
        (run_dir(profile, paper_id) / "out" / "STOP").touch()
        env = {name: os.environ[name] for name in DOCKER_ENV if name in os.environ}
        try:
            subprocess.run(["docker", "wait", named["runner"]], capture_output=True, check=False,
                           timeout=wait_seconds, env=env)
        except subprocess.TimeoutExpired:
            _checked("stop", "--time", str(STOP_KILL_SECONDS), named["runner"],
                     timeout=STOP_KILL_SECONDS + DOCKER_SECONDS)
    return seal(profile, paper_id)


def delete(profile: db.LedgerProfile, paper_id: int) -> dict:
    """paper delete: remove a sealed run from the ledger (ledger.delete_paper_run), then its run directory."""
    found = records.delete_paper_run(profile, paper_id)
    shutil.rmtree(run_dir(profile, paper_id), ignore_errors=True)
    return found


def listing(profile: db.LedgerProfile) -> dict:
    """paper list: every declared run with its state (running, ended, sealed) and seal readings."""
    with db.connect(profile, "reader") as conn:
        rows = records.paper_runs(conn)
    live = {(item["paper_id"], item["role"]): item for item in containers(profile)}
    runs = []
    for row in rows:
        runner = live.get((row["paper_id"], "runner"))
        state = ("sealed" if row["seal"] else "running" if runner and runner["running"]
                 else "ended" if runner else "unsealed")
        seal_row = row["seal"] or {}
        runs.append({"paper_id": row["paper_id"], "candidate": row["config"].get("candidate"),
                     "source_sha256": row["source_sha256"], "symbols": row["symbols"], "state": state,
                     "created_at": row["created_at"], "image_ref": row["image_ref"],
                     "market_commit": row["market_commit"], "config": row["config"],
                     "status": seal_row.get("status"), "reasons": seal_row.get("reasons"),
                     "total_return": seal_row.get("total_return"), "max_drawdown": seal_row.get("max_drawdown")})
    return {"runs": runs, "running": sum(1 for run in runs if run["state"] == "running"), "limit": MAX_RUNNING}
