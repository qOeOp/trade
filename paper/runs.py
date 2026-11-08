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
One run per source at a time. A run is admitted by memory, not by count (docs/plans/paper-admission-by-memory.zh.md):
its containers' limits, sized by its contracts, are its reservation; this ledger's running reservations stay within
the deployment's budget (TRADE_PAPER_MEMORY), and the host keeps HEADROOM_MIB available after the new one.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import time
import uuid

from ledger import db, paper as records, strategies
from ledger.refusals import refuse
from runtime import container, image
from paper.recovery import bind, launched, serialized, checkpoint


# A runner's limit is its reservation: BASE + PER_CONTRACT per contract, rounded up to 128 MiB, from the
# 6-hour peaks in docs/plans/paper-admission-by-memory.zh.md §4 (199 MiB at 1 contract, 324 at 21) with
# room for days of growth: 512 MiB at 1 contract, 768 at 21. The egress proxy holds about 20 MiB.
RUNNER_BASE_MIB = 384
RUNNER_PER_CONTRACT_MIB = 16
RUNNER_CPUS = "0.5"
EGRESS_MEMORY = "64m"
BUDGET_ENV = "TRADE_PAPER_MEMORY"
BUDGET_DEFAULT = "3g"
HEADROOM_MIB = 1024
MEMINFO = Path("/proc/meminfo")
EGRESS_PORT = 3128
STOP_SECONDS = 60  # the STOP file to SIGTERM: the runner cancels its orders and writes its summary
STOP_KILL_SECONDS = container.PAPER_STOP_SECONDS  # SIGTERM to SIGKILL
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


def mib(size: str) -> int:
    """A Docker size such as 512m or 3g, in MiB."""
    if not re.fullmatch(r"[1-9][0-9]{0,5}[mg]", size):
        raise refuse("USAGE_ERROR", f"{size!r} is not a size such as 512m or 3g")
    return int(size[:-1]) * (1024 if size[-1] == "g" else 1)


def runner_memory(contracts: int) -> str:
    """The runner's limit for a run of `contracts` contracts."""
    need = RUNNER_BASE_MIB + RUNNER_PER_CONTRACT_MIB * contracts
    return f"{-(-need // 128) * 128}m"


def budget() -> int:
    """The deployment's paper memory budget in MiB (TRADE_PAPER_MEMORY, else BUDGET_DEFAULT)."""
    return mib(os.environ.get(BUDGET_ENV) or BUDGET_DEFAULT)


def _host_available() -> int | None:
    """The host's MemAvailable in MiB, as the daemon's /proc shows it (a container sees its host's), or None
    where there is none (a macOS shell, whose Docker runs in a VM: the budget alone applies)."""
    try:
        for line in MEMINFO.read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def limits(names_: list[str]) -> int:
    """The memory limits of these containers together, in MiB."""
    if not names_:
        return 0
    found = _checked("inspect", "--format", "{{.HostConfig.Memory}}", *names_)
    return sum(int(value) for value in found.split()) // (1024 * 1024)


def memory_state(profile: db.LedgerProfile, present: list[dict] | None = None) -> dict:
    """This ledger's paper memory in MiB: the budget, what its running containers reserve (their limits), the
    host's available memory, what a new run may reserve (`free`) and the least a run needs (`smallest`)."""
    total = budget()
    reserved = limits([item["name"] for item in (containers(profile) if present is None else present)
                       if item["running"]])
    host = _host_available()
    free = total - reserved if host is None else min(total - reserved, host - HEADROOM_MIB)
    return {"budget": total, "reserved": reserved, "host_available": host, "free": max(free, 0),
            "smallest": mib(runner_memory(1)) + mib(EGRESS_MEMORY)}


def admit(profile: db.LedgerProfile, need: int, present: list[dict] | None = None) -> None:
    """Refuses a run that would reserve `need` MiB beyond the budget or the host's headroom."""
    state = memory_state(profile, present)
    if need <= state["free"]:
        return
    host = state["host_available"]
    if host is not None and host - HEADROOM_MIB < state["budget"] - state["reserved"]:
        why = f"the host has {host} MiB available and keeps {HEADROOM_MIB} MiB free"
    else:
        why = f"running runs reserve {state['reserved']} of the {state['budget']} MiB paper budget"
    raise refuse("PAPER_MEMORY_FULL", f"this run needs {need} MiB; {why}; stop a run first",
                 expected=f"at most {state['free']} MiB for a new run")


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
    from market import files, universe
    opened = files.open_market(market, "reader")
    commit = files.resolve_commit(opened, at)
    found = universe.membership_path(opened, commit, now_ns)
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
                                     labels={**labels, f"{LABEL}.role": "runner"}, cpus=RUNNER_CPUS)
    _checked(*runner[1:])
    return named


def _running(name: str) -> bool:
    found = _docker("inspect", "--format", "{{.State.Running}}", name)
    return found.returncode == 0 and found.stdout.strip() == b"true"


def _state(name: str) -> dict | None:
    """The container's State (ExitCode, OOMKilled, FinishedAt, ...), or None once it is gone."""
    found = _docker("inspect", "--format", "{{json .State}}", name)
    return json.loads(found.stdout) if found.returncode == 0 else None


def _logs(name: str) -> bytes:
    found = _docker("logs", "--tail", LOG_TAIL_LINES, name)
    return found.stdout + found.stderr if found.returncode == 0 else b""


def _remove(profile: db.LedgerProfile, paper_id: int) -> None:
    named = names(profile, paper_id)
    _docker("rm", "--force", named["runner"])
    _docker("rm", "--force", named["egress"])
    _docker("network", "rm", named["network"])


@serialized
def start(profile: db.LedgerProfile, market: dict, at: str | None, candidate: str, symbols: list[str] | None,
          runtime: str | None, memory: str | None = None, duration_seconds: int | None = None,
          op_id: str | None = None, *, research: db.LedgerProfile | None = None,
          research_at: str | None = None) -> dict:
    """paper start: declare one run of a published candidate and start its containers; returns at once."""
    from market.instrument import ASSUMED
    with db.connect(profile, "reader") as conn:
        prior = records.paper_start_of(conn, op_id) if op_id else None
        if prior is not None:
            if (prior["config"].get("candidate") != candidate
                    or (symbols is not None and symbols != prior["symbols"])):
                raise refuse("OP_ID_CONFLICT", "this start operation already names another candidate or contracts")
            return {"paper_id": prior["paper_id"], "candidate": prior["config"].get("candidate"),
                    "symbols": prior["symbols"], "image_ref": prior["image_ref"],
                    "write_status": "replayed", "directory": str(run_dir(profile, prior["paper_id"]))}
        if research is None:
            found = strategies.read_candidate(conn, candidate)
    if research is not None:
        with db.read_as_of(research, research_at) as source:
            research_commit = source.resolved_commit
            found = strategies.read_candidate(source, candidate)
    identity = image.resolve(runtime)
    present = containers(profile)
    if any(item["source_sha256"] == found["source_sha256"] for item in present
           if item["role"] == "runner" and item["running"]):
        raise refuse("PAPER_RUN_ACTIVE", f"{candidate} already has a running paper run", missing=(candidate,))
    if duration_seconds is not None and duration_seconds < 1:
        raise refuse("USAGE_ERROR", "--duration-seconds must be positive")
    commit, membership, chosen = _membership(market, at, symbols, time.time_ns())
    memory = memory or runner_memory(len(chosen))
    admit(profile, mib(memory) + mib(EGRESS_MEMORY), present)
    config = {"execution": "paper-bars", "fees": {"maker": ASSUMED["maker_fee"], "taker": ASSUMED["taker_fee"]},
              "universe_rule": membership["universe_rule"], "memory": memory, "duration_seconds": duration_seconds,
              "candidate": candidate}
    if research is not None:
        from paper.inputs import capture
        with db.read_as_of(research, research_commit) as source:
            capture(profile, source, candidate)
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
    bind(row, directory)
    try:
        launched(directory, "start")
        named = _run_containers(identity, profile, row, found["entry_class"], directory, memory, duration_seconds)
    except Exception as exc:
        sealed = seal(profile, row["paper_id"], start_error=f"{type(exc).__name__}: {exc}")
        raise refuse("PAPER_START_FAILED", f"paper run {row['paper_id']} did not start and was sealed invalid: {exc}",
                     missing=(sealed["bundle"],), write_status="written") from exc
    return {"paper_id": row["paper_id"], "candidate": candidate, "source_sha256": row["source_sha256"],
            "image_ref": identity["image_ref"], "symbols": chosen, "market_commit": commit,
            "directory": str(directory), "containers": named, "ledger_commit": row["ledger_commit"],
            "write_status": row["write_status"]}


@serialized
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
    state = None if start_error else _state(named["runner"])
    files = records.capture(row, directory / "out", directory / "egress" / "egress.log", runner_log,
                            state.get("ExitCode") if state else None, start_failed=start_error is not None,
                            oom_killed=bool(state and state.get("OOMKilled")))
    with db.connect(profile, "writer") as conn:
        sealed = records.seal_paper_run(conn, paper_id, files)
    _remove(profile, paper_id)
    return {"paper_id": paper_id, **sealed}


@serialized
def request_stop(profile: db.LedgerProfile, paper_id: int) -> dict:
    """Persist final user intent before HTTP acknowledges it; recovery must never override STOP."""
    with db.connect(profile, "reader") as conn:
        records.read_paper_run(conn, paper_id)
        sealed = records.seal_of(conn, paper_id)
    if sealed is not None:
        return {"paper_id": paper_id, "state": "sealed", "write_status": "replayed"}
    checkpoint.atomic(run_dir(profile, paper_id) / "out" / "STOP", b"")
    return {"paper_id": paper_id, "state": "stopping", "write_status": "written"}


@serialized
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


@serialized
def delete(profile: db.LedgerProfile, paper_id: int) -> dict:
    """paper delete: remove a sealed run from the ledger (ledger.delete_paper_run), then its run directory."""
    found = records.delete_paper_run(profile, paper_id)
    shutil.rmtree(run_dir(profile, paper_id), ignore_errors=True)
    return found


def listing(profile: db.LedgerProfile) -> dict:
    """paper list: every declared run with its state (running, ended, sealed) and seal readings."""
    with db.connect(profile, "reader") as conn:
        rows = records.paper_runs(conn)
    present = containers(profile)
    live = {(item["paper_id"], item["role"]): item for item in present}
    runs = []
    for row in rows:
        runner = live.get((row["paper_id"], "runner"))
        state = ("sealed" if row["seal"] else "running" if runner and runner["running"]
                 else "ended" if runner else "unsealed")
        seal_row = row["seal"] or {}
        runs.append({"paper_id": row["paper_id"], "op_id": row["op_id"], "candidate": row["config"].get("candidate"),
                     "source_sha256": row["source_sha256"], "symbols": row["symbols"], "state": state,
                     "created_at": row["created_at"], "image_ref": row["image_ref"],
                     "market_commit": row["market_commit"], "config": row["config"],
                     # The status under the current rule (records.verdict), from the reasons sealed; the seal
                     # keeps the status it was sealed with.
                     "status": records.verdict(seal_row.get("reasons")) if row["seal"] else None, "reasons": seal_row.get("reasons"),
                     "total_return": seal_row.get("total_return"), "max_drawdown": seal_row.get("max_drawdown")})
    return {"runs": runs, "running": sum(1 for run in runs if run["state"] == "running"),
            "memory": memory_state(profile, present)}
