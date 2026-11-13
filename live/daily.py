"""The Live control's daily comparison (docs/plans/live-continuous-step7b-daily-compare-20261113.zh.md).

Once an hour from 00:30 UTC the control starts a comparison container of its own image (`launch`), with its own
memory limit, that runs `live compare-daily` (`run`): under the root's compare.lock it compares each launched run's
latest whole day, Y = min(the day it ended, yesterday), with a replay of every trading start that reaches into the
week to Y (live.compare, the replay cut at the end of Y), and keeps one summary per run in runs/<run>/compare.json.
The views show it and Telegram reports decisions the replay does not explain, the weekly measures and repeated
failures (live.notify). An execution record: nothing reaches a ledger, and the comparison never touches a run.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal
import fcntl
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time

from engine.live_errors import LiveRefusal
from live import runs, state
from shared.errors import Refusal


DAY_NS = 86_400 * 10**9
WEEK = 7
RECORD = "compare.json"
LOCK = "compare.lock"
TMP = "compare-tmp"
FORMAT = "live-compare-day-v1"
FINAL = frozenset({"done", "failed", "empty"})
SEGMENT_SECONDS = 3600  # each trading start's replay (replay.entry stops its stage containers after it)
CONTAINER_SECONDS = 6 * 3600  # the control stops a comparison container still running after this
WAKE_NS = 30 * 60 * 10**9  # after the market's daily import round (market/follow.py WAKE)
MEMORY = "2g"  # the comparison container, not measured (the design note's risks)
CPUS = "1"
LISTED = 20
STAGE_PREFIX = "trade-live-compare-"
CONTAINER_MARK = Path("/.dockerenv")


def _day(ns: int) -> str:
    return datetime.fromtimestamp(ns // 10**9, timezone.utc).date().isoformat()


def _ns(day: str) -> int:
    return round(datetime.combine(date.fromisoformat(day), datetime.min.time(), timezone.utc).timestamp()) * 10**9


# Records

def read_record(directory: Path) -> dict | None:
    path = directory / RECORD
    try:
        if path.is_symlink() or not path.is_file():
            return None
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) and value.get("format") == FORMAT else None


def _write(root: Path, run_id: str, value: dict) -> None:
    """Replace the run's record (a temporary file renamed), under a brief shared hold of the account lock so a
    command that removes the run's directory is not raced."""
    with state.reading(root) as root:
        directory = state.directory(root, run_id)
        if directory.is_symlink() or not directory.is_dir():
            return
        temporary = directory / f".{RECORD}.{secrets.token_hex(4)}"
        with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), "w",
                  encoding="utf-8") as stream:
            json.dump({"format": FORMAT, **value}, stream, sort_keys=True, default=str)
        os.replace(temporary, directory / RECORD)


# Measures of several trading starts

def combine(found: list[dict]) -> dict:
    """The measures (live.compare.measures) of several trading starts in one window as one."""
    from live import compare
    from replay import reconcile as shared
    def total(get) -> Decimal | None:
        values = [get(item) for item in found if get(item) is not None]
        return sum((Decimal(value) for value in values), Decimal(0)) if values else None

    paired = sum(item["fills_paired"] for item in found)
    slipped = [(item["adverse_slippage_bps"], item["fills_paired"]) for item in found
               if item["adverse_slippage_bps"] is not None]
    held = sorted(ns for item in found for ns in item["holds"]["held_ns"])
    text = shared._text

    def difference(side: str) -> str | None:
        return text(total(lambda item: item[side]["difference"]))

    return {"groups": sum(item["groups"] for item in found),
            "entries_unfilled": sum(item["entries_unfilled"] for item in found),
            "partial_fills": sum(item["partial_fills"] for item in found), "fills_paired": paired,
            "adverse_slippage_bps": (sum(value * count for value, count in slipped) / sum(count for _, count in slipped)
                                     if slipped and sum(count for _, count in slipped) else None),
            "fees": {side: text(total(lambda item, side=side: item["fees"][side])) for side in ("run", "replay")}
            | {"difference": difference("fees")},
            "equity_change": {side: text(total(lambda item, side=side: item["equity_change"][side]))
                              for side in ("run", "replay")} | {"difference": difference("equity_change")},
            "holds": {"held": sum(item["holds"]["held"] for item in found), "held_ns": held,
                      "held_ns_median": compare._percentile(held, 0.5), "held_ns_p90": compare._percentile(held, 0.9),
                      "ended_runs": sum(item["holds"]["ended_runs"] for item in found)}}


# One run

def _target(pack: dict, status: dict, today: int) -> int | None:
    """Y (as its day's start) for a run: yesterday while it runs, the day it ended once it has."""
    yesterday = today - DAY_NS
    if status.get("state") not in runs.ENDED:
        return yesterday
    ended = [row["observed_ns"] for row in pack["events"] if isinstance(row.get("observed_ns"), int)]
    if not ended:
        return None
    return min(max(ended) // DAY_NS * DAY_NS, yesterday)


def _week(root: Path, market: dict, run_id: str, pack: dict, since: int, bound: int, fresh: int, output: Path,
          image_ref: str | None = None) -> tuple[list[dict], list[dict], str | None, int]:
    """Replay every trading start that reaches into [since, bound), cut at `bound`, on the image each ran on (or on
    `image_ref`): (segments, decisions not explained since `fresh`, market day, decisions not explained in the week)."""
    from live import compare
    segments, unexplained, market_day, week = [], [], None, 0
    for number, item in enumerate(compare.segments(pack), 1):
        if item["start"] >= bound or (item["until"] is not None and item["until"] <= since):
            continue
        try:
            result = compare.compare(root, run_id, market, None, output / f"{run_id}-{number}", SEGMENT_SECONDS,
                                     number, since, bound, image_ref=image_ref)
        except Refusal as exc:
            if exc.code == "LIVE_COMPARE_EMPTY":
                continue  # no whole minute before the cut
            raise
        market_day = result["market_day"]
        segments.append({"number": number, "of": result["segment"]["of"], "window": result["window"],
                         "summary": result["summary"], "replay": {"status": result["replay"]["status"]},
                         "measures": result["measures"]})
        week += sum(since <= row["at_ns"] < bound for row in result["unexplained"])
        unexplained += [row for row in result["unexplained"] if fresh <= row["at_ns"] < bound]
    return segments, unexplained, market_day, week


def pair_run(root: Path, market: dict, run_id: str, offered: str, output: Path) -> dict | None:
    """The paired replay of a runtime image offered to a running run (design §3.8 rule 10): the run's latest compared
    day again, every trading start on `offered` instead of its own image. Shown beside that day's comparison before
    the user confirms a switch; it never blocks one (the user, 2026-11-13). Once per offered image and day: the
    run's record with `paired`, or None when there is nothing to pair."""
    from live import compare
    try:
        status = runs.observe(root, run_id)
    except LiveRefusal:
        return None
    if status.get("state") != "running" or status.get("mode") != "run" or status.get("image_ref") == offered:
        return None
    directory = state.directory(root, run_id)
    record = read_record(directory)
    if record is None or record.get("state") != "done":
        return None
    paired = record.get("paired") or {}
    if paired.get("image_ref") == offered and paired.get("day") == record["day"]:
        if paired.get("state") != "running":
            return None
        return {**record, "paired": {**paired, "state": "failed", "code": "stopped"}}  # the last attempt died
    target = _ns(record["day"])
    since, bound = target - (WEEK - 1) * DAY_NS, target + DAY_NS
    base = {"image_ref": offered, "day": record["day"], "attempted_ns": time.time_ns()}
    _write(root, run_id, {**record, "paired": {**base, "state": "running"}})
    pack = compare.read_pack(directory)
    try:
        segments, _, _, week = _week(root, market, run_id, pack, since, bound, bound, output / "paired",
                                     image_ref=offered)
    except (Refusal, LiveRefusal) as exc:
        return {**record, "paired": {**base, "state": "failed", "code": exc.code}}
    except Exception:
        return {**record, "paired": {**base, "state": "failed", "code": "error"}}
    if not segments:
        return {**record, "paired": {**base, "state": "empty", "code": None}}
    return {**record, "paired": {**base, "state": "done", "code": None,
                                 "measures": combine([item["measures"] for item in segments]),
                                 "unexplained_week": week,
                                 "look_ahead_suspects": sum(item["summary"].get("look_ahead_suspects") or 0
                                                            for item in segments)}}


def compare_run(root: Path, market: dict, run_id: str, today: int, output: Path) -> dict | None:
    """Compare one run's day Y and return its new record, or None when it has nothing new to compare."""
    from live import compare
    from replay import reconcile as shared
    try:
        status = runs.observe(root, run_id)
    except LiveRefusal:
        return None
    if status.get("mode") != "run":
        return None
    directory = state.directory(root, run_id)
    pack = compare.read_pack(directory)
    if not compare.segments(pack):
        return None  # never warmed: it never traded
    target = _target(pack, status, today)
    if target is None:
        return None
    day = _day(target)
    previous = read_record(directory) or {}
    if previous.get("day", "") > day or (previous.get("day") == day and previous.get("state") in FINAL):
        return None
    if target < today - WEEK * DAY_NS:
        return None  # ended over a week ago: nothing to report any more
    streak = previous.get("failures", 0) if previous.get("state") in ("failed", "running") else 0
    if previous.get("state") == "running":  # the last attempt died: its container was stopped or out of memory
        streak += 1
        if previous.get("day") == day:
            return {**previous, "state": "failed", "code": "stopped", "failures": streak}
    done_day = previous.get("done") if isinstance(previous.get("done"), str) else None
    bound = target + DAY_NS
    since = target - (WEEK - 1) * DAY_NS
    fresh = max(_ns(done_day) + DAY_NS, since) if done_day else since  # decisions not reported before
    base = {"day": day, "attempted_ns": time.time_ns(), "done": done_day,
            "window": {"from": shared._utc(since), "to": shared._utc(bound)}}
    _write(root, run_id, {**base, "state": "running", "failures": streak})
    try:
        segments, unexplained, market_day, week = _week(root, market, run_id, pack, since, bound, fresh, output)
    except Refusal as exc:
        code = exc.code
        if code == "LIVE_COMPARE_UNCOVERED":
            return {**base, "state": "waiting", "code": code, "failures": streak}
        return {**base, "state": "failed", "code": code, "failures": streak + 1}
    except LiveRefusal as exc:
        return {**base, "state": "failed", "code": exc.code, "failures": streak + 1}
    except Exception:
        return {**base, "state": "failed", "code": "error", "failures": streak + 1}
    if not segments:
        return {**base, "state": "empty", "code": None, "failures": 0}
    unexplained.sort(key=lambda row: row["at_ns"])
    return {**base, "state": "done", "code": None, "failures": 0, "done": day, "market_day": market_day,
            "segments": [{key: value for key, value in item.items() if key != "measures"} for item in segments],
            "measures": combine([item["measures"] for item in segments]),
            "unexplained": unexplained[:LISTED], "unexplained_count": len(unexplained), "unexplained_week": week,
            "look_ahead_suspects": sum(item["summary"].get("look_ahead_suspects") or 0 for item in segments)}


# The comparison container

@contextmanager
def _exclusive(root: Path):
    """Yield whether this process holds the root's compare.lock (never waiting)."""
    descriptor = os.open(root / LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        yield True


def _clean(scratch: Path) -> None:
    """Under the lock: the stage containers and working directories a stopped comparison left."""
    try:
        names = subprocess.run(["docker", "ps", "--all", "--filter", f"name=^{STAGE_PREFIX}", "--filter",
                                "status=exited", "--filter", "status=created", "--format", "{{.Names}}"],
                               capture_output=True, text=True, timeout=60, check=True).stdout.split()
        for name in names:
            if name.startswith(STAGE_PREFIX):
                subprocess.run(["docker", "rm", name], capture_output=True, timeout=60, check=False)
    except (OSError, subprocess.SubprocessError):
        pass
    for path in scratch.iterdir():
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path, ignore_errors=True)


def _scratch(root: Path) -> Path:
    """<root>/compare-tmp: a host directory mounted at its own path, so the stage containers the host's Docker
    creates can mount what the comparison writes there (as Paper's TMPDIR, paper.serve.shared_tmpdir)."""
    scratch = root / TMP
    if scratch.is_symlink():
        raise state.fail("LIVE_DIRECTORY", "the comparison's working directory is a symbolic link")
    scratch.mkdir(mode=0o700, exist_ok=True)
    return scratch


def run(root: Path, market_root: Path, today: str, offered: str | None = None) -> dict:
    """live compare-daily: one pass over the account's runs; {state, runs: {run_id: record state}}. With `offered`
    (the control's paired runtime image), each running run on another image then gets its paired replay."""
    root = Path(root).expanduser().absolute()
    with state.reading(root) as root:
        directory = root / "runs"
        listed = sorted(path.name for path in directory.iterdir()
                        if state.RUN_ID.fullmatch(path.name) and path.is_dir() and not path.is_symlink()) \
            if directory.is_dir() and not directory.is_symlink() else []
    with _exclusive(root) as held:
        if not held:
            return {"state": "busy", "runs": {}}
        scratch = _scratch(root)
        _clean(scratch)
        attempt = Path(tempfile.mkdtemp(prefix="day-", dir=scratch))
        os.environ["TMPDIR"] = str(attempt)
        tempfile.tempdir = None
        if Path(tempfile.gettempdir()).resolve() != attempt.resolve():
            raise state.fail("LIVE_DIRECTORY", "the comparison's temporary directory is not its own")
        market = {"holds": "market", "root": str(market_root)}
        found = {}
        try:
            for run_id in listed:
                try:
                    record = compare_run(root, market, run_id, _ns(today), attempt)
                    if record is not None:
                        _write(root, run_id, record)
                        found[run_id] = record["state"]
                except Exception:
                    found[run_id] = "unreadable"  # never a reason to skip the others
            for run_id in listed:
                if offered is None:
                    break
                try:
                    record = pair_run(root, market, run_id, offered, attempt)
                    if record is not None:
                        _write(root, run_id, record)
                except Exception:
                    pass  # the record keeps its own comparison; the next pass tries again
        finally:
            shutil.rmtree(attempt, ignore_errors=True)
    return {"state": "done", "runs": found}


def launch_argv(container: dict, root: Path, market_root: Path, today: str, offered: str | None = None) -> list[str]:
    """`docker run` of a comparison container: this control's image, user, groups, capabilities, security options,
    network and mounts (--volumes-from), with its own memory and CPU limits, removed when it exits."""
    config, host = container["Config"], container["HostConfig"]
    argv = ["docker", "run", "--rm", "--init", "--name", f"trade-live-daily-{secrets.token_hex(6)}",
            "--volumes-from", container["Id"], "--network", host["NetworkMode"],
            "--memory", MEMORY, "--memory-swap", MEMORY, "--cpus", CPUS]
    if config.get("User"):
        argv += ["--user", config["User"]]
    for group in host.get("GroupAdd") or []:
        argv += ["--group-add", str(group)]
    for capability in host.get("CapDrop") or []:
        argv += ["--cap-drop", capability]
    for capability in host.get("CapAdd") or []:
        argv += ["--cap-add", capability]
    for option in host.get("SecurityOpt") or []:
        argv += ["--security-opt", option]
    for name in ("HOME", "DOCKER_CONFIG", "DOCKER_HOST", "TRADE_DOLT_HOST"):
        value = next((item.split("=", 1)[1] for item in config.get("Env") or [] if item.startswith(name + "=")), None)
        if value is not None:
            argv += ["--env", f"{name}={value}"]
    return [*argv, "--entrypoint", "python", container["Image"], "-m", "cli.main", "live", "compare-daily",
            "--root", str(root), "--market-root", str(market_root), "--today", today,
            *(["--offered-runtime", offered] if offered else [])]


def due(now: int, last: int | None) -> bool:
    """Whether the control starts a comparison container now: from 00:30 UTC, at most once each wall-clock hour."""
    hour = now // (3600 * 10**9)
    return now % DAY_NS >= WAKE_NS and (last is None or last // (3600 * 10**9) != hour)


def launch(root: Path, market_root: Path, now: int, offered: str | None = None) -> str:
    """Start one comparison container and wait for it; what happened, for tests and logs. Outside a container
    (the control run by hand) it does nothing."""
    identity = os.environ.get("HOSTNAME", "")
    if not CONTAINER_MARK.exists() or not identity:
        return "outside"
    try:
        found = json.loads(subprocess.run(["docker", "inspect", "--type", "container", identity], capture_output=True,
                                          text=True, timeout=60, check=True).stdout)[0]
        argv = launch_argv(found, root, market_root, _day(now), offered)
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError):
        return "uninspected"
    name = argv[argv.index("--name") + 1]
    try:
        subprocess.run(argv, capture_output=True, timeout=CONTAINER_SECONDS, check=False)
    except subprocess.TimeoutExpired:
        subprocess.run(["docker", "stop", name], capture_output=True, timeout=120, check=False)
        return "stopped"
    except OSError:
        return "failed"
    return "ran"
