"""Separate Binance USD-M native Live entry point with explicit private inputs.

Paper retains its credential-free Sandbox contract. This entry point never changes account settings. An
interrupted run (SIGTERM, a killed runner) starts again as the same run: on a flat account its source warms up and
trades again; otherwise it holds, observing only, until the account is flat (design §3.4, first stage: the source
cannot yet rebuild its state around an open position). One killed in a stop that was to end the run starts again only
to finish that stop (no source, its positions closed as the stop began to) and is over. An armed run that ends by its own refusal or failure is over
(`unresolved`) and is never started again; only a start again whose first account read fails, or shows this clock
outside the limits, or whose connected read fails or is overdue, or whose socket disconnects before that read is
verified, gives the start back.
"""

from __future__ import annotations

# Native network/worker threads must inherit the blocked mask. The dedicated
# sigwait thread turns process signals into an interruption that keeps positions and their stops (engine.signals).
if __name__ == "__main__":
    from engine.signals import block
    block()

import argparse
import functools
from decimal import Decimal
import fcntl
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
from nautilus_trader.model import Venue
from engine import strategy as strategy_runtime
from engine.config import RUNTIME_CONTRACT, is_leverage, read_regular_file
from engine.live_errors import LiveRefusal as Refusal
from engine.live_cache import LiveCache
from engine.live_venue import MANIFEST_FORMAT, VENUES, BinanceReadOnly, read_credentials, require_clock, require_account_mode, require_admission, require_evidence, require_flat
from engine.live_records import contract, journal, keep, write_json
from engine.live_commands import pending_orders
from engine.live_session import ENDED_EVENTS, Session
from engine.live_source import source_for_run
from engine.live_stop import begun_stop
from engine import live_brake, live_connection
from engine.live_lifecycle import source_outcome
from engine.live_node import build_node
from engine.kline_events import KlineEvents, connect as kline_connect
from engine.signals import Signals


INTERRUPTED = 3  # the exit status of a run that starts again as itself
# The refusals of a start again that give the start back instead of ending the run (the user, 2026-11-15): Binance
# could not be read, or the read shows this clock outside the limits. Both pass by themselves (a host clock that
# steps aside comes back), the account may hold a position, and the limits themselves are unchanged.
GIVEN_BACK = frozenset({"LIVE_ACCOUNT_UNAVAILABLE", "LIVE_CLOCK"})
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,80}\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")


# A USD-M contract as live.configuration takes it (market.sources.SYMBOL ending in USDT), a non-ASCII coin included.
CONTRACT = re.compile(r"[^\W_]+USDT\Z")


def read_manifest(path: Path) -> dict:
    try:
        value = json.loads(read_regular_file(path))
        if value["format"] != MANIFEST_FORMAT or any(not IDENTIFIER.fullmatch(value[key])
                for key in ("run_id", "trader_id", "account_id")):
            raise ValueError
        if not HASH.fullmatch(value["credential_binding"]):
            raise ValueError
        symbols = value["symbols"]
        if not isinstance(symbols, list) or not symbols or len(set(symbols)) != len(symbols) \
                or any(not isinstance(symbol, str) or not CONTRACT.fullmatch(symbol) for symbol in symbols):
            raise ValueError
        source, candidate, runtime, config = value["source"], value["candidate"], value["runtime"], value["config"]
        if (runtime["runtime_contract"] != RUNTIME_CONTRACT
                or not HASH.fullmatch(source["source_sha256"])
                or not isinstance(candidate["strategy_id"], str) or type(candidate["revision"]) is not int
                or not HASH.fullmatch(value["universe_sha256"])
                or not re.fullmatch(r".+@sha256:[0-9a-f]{64}", runtime["image_ref"])
                or runtime["image_ref"].rsplit("@", 1)[1] != runtime["image_digest"]):
            raise ValueError
        brake = Decimal(config["drawdown_brake"])
        if not brake.is_finite() or not 0 < brake <= live_brake.BRAKE_MAX:
            raise ValueError
        duration = config["duration_seconds"]  # None: the run goes on until it is stopped
        if duration is not None and (type(duration) is not int or duration < 1):
            raise ValueError
        if not is_leverage(config["leverage"]) or config["environment"] not in VENUES:
            raise ValueError
        market = value["market"]
        if not isinstance(market["market_day"], str) or any(not isinstance(market["terms"][symbol], dict)
                                                            for symbol in symbols):
            raise ValueError
        if not isinstance(value["strategy_file"], str) or not isinstance(value["universe_file"], str):
            raise ValueError
        evidence = value["evidence"]
        if not isinstance(evidence, list) or any(
                type(item["trial_id"]) is not int or not Decimal(item["starting_balance_usdt"]).is_finite()
                or not re.fullmatch(r".+@sha256:[0-9a-f]{64}", item["image_ref"]) for item in evidence):
            raise ValueError
        return value
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise Refusal("LIVE_MANIFEST_INVALID", "Live needs a complete immutable manifest") from exc



def latest_start(output: Path) -> list[dict]:
    """The journal from the run's latest start (its last `preflight` of mode run) on; a damaged journal raises
    (engine.live_records.journal)."""
    rows = journal(output)
    starts = [index for index, row in enumerate(rows) if row.get("event") == "preflight" and row.get("mode") == "run"]
    return rows[starts[-1] if starts else 0:]


def resumable(output: Path) -> bool:
    """Whether this armed run may start again: its latest start did not end it, and no stop was asked for."""
    if (output / "STOP").exists():
        return False
    try:
        rows = latest_start(output)
    except (OSError, ValueError, Refusal):
        return False
    return not any(row.get("event") in ENDED_EVENTS for row in rows)


def warmup_retry(output: Path) -> bool:
    """The latest start ended to warm up again after a missing bar (rewarming), not as the retry of a failed warm-up:
    if this start's warm-up fails, the run starts once more (the user, 2026-11-13). Read before this start writes."""
    try:
        rows = latest_start(output)
    except (OSError, ValueError, Refusal):
        return False
    ended = next((row for row in rows if row.get("event") == "rewarming"), None)
    return ended is not None and not ended.get("retry")


def start_ended(session: Session) -> None:
    """The event of a start that ends without ending the run; a rewarming after a failed warm-up says it is the retry
    (warmup_retry)."""
    session.event("held_flat" if session.held_flat else "rewarming" if session.rewarming else "interrupted",
                  mode=session.mode, **({"retry": True} if session.rewarming and session.warmup_retried else {}))


def bind_manifest(output: Path, manifest: dict) -> None:
    """A directory can never be rebound to a different account, source or image."""
    path = output / "manifest.json"
    if path.exists():
        if json.loads(read_regular_file(path)) != manifest:
            raise Refusal("LIVE_IDENTITY_CHANGED", "the retained manifest does not match this execution")
    else:
        write_json(path, manifest)



def venue_flat(session: Session, snapshot: dict, observation: str) -> bool:
    """Reconciliation's other way out. A close made at Binance has no order this process knows, so native
    reconciliation never matches it: on a hedge account the unmatched quantity becomes a separate EXTERNAL
    position. A flat whole account releases the run instead; the next run gets a fresh native identity. It is
    read with the run's own credential binding, before any mode check: changed account settings must not keep
    the slot of an empty account."""
    if any(not isinstance(snapshot.get(name), list) for name in ("positions", "orders", "algo_orders")):
        raise Refusal("LIVE_ACCOUNT_RESPONSE", "release needs complete position and order lists from the venue")
    try:
        require_flat(snapshot)
    except Refusal as exc:
        if exc.code != "LIVE_ACCOUNT_NOT_FLAT":
            raise
        return False
    session.event("venue_flat", observation=observation)
    return True



def execute(args) -> int:
    os.umask(0o077)
    manifest = read_manifest(args.manifest)
    credentials = read_credentials(args.credentials_file)
    if credentials.binding != manifest["credential_binding"]:
        raise Refusal("LIVE_ACCOUNT_BINDING", "the credential does not match the private execution binding")
    if importlib.metadata.version("nautilus_trader") != "2.0.0rc7":
        raise Refusal("LIVE_RUNTIME_VERSION", "Live requires the reviewed Nautilus version")
    args.output.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = (args.output / "runner.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        raise Refusal("LIVE_ALREADY_RUNNING", "this execution already has a runner") from None
    with lock:
        bind_manifest(args.output, manifest)
        resuming = args.mode == "run" and (args.output / "armed.json").is_file()
        if resuming and not resumable(args.output):  # judged before this start writes its own events
            raise Refusal("LIVE_COLD_RESTART", "this run ended or was asked to stop; it can only reconcile")
        session = Session(manifest, args.output, args.mode, warmup_retry=resuming and warmup_retry(args.output),
                          begun_stop=begun_stop(journal(args.output)) if resuming else None)
        try:
            return start(args, manifest, credentials, session, resuming)
        except Exception as exc:
            # An armed run that ends by its own refusal or failure says so, whatever raised it (the final account read
            # after a native exit, a missing cache, changed account modes): with no ending event the control would
            # take the exit for an interruption and start a failed run again.
            if args.mode == "run" and os.path.lexists(args.output / "armed.json") and not session.ended:
                session.event("unresolved", failure_type=type(exc).__name__, strict=False,
                              code=exc.code if isinstance(exc, Refusal) else None)
            raise


def start(args, manifest: dict, credentials, session: Session, resuming: bool) -> int:
    """One start of the execution under its lock: the account read, then the mode's own work."""
    venue = VENUES[manifest["config"]["environment"]]
    observer = BinanceReadOnly(credentials, origin=venue["rest"], proxy_url=manifest["config"].get("proxy_url"))
    session.account_reader = observer
    try:
        clock = observer.clock() if args.mode in ("preflight", "run") else None
        snapshot = observer.snapshot(manifest["symbols"])
        read_ns = time.time_ns()
        if clock is not None:
            snapshot["clock"] = clock
        if resuming:
            require_clock(snapshot)
    except Refusal as exc:
        if not resuming or exc.code not in GIVEN_BACK:
            raise
        # Before anything was built or written: nothing changed, so this start ends as an interruption does and the
        # control starts the run again, within its hourly limit. `live logs` shows the line.
        print(str(exc), file=sys.stderr)
        return INTERRUPTED
    observation = keep(args.output, "preflight", snapshot)
    session.event("preflight", mode=args.mode, observation=observation)
    loaded = None
    if resuming:
        require_account_mode(snapshot, manifest, read_ns=read_ns)
        if session.begun_stop is not None:
            session.mode = "finish"  # no source, on a flat account too: the run is over once the stop is finished
        else:
            try:
                require_flat(snapshot)
            except Refusal as exc:
                if exc.code != "LIVE_ACCOUNT_NOT_FLAT":
                    raise
                session.mode = "held"  # observe only until the account is flat; the user is told
        session.armed_ns = json.loads(read_regular_file(args.output / "armed.json"))["observed_ns"]
        live_brake.resume(session, args.output)  # the first arming's cash floor and the highest equity since
        session.event("resuming", held=session.mode != "run", observation=observation)
        if session.mode == "held":
            # The hold begins: whether each inherited position has its stop at Binance, from the same read.
            live_connection.held_verdict(session, snapshot, observation)
        if session.mode == "run":
            loaded = source_for_run(manifest)
    elif args.mode in ("preflight", "run"):
        require_clock(snapshot)
        live_brake.arm(session, snapshot)
        require_admission(snapshot, manifest, session.brake.budget)  # flat: the run starts on a flat account
        backing = require_evidence(snapshot, manifest)
        session.event("replay_evidence", trial_id=backing["trial_id"], starting_balance_usdt=backing["starting_balance_usdt"])
        loaded = source_for_run(manifest)
    if args.mode == "preflight":
        return 0
    if resuming:
        pass  # armed already; the account slot is still this run's
    elif args.mode == "run":
        try:
            with (args.output / "armed.json").open("x") as stream:
                # The arming's account observation: the run's cash floor and first equity (engine.live_brake).
                json.dump({"run_id": manifest["run_id"], "observed_ns": time.time_ns(), "observation": observation},
                          stream)
                stream.flush()
                os.fsync(stream.fileno())
            # The host releases an account slot on this file's absence, so it must survive a crash.
            directory = os.open(args.output, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        except FileExistsError:
            # An armed run resumes (resuming above); this armed.json is not a regular file.
            raise Refusal("LIVE_COLD_RESTART", "armed.json exists but is not a regular file, so this start can "
                                               "neither arm nor resume the run") from None
        # The run's first highest equity: its start, from which the brake and the page's chart count.
        session.event("equity_peak", equity=str(session.brake.peak), observed_ns=snapshot["observed_ns"])
    else:
        if not (args.output / "armed.json").is_file():
            raise Refusal("LIVE_RUN_MISSING", "reconciliation needs the original armed execution")
        if venue_flat(session, snapshot, observation):
            return 0
        require_account_mode(snapshot, manifest)
    # Metrics of the run's contracts come from REST (engine.metrics.Feed); trades are served nowhere in Live.
    strategy_runtime.begin_run(args.output, {"Metrics": {str(contract(symbol)) for symbol in manifest["symbols"]}})
    with Signals(lambda _: session.interrupt_requested.set()):
        cache = LiveCache(args.output, resume=args.mode == "reconcile" or resuming)
        session.cache_guard = cache
        node = None
        try:
            node = build_node(session, credentials, cache.config, loaded, source_module=__name__)
            if session.mode == "run":
                session.kline_events = KlineEvents(manifest["symbols"], manifest["config"].get("proxy_url"),
                                                   functools.partial(kline_connect, host=venue["stream"]))
                session.kline_events.start()
            session.event("connecting", mode=args.mode)
            node.run()
            source_outcome(session, node.cache)
            session.check_storage()
            # Late fills/cancels may arrive during native shutdown's residual-event grace.
            # Recheck the whole cache at the completed boundary, never a stale timer cut.
            observed_flat = not (pending_orders(node.cache) or node.cache.positions_open())
            session.native_flat = observed_flat and (session.native_flat or args.mode == "reconcile") \
                and not (session.persistence_failed or session.journal_failed or session.connection_failed
                         or session.interrupting or session.held_flat or session.rewarming)
        except BaseException as exc:
            session.event("unresolved", failure_type=type(exc).__name__, strict=False,
                          code=exc.code if isinstance(exc, Refusal) else None)
            raise
        finally:
            try:
                if session.kline_events is not None:
                    session.kline_events.stop()
                    session.record_kline_events()
                    session.kline_events = None
                if node is not None:
                    session.evidence.reports(node.cache, Venue("BINANCE"))
                    node.dispose()
                session.node, session.entry_gate = None, None
                session.sources, session.keepers = {}, {}
                strategy_runtime.STRATEGIES.clear()  # its instances are released here too, on the thread that built them
                if session.warmup_catalog is not None:
                    shutil.rmtree(session.warmup_catalog, ignore_errors=True)
            finally:
                try:
                    if strategy_runtime.FAILURES:
                        strategy_runtime.write_failures()  # the final counts
                except Exception as error:  # the failure that ends the run must stay the one raised
                    print(f"runtime failure receipts not written: {error}", file=sys.stderr)
                try:
                    cache.close()
                except Refusal:
                    session.persistence_failed, session.native_flat = True, False
                    session.event("unresolved", reason="persistence_shutdown_failure", strict=False)
                    raise
    if session.native_flat or session.stop_venue_flat:
        # After a stop whose read came before its closes, a close rejected or expired beside a late fill can leave
        # Binance holding a leg, so that run too is released only on a read taken after them (#3727).
        final_snapshot = observer.snapshot(manifest["symbols"])
        observation = keep(args.output, "final-account", final_snapshot)
        require_flat(final_snapshot)
        if session.native_flat:
            session.event("clean_stop" if args.mode == "run" else "reconciled_flat",
                          source_failed=session.failed, observation=observation)
        else:
            session.event("venue_flat", strict=False, observation=observation, native_positions=True)
        return 1 if session.failed else 0
    if session.venue_flat:
        # Binance held nothing while the native cache still held a position (engine.live_connection.venue_flat_exit):
        # the run is over with its venue_flat event, as after a reconciliation that finds the account flat.
        return 1 if session.failed else 0
    # A finishing start reloads the refused orders of the start it follows, which failed the run, not this interruption.
    if (session.interrupting or session.held_flat or session.rewarming) and (
            not session.failed or session.mode == "finish" and not session.ended):
        # Positions and their exchange stops stay; the control starts this run again (live.runs).
        start_ended(session)
        return INTERRUPTED
    if session.mode in ("run", "finish") or session.mode == "held" and session.failed:
        session.event("unresolved", mode=args.mode)
        return 1
    final_snapshot = observer.snapshot(manifest["symbols"])
    observation = keep(args.output, "final-account", final_snapshot)
    if not venue_flat(session, final_snapshot, observation):
        session.event("reconcile_stopped", mode=args.mode)
    return 0



def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--credentials-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=("preflight", "run", "reconcile"), required=True)
    args = parser.parse_args(argv)
    try:
        return execute(args)
    except Refusal as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:
        # Native transport errors can carry signed URLs. Do not print exception text.
        print(f"LIVE_UNRESOLVED: {type(exc).__name__}; private originals retained", file=sys.stderr)
        return 1



if __name__ == "__main__":
    raise SystemExit(main())
