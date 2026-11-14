"""Browser-safe projections of retained Live facts; no venue access or persistent state.

The host read lock does not cover the native writer. Each file is sampled again
before return; changing or incomplete sources produce unknown, never a flat claim.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time

from engine.live_errors import REFUSALS, LiveRefusal
from live import daily, runs, state


MAX_BYTES = 16 * 1024 * 1024  # a JSON sample, or one journal row
MAX_ROWS = 200
MAX_MINUTES = 1442  # the equity chart's window: one day in minutes, and the minute a run stops in
HASH = re.compile(r"[0-9a-f]{64}\Z")
IDENTIFIER = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
OBSERVATION = re.compile(r"(?:preflight|connected-account|entry-account|final-account)-[0-9]{1,20}\.json\Z")
ORDER_EVENTS = frozenset({"OrderInitialized", "OrderDenied", "OrderEmulated", "OrderReleased", "OrderSubmitted",
                         "OrderAccepted", "OrderRejected", "OrderCanceled", "OrderExpired", "OrderTriggered",
                         "OrderPendingUpdate", "OrderPendingCancel", "OrderModifyRejected", "OrderCancelRejected",
                         "OrderUpdated", "OrderFilled"})
POSITION_EVENTS = frozenset({"PositionOpened", "PositionChanged", "PositionClosed"})
OBSERVATION_PREFIXES = {"preflight": ("preflight",), "started": ("connected-account",),
                        "reconciled": ("connected-account",), "held": ("connected-account",), "entry_verified": ("entry-account",),
                        "clean_stop": ("final-account",), "reconciled_flat": ("final-account",),
                        "venue_flat": ("preflight", "final-account")}
OBSERVATION_EVENTS = frozenset(OBSERVATION_PREFIXES)
HOST_STATES = frozenset({"prepared", "running", "clean_stopped", "not_armed", "unresolved", "reconciled_flat",
                         "venue_flat", "preflight_complete", "preflight_failed", "interrupted"})
# warmup: a trading start's source warmed up (after rewarming, entries are open again: live.notify).
RESTART_EVENTS = frozenset({"interrupted", "resuming", "held", "venue_flat_while_held", "held_flat", "rewarming",
                            "warmup"})


def _text(value, pattern=IDENTIFIER):
    return value if isinstance(value, str) and pattern.fullmatch(value) else None


def _integer(value):
    return str(value) if type(value) is int and value >= 0 else None


def _decimal(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)) or len(str(value)) > 80:
        return None
    try:
        parsed = Decimal(str(value))
        return str(value) if parsed.is_finite() and abs(parsed.adjusted()) <= 100 else None
    except InvalidOperation:
        return None


def _boolean(value):
    return value if type(value) is bool else None


def _enum(value, allowed):
    return value if isinstance(value, str) and value in allowed else None


@dataclass
class _Sample:
    path: Path
    source: str
    data: dict | list | None
    cursor: str | None
    status: str
    observed_ns: str | None
    read_ns: str
    lines: tuple[int, ...] = ()  # a journal's kept rows' line numbers

    def evidence(self):
        return {"source": self.source, "cursor": self.cursor, "observed_ns": self.observed_ns,
                "read_ns": self.read_ns, "complete": self.status == "complete", "state": self.status}


def _sample(path: Path, source: str, *, journal=False) -> _Sample:
    read_ns = str(time.time_ns())
    try:
        # All paths are fixed below the validated root, or an exact native filename allowlist.
        if any(parent.is_symlink() for parent in (path.parent, path.parent.parent)):
            raise ValueError
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        digest, lines = hashlib.sha256(), ()
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or (not journal and before.st_size > MAX_BYTES):
                raise ValueError
            if journal:
                size, kept = _journal(stream, digest)
                lines, data = tuple(index for index, _ in kept), [row for _, row in kept]
            else:
                raw = stream.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise ValueError
                digest.update(raw)
                size = len(raw)
            after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            return _Sample(path, source, None, None, "changed", None, read_ns)
        cursor = digest.hexdigest() + ":" + str(size)
        if journal:
            observed = _integer(data[-1]["observed_ns"]) if data else None
        else:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError
            observed = _integer(data.get("observed_ns"))
        return _Sample(path, source, data, cursor, "complete", observed, read_ns, lines)
    except FileNotFoundError:
        return _Sample(path, source, None, None, "missing", None, read_ns)
    except (OSError, ValueError, UnicodeError, RecursionError):
        return _Sample(path, source, None, None, "invalid", None, read_ns)


def _journal(stream, digest):
    """Read a journal a row at a time, checking every row, and keep each run's and event's first row and its
    latest MAX_MINUTES rows, as (line, row) in journal order: every projection below reads only those, so a run
    that never ends is read whole without holding its whole journal."""
    size, kept, latest = 0, [], {}
    for number, line in enumerate(iter(lambda: stream.readline(MAX_BYTES + 1), b"")):
        if len(line) > MAX_BYTES or not line.endswith(b"\n"):
            raise ValueError
        digest.update(line)
        row = json.loads(line)
        if not (isinstance(row, dict) and isinstance(row.get("event"), str)
                and isinstance(row.get("run_id"), str) and _integer(row.get("observed_ns")) is not None):
            raise ValueError
        key = (row["run_id"], row["event"])
        if key in latest:
            latest[key].append((number, row))
        else:
            latest[key] = deque(maxlen=MAX_MINUTES)
            kept.append((number, row))
        size += len(line)
    return size, sorted(kept + [item for queue in latest.values() for item in queue], key=lambda item: item[0])


def _stop_marker(path: Path) -> _Sample:
    """The STOP file itself is an accepted intent even if its following journal append failed."""
    read_ns = str(time.time_ns())
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode):
            raise ValueError
        identity = (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
        cursor = hashlib.sha256(repr(identity).encode()).hexdigest()
        return _Sample(path, "stop_intent", {"present": True}, cursor, "complete", None, read_ns)
    except FileNotFoundError:
        return _Sample(path, "stop_intent", {"present": False}, "absent", "complete", None, read_ns)
    except (OSError, ValueError):
        return _Sample(path, "stop_intent", None, None, "invalid", None, read_ns)


def _recheck(sample: _Sample, *, journal=False):
    fresh = _sample(sample.path, sample.source, journal=journal)
    if (sample.status, sample.cursor) != (fresh.status, fresh.cursor):
        sample.status, sample.data = "changed", None


def _rows(sample: _Sample, run_id: str):
    if sample.status != "complete" or not isinstance(sample.data, list):
        return None
    if any(row.get("run_id") != run_id for row in sample.data):
        sample.status = "invalid"
        return None
    return sample.data


def _ref(sample: _Sample, index: int):
    return {"source": sample.source, "cursor": f"{sample.cursor}:{sample.lines[index]}"}


def _identity(manifest):
    source, candidate, runtime, config = (manifest.get(key) for key in ("source", "candidate", "runtime", "config"))
    source, candidate, runtime, config = (item if isinstance(item, dict) else {} for item in
                                         (source, candidate, runtime, config))
    symbols = manifest.get("symbols")
    return {
        "source": {"source_sha256": _text(source.get("source_sha256"), HASH),
                   "entry_class": _text(source.get("entry_class"), re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,127}\Z"))},
        "candidate": {"strategy_id": _text(candidate.get("strategy_id")),
                      "revision": _integer(candidate.get("revision"))},
        "runtime": {"digest": _image(runtime)["digest"],
                    "platform": _enum(runtime.get("platform"), {"linux/amd64", "linux/arm64"})},
        "symbols": [value for value in symbols if _text(value, re.compile(r"[A-Z0-9]{2,24}USDT\Z"))]
                   if isinstance(symbols, list) else None,
        "config": {"drawdown_brake": _decimal(config.get("drawdown_brake")),
                   "duration_seconds": _integer(config.get("duration_seconds")),
                   "leverage": _decimal(config.get("leverage"))},
    }


def _native_rows(rows, sample: _Sample, kind: str):
    if rows is None:
        return None
    allowed = ORDER_EVENTS if kind == "order" else POSITION_EVENTS
    result = []
    for index, row in enumerate(rows):
        native = row.get("native")
        if row.get("event") != kind or not isinstance(native, dict) or not isinstance(native.get("type"), str) \
                or native["type"] not in allowed:
            continue
        item = {"event_type": native["type"], "observed_ns": _integer(row.get("observed_ns")),
                "event_ref": _ref(sample, index)}
        for key in ("client_order_id", "venue_order_id", "position_id", "instrument_id", "opening_order_id",
                    "closing_order_id", "trade_id"):
            if key in native:
                item[key] = _text(native[key])
        for key in ("quantity", "last_qty", "last_px", "price", "trigger_price", "avg_px_open", "avg_px_close",
                    "signed_qty", "peak_quantity", "realized_return"):
            if key in native:
                item[key] = _decimal(native[key])
        for key in ("ts_event", "ts_init", "ts_opened", "ts_closed"):
            if key in native:
                item[key] = _integer(native[key])
        for key, choices in (("order_side", {"BUY", "SELL"}), ("side", {"LONG", "SHORT", "FLAT"}),
                             ("order_type", {"MARKET", "LIMIT", "STOP_MARKET", "STOP_LIMIT",
                                             "MARKET_IF_TOUCHED", "LIMIT_IF_TOUCHED", "TRAILING_STOP_MARKET",
                                             "TRAILING_STOP_LIMIT"}),
                             ("time_in_force", {"GTC", "GTD", "IOC", "FOK", "DAY", "AT_THE_OPEN", "AT_THE_CLOSE"})):
            if key in native:
                item[key] = _enum(native[key], choices)
        # A fill event is a fill, not proof that the entire order is FILLED. These
        # are event rows; never sum fills or synthesize current order/position state.
        result.append(item)
    return result[-MAX_ROWS:]


def _minute_results(rows):
    """The run's result at each minute's first mark and when it stopped (engine.live record_minute), as
    [minute_ns, result] in journal order; a damaged row is left out, an unknown result stays unknown."""
    if rows is None:
        return None
    return [[minute, _decimal(row.get("result"))] for row in rows
            if row.get("event") == "minute_result" and (minute := _integer(row.get("minute_ns"))) is not None][-MAX_MINUTES:]


GATE_EVENTS = frozenset({"entries_closed", "entries_checking", "entries_opened", "entries_held", "connection_lost",
                         "connection_renewed", "entry_held", "entry_released", "entry_refused", "orphan_orders"})
GATE_REASONS = frozenset({"disconnected", "unverified", "unknown_orders", "bars_missing", "account_mode", "foreign",
                          "contract_status", "open"})


def _gate(rows):
    """The entry gate's events (engine.live_connection): when entries closed, why, and when they reopened."""
    if rows is None:
        return None
    result = []
    for row in rows:
        if row.get("event") not in GATE_EVENTS or type(row.get("observed_ns")) is not int:
            continue
        reasons = row.get("reasons") if isinstance(row.get("reasons"), list) else [row.get("reason")]
        result.append({"event": row["event"], "observed_ns": str(row["observed_ns"]),
                       "reasons": [reason for reason in reasons if reason in GATE_REASONS] if reasons else [],
                       "socket": _text(row.get("socket"), re.compile(r"[A-Za-z0-9_.:/ -]{1,200}\Z")),
                       "status": _text(row.get("status"), re.compile(r"[A-Z_]{1,40}\Z"))})
    return result[-MAX_ROWS:]


def _restarts(native, lifecycle):
    """Interruptions and starts again of the same run (engine.live), and the control's restart_limited."""
    if native is None or lifecycle is None:
        return None
    rows = [{"event": row["event"], "observed_ns": str(row["observed_ns"]),
             "held": row.get("held") if isinstance(row.get("held"), bool) else None, "retry": row.get("retry") is True}
            for row in native if row.get("event") in RESTART_EVENTS and type(row.get("observed_ns")) is int]
    rows += [{"event": "restart_limited", "observed_ns": str(row["observed_ns"]), "held": None, "retry": False}
             for row in lifecycle if row.get("event") == "restart_limited" and type(row.get("observed_ns")) is int]
    return sorted(rows, key=lambda row: int(row["observed_ns"]))[-MAX_ROWS:]


def _image(runtime) -> dict:
    runtime = runtime if isinstance(runtime, dict) else {}
    image = runtime.get("image_ref")
    digest = image.rsplit("@", 1)[-1] if isinstance(image, str) else ""
    return {"digest": digest if re.fullmatch(r"sha256:[0-9a-f]{64}", digest) else None,
            "build_revision": _text(runtime.get("build_revision"), re.compile(r"[0-9a-f]{40}\Z"))}


def _brake(native):
    """The run's equity at its first arming (its first `equity_peak`), its highest equity and, once it fired, the
    drawdown brake (engine.live_brake)."""
    if native is None:
        return None
    start = next((row for row in native if row.get("event") == "equity_peak"), None)
    peak = next((row for row in reversed(native) if row.get("event") == "equity_peak"), None)
    fired = next((row for row in native if row.get("event") == "drawdown_brake"), None)
    return {"start": _decimal(start.get("equity")) if start else None,
            "peak": _decimal(peak.get("equity")) if peak else None,
            "fired": {name: _decimal(fired.get(name)) for name in ("equity", "peak", "drawdown")} | {
                "observed_ns": str(fired["observed_ns"]) if type(fired.get("observed_ns")) is int else None}
            if fired else None}


def _key_checks(lifecycle):
    """The control's periodic checks of the run's key that failed, and a pass after one (live.control)."""
    if lifecycle is None:
        return None
    return [{"event": row["event"], "code": row.get("code") if row.get("code") in REFUSALS else None,
             "observed_ns": str(row["observed_ns"])}
            for row in lifecycle if row.get("event") in runs.KEY_EVENTS
            and type(row.get("observed_ns")) is int][-MAX_ROWS:]


def _account(sample: _Sample | None, reference, native_rows, latest_launch_ns):
    if sample is None or sample.status != "complete" or not isinstance(sample.data, dict):
        return None
    data = sample.data
    config, account = data.get("config"), data.get("account")
    config = config if isinstance(config, dict) else {}
    assets = account.get("assets", []) if isinstance(account, dict) else []
    usdt = [row for row in assets if isinstance(row, dict) and row.get("asset") == "USDT"] if isinstance(assets, list) else []
    wallet = usdt[0] if len(usdt) == 1 else {}
    # Only the product's successful terminal event asserts require_flat passed;
    # an arbitrary saved preflight snapshot is not a newly computed admission.
    row = native_rows[reference]
    flat = True if (row["event"] in runs.FLAT
                    and type(row.get("observed_ns")) is int
                    and latest_launch_ns is not None and row["observed_ns"] >= latest_launch_ns) else None
    return {"observation_ref": {"source": sample.source, "cursor": sample.cursor},
            "observed_ns": _integer(data.get("observed_ns")),
            "can_trade": _boolean(config.get("canTrade")), "hedge_mode": _boolean(config.get("dualSidePosition")),
            "multi_assets": _boolean(config.get("multiAssetsMargin")),
            "usdt_wallet": _decimal(wallet.get("walletBalance")),
            "usdt_available": _decimal(wallet.get("availableBalance")), "venue_flat": flat}


def run_view(root: Path, run_id: str) -> dict:
    """Read one run. Invalid root/run-id uses existing Live refusals; damaged facts become unknown.

    No lifecycle command, credential reader, or account client is invoked. Docker
    inspection is delegated to the existing read-only host observation.
    """
    with state.reading(root) as root:
        directory = state.directory(root, run_id)
        if any(path.is_symlink() for path in (root / "runs", directory, directory / "inputs", directory / "out")):
            raise state.fail("LIVE_RECORD_UNAVAILABLE", "the private Live record is not available for observation")
        samples = {name: _sample(path, name, journal=journal) for name, path, journal in (
            ("inputs", directory / "inputs" / "manifest.json", False),
            ("lifecycle", directory / "lifecycle.jsonl", True),
            ("custody", root / "account.jsonl", True),
            ("native", directory / "out" / "events.jsonl", True))}
        stop = _stop_marker(directory / "out" / "STOP")
        host_read = str(time.time_ns())
        host = None
        if all(sample.status not in {"invalid", "changed"} for sample in samples.values()):
            try:
                host = runs.observe(root, run_id)
            except (LiveRefusal, OSError, ValueError, KeyError, TypeError):
                pass
        native = _rows(samples["native"], run_id)
        reference, observation = None, None
        if native is not None:
            for index, row in enumerate(native):
                if row.get("event") in OBSERVATION_EVENTS and _text(row.get("observation"), OBSERVATION):
                    reference = index
            if reference is not None:
                observation = _sample(directory / "out" / native[reference]["observation"], "account_observation")
        for name, sample in samples.items():
            _recheck(sample, journal=name != "inputs")
        if observation is not None:
            _recheck(observation)
        later_stop = _stop_marker(stop.path)
        if (stop.status, stop.cursor) != (later_stop.status, later_stop.cursor):
            stop.status, stop.data = "changed", None
        native = _rows(samples["native"], run_id)
        lifecycle = _rows(samples["lifecycle"], run_id)
        inputs = samples["inputs"]
        manifest = inputs.data if inputs.status == "complete" and isinstance(inputs.data, dict) else {}
        if manifest.get("run_id") != run_id:
            manifest = {}
            inputs.status = "invalid"
        if observation is not None and observation.status == "complete":
            data = observation.data
            expected = ({f"{prefix}-{data.get('observed_ns')}.json"
                         for prefix in OBSERVATION_PREFIXES[native[reference]["event"]]}
                        if isinstance(data, dict) and native is not None and reference is not None else set())
            if (not isinstance(data, dict) or _integer(data.get("observed_ns")) is None
                    or data.get("credential_binding") != manifest.get("credential_binding")
                    or _text(manifest.get("credential_binding"), HASH) is None
                    or observation.path.name not in expected):
                observation.status, observation.data = "invalid", None
        custody = samples["custody"].data if samples["custody"].status == "complete" else None
        if custody is not None and any(not state.RUN_ID.fullmatch(str(row.get("run_id", ""))) for row in custody):
            custody = None
            samples["custody"].status = "invalid"
        host_stable = (host is not None
                       and all(samples[name].status == "complete" for name in ("inputs", "lifecycle"))
                       and all(samples[name].status in {"complete", "missing"} for name in ("custody", "native")))
        host_view = {"state": _enum(host.get("state"), HOST_STATES) if host_stable and host is not None else None,
                     "mode": _enum(host.get("mode"), {"preflight", "run", "reconcile"}) if host else None,
                     "account_owned": None, "exit_code": host.get("exit_code") if host and
                     type(host.get("exit_code")) is int else None}
        released, reason = None, None
        if custody is not None:
            host_view["account_owned"] = _boolean(host.get("account_owned")) if host else None
            last = next((row for row in reversed(custody) if row.get("run_id") == run_id
                         and row.get("event") in {"reserved", "released"}), None)
            released = last["event"] == "released" if last else False
            reason = _enum(last.get("reason"), {"never_armed", "native_and_venue_flat", "venue_flat"}) if released and last is not None else None
        latest_launch = next((row for row in reversed(lifecycle or [])
                              if row.get("event") == "launch_requested"), None)
        latest_launch_ns = (latest_launch.get("observed_ns") if latest_launch else 0) if lifecycle is not None else None
        if type(latest_launch_ns) is not int:
            latest_launch_ns = None
        archived = None
        if lifecycle is not None:
            last_resource = next((row["event"] for row in reversed(lifecycle)
                                  if row.get("event") in {"recycled", "launch_requested"}), None)
            archived = last_resource == "recycled"
        terminal = None
        if native is not None and latest_launch_ns is not None:
            terminal = next(({"event": row["event"], "observed_ns": _integer(row.get("observed_ns")),
                              "source_failed": _boolean(row.get("source_failed")),
                              "event_ref": _ref(samples["native"], index)}
                             for index, row in reversed(list(enumerate(native))) if row.get("event") in runs.RUN_ENDED
                             and type(row.get("observed_ns")) is int
                             and row["observed_ns"] >= latest_launch_ns), None)
        stop_requested = None
        if stop.status == "complete" and isinstance(stop.data, dict):
            if stop.data["present"] or any(row.get("event") == "stop_requested" for row in lifecycle or []):
                stop_requested = True
            elif lifecycle is not None:
                stop_requested = False
        result = {"run_id": run_id, **_identity(manifest), "host": host_view,
                  "stop_requested": stop_requested,
                  "terminal": terminal,
                  "custody": {"released": released, "release_reason": reason,
                              "archived": archived},
                  "account": _account(observation, reference, native, latest_launch_ns)
                  if native is not None and reference is not None else None,
                  "orders": _native_rows(native, samples["native"], "order"),
                  "positions": _native_rows(native, samples["native"], "position"),
                  "minute_results": _minute_results(native),
                  "gate": _gate(native),
                  "restarts": _restarts(native, lifecycle),
                  "brake": _brake(native),
                  "key_checks": _key_checks(lifecycle),
                  # The control's daily comparison with a replay (live.daily); never read through a link.
                  "compare": daily.read_record(directory),
                  "event_limit": MAX_ROWS}
        evidence = [sample.evidence() for sample in (*samples.values(), stop)]
        if observation is not None:
            evidence.append(observation.evidence())
        else:
            evidence.append({"source": "account_observation", "cursor": None, "observed_ns": None,
                             "read_ns": str(time.time_ns()), "complete": False, "state": "missing"})
        evidence.append({"source": "host", "cursor": None, "observed_ns": None, "read_ns": host_read,
                         "complete": host_stable, "state": "complete" if host_stable else "unknown"})
        result["evidence"] = evidence
        result["complete"] = all(row["complete"] for row in evidence)
        return result
