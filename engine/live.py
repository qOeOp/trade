"""Separate Binance USD-M native Live entry point with explicit private inputs.

Paper retains its credential-free Sandbox contract. This entry point never
changes account settings and never resumes source callbacks after interruption.
"""

from __future__ import annotations

# Native network/worker threads must inherit the blocked mask. The dedicated
# sigwait thread turns process signals into the same owned-position STOP path.
if __name__ == "__main__":
    import signal
    signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT})

import argparse
from decimal import Decimal
import fcntl
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import threading
import time
from nautilus_trader.model import Venue
from engine import strategy as strategy_runtime
from engine.config import RUNTIME_CONTRACT, is_leverage
from engine.live_errors import LiveRefusal as Refusal
from engine.live_cache import LiveCache
from engine.live_venue import MANIFEST_FORMAT, BinanceReadOnly, read_credentials, require_clock, require_account_mode, require_admission, require_flat
from engine.load import read_regular_file
from engine.live_records import write_json
from engine.live_commands import pending_orders
from engine.live_session import Session
from engine.live_source import source_for_run
from engine.live_lifecycle import source_outcome
from engine.live_node import build_node


IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,80}\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")


def read_manifest(path: Path) -> dict:
    try:
        value = json.loads(read_regular_file(path))
        if value["format"] != MANIFEST_FORMAT or any(not IDENTIFIER.fullmatch(value[key])
                for key in ("run_id", "trader_id", "account_id")):
            raise ValueError
        if not HASH.fullmatch(value["credential_binding"]):
            raise ValueError
        symbols = value["symbols"]
        if not isinstance(symbols, list) or len(symbols) != 1 or not re.fullmatch(r"[A-Z0-9]+USDT", symbols[0]):
            raise ValueError
        source, candidate, runtime, config = value["source"], value["candidate"], value["runtime"], value["config"]
        if (runtime["runtime_contract"] != RUNTIME_CONTRACT
                or not HASH.fullmatch(source["source_sha256"])
                or not isinstance(candidate["strategy_id"], str) or type(candidate["revision"]) is not int
                or not HASH.fullmatch(value["universe_sha256"])
                or not re.fullmatch(r".+@sha256:[0-9a-f]{64}", runtime["image_ref"])
                or runtime["image_ref"].rsplit("@", 1)[1] != runtime["image_digest"]):
            raise ValueError
        for name in ("budget_usdt", "max_loss_usdt"):
            amount = Decimal(config[name])
            if not amount.is_finite() or amount <= 0:
                raise ValueError
        if Decimal(config["max_loss_usdt"]) > Decimal(config["budget_usdt"]):
            raise ValueError
        if type(config["duration_seconds"]) is not int or not 1 <= config["duration_seconds"] <= 86400:
            raise ValueError
        if not is_leverage(config["leverage"]):
            raise ValueError
        market = value["market"]
        if not isinstance(market["market_day"], str) or not isinstance(market["terms"][symbols[0]], dict):
            raise ValueError
        if not isinstance(value["strategy_file"], str) or not isinstance(value["universe_file"], str):
            raise ValueError
        return value
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise Refusal("LIVE_MANIFEST_INVALID", "Live needs a complete immutable single-symbol manifest") from exc



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
        session = Session(manifest, args.output, args.mode)
        observer = BinanceReadOnly(credentials, proxy_url=manifest["config"].get("proxy_url"))
        session.account_reader = observer
        clock = observer.clock() if args.mode in ("preflight", "run") else None
        snapshot = observer.snapshot(manifest["symbols"])
        if clock is not None:
            snapshot["clock"] = clock
        observation = "preflight-" + str(snapshot["observed_ns"]) + ".json"
        write_json(args.output / observation, snapshot)
        session.event("preflight", mode=args.mode, observation=observation)
        loaded = None
        if args.mode in ("preflight", "run"):
            require_clock(snapshot)
            require_admission(snapshot, manifest)  # flat by default: the run starts on a flat account
            loaded = source_for_run(manifest)
        if args.mode == "preflight":
            return 0
        if args.mode == "run":
            try:
                with (args.output / "armed.json").open("x") as stream:
                    json.dump({"run_id": manifest["run_id"], "observed_ns": time.time_ns()}, stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                # The host releases an account slot on this file's absence, so it must survive a crash.
                directory = os.open(args.output, os.O_RDONLY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            except FileExistsError:
                raise Refusal("LIVE_COLD_RESTART", "a previously armed run can only reconcile without source callbacks") from None
        else:
            if not (args.output / "armed.json").is_file():
                raise Refusal("LIVE_RUN_MISSING", "reconciliation needs the original armed execution")
            if venue_flat(session, snapshot, observation):
                return 0
            require_account_mode(snapshot, manifest)
        strategy_runtime.clear_failures()
        strategy_runtime.FAILURE_PATH = args.output / "runtime_failures.jsonl"
        signals = {signal.SIGTERM, signal.SIGINT}
        signal.pthread_sigmask(signal.SIG_BLOCK, signals)
        def await_signal():
            signal.sigwait(signals)
            session.stop_requested.set()
        threading.Thread(target=await_signal, daemon=True).start()
        cache = LiveCache(args.output, resume=args.mode == "reconcile")
        session.cache_guard = cache
        node = None
        try:
            node = build_node(session, credentials, cache.config, loaded, source_module=__name__)
            session.event("connecting", mode=args.mode)
            node.run()
            source_outcome(session, node.cache)
            session.check_storage()
            # Late fills/cancels may arrive during native shutdown's residual-event grace.
            # Recheck the whole cache at the completed boundary, never a stale timer cut.
            observed_flat = not (pending_orders(node.cache) or node.cache.positions_open())
            session.native_flat = observed_flat and (session.native_flat or args.mode == "reconcile") \
                and not (session.persistence_failed or session.journal_failed or session.connection_failed)
        except BaseException as exc:
            session.event("unresolved", failure_type=type(exc).__name__, strict=False,
                          code=exc.code if isinstance(exc, Refusal) else None)
            raise
        finally:
            try:
                if node is not None:
                    session.evidence.reports(node.cache, Venue("BINANCE"))
                    node.dispose()
                session.node, session.source = None, None
                if session.warmup_catalog is not None:
                    shutil.rmtree(session.warmup_catalog, ignore_errors=True)
            finally:
                try:
                    cache.close()
                except Refusal:
                    session.persistence_failed, session.native_flat = True, False
                    session.event("unresolved", reason="persistence_shutdown_failure", strict=False)
                    raise
        if session.native_flat:
            final_snapshot = observer.snapshot(manifest["symbols"])
            observation = "final-account-" + str(final_snapshot["observed_ns"]) + ".json"
            write_json(args.output / observation, final_snapshot)
            require_flat(final_snapshot)
            session.event("clean_stop" if args.mode == "run" else "reconciled_flat",
                          source_failed=session.failed, observation=observation)
            return 1 if session.failed else 0
        if args.mode == "run":
            session.event("unresolved", mode=args.mode)
            return 1
        final_snapshot = observer.snapshot(manifest["symbols"])
        observation = "final-account-" + str(final_snapshot["observed_ns"]) + ".json"
        write_json(args.output / observation, final_snapshot)
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
