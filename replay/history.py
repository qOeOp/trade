"""A line's closing history test (`replay.history`).

Before a line closes, every candidate of its test (report.history.candidates: the sources with a passed research
run on it whose run carries economic evidence) is replayed over each segment of ledger.lines.history_segments: the veto segments (the years of four quarters before the
development period, counted back from its start), the period again as the control, the two-year holdout after it as one segment, and the
forward segment after the holdout. Each segment replays the
candidate's latest passed research run by its identity (source, image, configuration, instrument rule),
only over another window, on one market day, from zero position and the same starting balance; it is a
history trial, sealed as a run like any other. Candidates go by their development-period Sharpe, highest
first; a segment that already has a history run is skipped, so an interrupted test resumes. A segment whose latest
history run is invalid (an environment or transient failure, or the strategy's own audit failure) is replayed
again, once per call and after every segment without a run; the new trial supersedes the invalid one, which
stays in the ledger. Replays are deterministic, so a failure of the strategy's own fails again.

Segments replay several at once, as many as Docker's memory has room for at a replay's peak: each stage container
may reach its memory limit (runtime.container.STAGE_MEMORY_BYTES) and a replay's stages run one after another, so
the width is what the Docker engine's memory, less what its running containers hold and `MARGIN`, divides into
such limits, at least one. Each segment exports its own inputs into a fresh directory and seals through
replay.entry.seal, whose ledger writes rerun on a concurrent commit; the segments start in the order above, and
what ran is returned in that order whatever finished first.
"""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from datetime import date, timedelta
import re
import subprocess
import threading

from ledger import db, lines, metrics, strategies, trials
from registration import inputs as registration_inputs, seams as registration_seams
from replay import entry, reproduce, seams
from report import history as report_history, measures
from runtime import container
from shared import clock
from shared.refusals import refuse


# Docker's own memory beside its containers' (the engine, the VM kernel on Docker Desktop), kept free of replays.
MARGIN = 2**30
UNITS = {"B": 1, "KiB": 2**10, "MiB": 2**20, "GiB": 2**30, "TiB": 2**40, "kB": 10**3, "MB": 10**6, "GB": 10**9,
         "TB": 10**12}
SIZE = re.compile(r"\s*([0-9.]+)\s*([A-Za-z]+)\s*\Z")


def _sharpe(conn: db.LedgerConnection, trial_id: int) -> float | None:
    return measures.derive_measures(measures.run_facts(conn, trial_id), wanted=("sharpe_365",))["sharpe_365"]["value"]


def engine_memory() -> tuple[int, int]:
    """The bytes the Docker engine has (`docker info` MemTotal: the VM's on Docker Desktop, the host's on Linux) and
    what its running containers hold now (`docker stats`); (0, 0) when Docker does not answer them."""
    try:
        total = subprocess.run(["docker", "info", "--format", "{{.MemTotal}}"], capture_output=True, text=True,
                               check=True, timeout=60).stdout
        usage = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}"], capture_output=True,
                               text=True, check=True, timeout=60).stdout
        held = 0
        for line in usage.splitlines():
            if line.strip():
                found = SIZE.match(line.split("/")[0])
                if found is None or found.group(2) not in UNITS:
                    raise ValueError(f"unreadable container memory {line!r}")
                held += int(float(found.group(1)) * UNITS[found.group(2)])
        return int(total), held
    except (OSError, subprocess.SubprocessError, ValueError):
        return 0, 0


def width(memory: Callable[[], tuple[int, int]], segments: int) -> int:
    """How many of `segments` replay at once: as many stage memory limits as fit in what `memory` (the engine's
    memory and what its containers hold) leaves after `MARGIN`, at least one."""
    limit, held = memory()
    return max(1, min(segments, (limit - held - MARGIN) // container.STAGE_MEMORY_BYTES))


class _Stages:
    """The stage containers this history test runs (replay.seams.run, wrapped): once `stop` is called, as on an
    interrupt of the main thread, running ones are stopped and sealed as interrupted, as replay.entry._stage does
    for its own thread, and no further one starts."""

    def __init__(self, run: Callable):
        self.inner, self.lock, self.stopped = run, threading.Lock(), False
        self.running: set[str | None] = set()

    def run(self, command: list[str], stdout, stderr, timeout: float | None) -> int:
        name = command[command.index("--name") + 1] if "--name" in command else None
        with self.lock:
            if self.stopped:
                raise KeyboardInterrupt
            self.running.add(name)
        try:
            code = self.inner(command, stdout, stderr, timeout)
        finally:
            with self.lock:
                self.running.discard(name)
        if self.stopped:
            raise KeyboardInterrupt
        return code

    def stop(self) -> None:
        with self.lock:
            self.stopped, names = True, list(self.running)
        for name in names:
            if name is not None:
                seams.current.stop(name)


def _segment(ledger: db.LedgerProfile, market, market_day: str, line_id: int, item: dict, stages: _Stages) -> dict:
    """Replay one segment of one candidate's run (`item` of lines.history_plan) as a sealed history trial."""
    with db.connect(ledger, "reader") as conn:
        stored = metrics.load_run(conn, item["trial_id"])
        revision = strategies.candidate_by_sha(conn, item["source_sha256"])
    window = item["window"]
    recorded, runner_argv, flags = reproduce.stored_runner_argv(
        stored, window["input_start"], window["trade_start"], window["trade_end"])
    span = {"start": clock.moment_ns(window["input_start"]),
            "trade_start": clock.moment_ns(window["trade_start"]), "end": clock.moment_ns(window["trade_end"])}
    # The segment changes only the window: the image must give the run's configuration otherwise unchanged.
    effective = (stored["capture"].get("input_coverage") or {}).get("effective_config")
    exported = None
    try:
        exported = registration_inputs.market_inputs(
            market, market_day, span, dict(recorded["selection"]), recorded.get("lifecycle_bundle"), True, ledger,
            **flags)
        if stages.stopped:
            raise KeyboardInterrupt
        sealed = entry.seal(ledger, revision, stored["trial"]["image_ref"], exported, runner_argv, None, None,
                            market=market, history=line_id,
                            comparable_config=trials.comparable_config_sha256(effective))
    finally:
        registration_inputs.cleanup(exported)
    return {"source_sha256": item["source_sha256"], "segment": item["label"], "run": item["trial_id"],
            "history_trial_id": sealed["trial_id"], "status": sealed["status"], "replaces": item["done"]}


def run_history(ledger: db.LedgerProfile, market, at: str | None, line: str, limit: int | None = None,
                memory: Callable[[], tuple[int, int]] | None = None) -> dict:
    """Run the segments of `line`'s closing history test that have no history run, then once more those whose
    latest history run is invalid, at most `limit` runs in all, several at once as `memory` (default
    `engine_memory`) has room (`width`); returns what ran in that order (`replaces`: the invalid history trial a rerun supersedes, else None), the
    segments left without a run (`left`) and with an invalid run not replayed this time (`invalid_left`), and the
    participants left out for want of economic evidence. A market day `at` before the line's own is refused
    (HISTORY_MARKET_DAY_EARLY, 20261122-20, user 2026-11-22): its market can end inside the holdout. A segment that raises lets those running finish and starts
    no other; the first such error in that order is raised."""
    source = registration_seams.current.market(market)
    market_day = source.resolve_day(at)
    first_day, latest = source.days(market_day)
    after_last = latest + timedelta(days=1)
    with db.connect(ledger, "reader") as conn:
        record = lines.open_line(conn, line)
        if date.fromisoformat(market_day) < date.fromisoformat(str(record["market_day"])):
            raise refuse("HISTORY_MARKET_DAY_EARLY", f"market day {market_day} is before {record['name']}'s own, "
                                                     f"{record['market_day']}: its market can end inside the holdout",
                         expected=f"{record['market_day']} or later")
        candidates, without = report_history.candidates(conn, record["line_id"])
        plan = lines.history_plan(conn, record["line_id"], first_day, after_last,
                                  registration_seams.coverage(source, market_day), candidates)
        order = {trial_id: _sharpe(conn, trial_id) for trial_id in {item["trial_id"] for item in plan}}
    todo = [item for item in plan if item["window"] is not None
            and (item["done"] is None or item["status"] == "invalid")]
    todo.sort(key=lambda item: (item["done"] is not None, order[item["trial_id"]] is None,
                                -(order[item["trial_id"]] or 0), item["trial_id"]))
    chosen = todo[:limit]
    ran = []
    if chosen:
        at_once, stages = width(memory or engine_memory, len(chosen)), _Stages(seams.current.run)
        futures: list[Future] = []
        running: set[Future] = set()
        with seams.use(run=stages.run), ThreadPoolExecutor(at_once, thread_name_prefix="history") as pool:
            try:
                while len(futures) < len(chosen) or running:
                    while (len(futures) < len(chosen) and len(running) < at_once
                           and not any(future.exception() for future in futures if future.done())):
                        futures.append(pool.submit(_segment, ledger, market, market_day, record["line_id"],
                                                   chosen[len(futures)], stages))
                        running.add(futures[-1])
                    if not running:
                        break
                    running = wait(running, return_when=FIRST_COMPLETED).not_done
            except BaseException:
                stages.stop()  # the pool's exit then waits for the running segments to seal as interrupted
                raise
        for future in futures:
            failure = future.exception()
            if failure is not None:
                raise failure
        ran = [future.result() for future in futures]
    rest = todo[len(ran):]
    return {"line": record["name"], "market_day": market_day, "ran": ran,
            "left": sum(item["done"] is None for item in rest),
            "invalid_left": sum(item["done"] is not None for item in rest),
            "participants": len({item["source_sha256"] for item in plan}), "without_economic_evidence": without,
            "segments_without_trading": sum(item["window"] is None for item in plan)}
