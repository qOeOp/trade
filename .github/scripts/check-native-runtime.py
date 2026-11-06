"""Exercise the built image on its native CI runner, with no venue or host Docker access.

The small bracket replay is a packaging regression check, not the paired CLI acceptance in engine/README.md.
"""

import argparse
import importlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time
import unittest


def check_live_native_cache() -> None:
    """Round-trip native general bytes through the packaged Redis AOF, without a venue."""
    from nautilus_trader.core import UUID4
    from nautilus_trader.infrastructure import RedisCacheDatabase
    from nautilus_trader.model import TraderId

    from engine.live_cache import LiveCache, NATIVE_CONNECTION

    trader = TraderId("LIVE-NATIVE-CI")
    key = "general:live-native-ci"
    expected = [b"native-live-aof-v1\x00\xff"]
    cache_config = json.dumps({"encoding": "json", "use_instance_id": False}).encode()

    with tempfile.TemporaryDirectory(prefix="live-native-cache-check-") as directory:
        output = Path(directory)
        for resume in (False, True):
            cache = LiveCache(output, resume=resume)
            cache.health()
            database = None
            try:
                database = RedisCacheDatabase(
                    trader, UUID4(), cache_config,
                    json.dumps({"host": "127.0.0.1", "port": cache.port, **NATIVE_CONNECTION}).encode(),
                )
                if not resume:
                    assert database.read(key) == [], "a new private cache is not empty"
                    database.insert(key, expected)
                    # Native writes use an asynchronous FIFO. Readback proves the actual
                    # native writer reached Redis before its clean shutdown.
                    deadline = time.monotonic() + 5
                    while database.read(key) != expected and time.monotonic() < deadline:
                        time.sleep(0.02)
                assert database.read(key) == expected, ("native Live cache bytes differ", resume)
            finally:
                try:
                    if database is not None:
                        database.close()
                finally:
                    cache.close()
            assert cache.process.returncode == 0, "native Live Redis did not stop cleanly"
            assert any((output / "native-cache" / "appendonlydir").glob("*.aof")), "native AOF is absent"


def _live_cache_failure_child() -> None:
    """Fault only this disposable cache; the outer process bounds native teardown."""
    from nautilus_trader.common import CacheConfig, Environment, LoggerConfig, LogLevel
    from nautilus_trader.core import UUID4
    from nautilus_trader.infrastructure import RedisCacheDatabase
    from nautilus_trader.live import LiveExecutionEngineConfig, LiveNode
    from nautilus_trader.model import StrategyId, TraderId
    from nautilus_trader.trading import Strategy, StrategyConfig

    from engine.live_cache import LiveCache, NATIVE_CONNECTION, redis_command
    from engine.live_errors import LiveRefusal

    def must_refuse(operation):
        try:
            operation()
        except LiveRefusal as exc:
            assert exc.code == "LIVE_CACHE_HEALTH", exc.code
        else:
            raise AssertionError("failed persistence was accepted")

    with tempfile.TemporaryDirectory(prefix="live-cache-denied-") as directory:
        cache = LiveCache(Path(directory), resume=False)
        database = RedisCacheDatabase(TraderId("LIVE-FAULT-CI"), UUID4(),
            json.dumps({"encoding": "json", "use_instance_id": False}).encode(),
            json.dumps({"host": "127.0.0.1", "port": cache.port, **NATIVE_CONNECTION}).encode())
        try:
            assert redis_command(cache.port, "CONFIG", "SET", "maxmemory", "1") == b"OK"
            # INFO and PING still work, but the actual durable write is rejected.
            assert redis_command(cache.port, "PING") == b"PONG"
            must_refuse(cache.health)
            database.insert("general:rejected-native-write", [b"not durable"])
            started = time.monotonic()
            database.close()
            assert time.monotonic() - started < 10, "native database close exceeded its fault budget"
        finally:
            database.close()
            must_refuse(cache.close)

    with tempfile.TemporaryDirectory(prefix="live-cache-dead-") as directory:
        cache = LiveCache(Path(directory), resume=False)
        builder = LiveNode.builder("native-cache-failure", TraderId("LIVE-DEAD-CI"), Environment.LIVE)
        builder.with_logging(LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False))
        builder.with_cache_config(CacheConfig(use_instance_id=False, flush_on_start=False))
        builder.with_cache_database_factory(cache.config)
        builder.with_exec_engine_config(LiveExecutionEngineConfig(reconciliation=False))
        builder.with_delay_post_stop_secs(0).with_timeout_connection(2).with_timeout_portfolio(2)
        builder.with_timeout_disconnection_secs(2)
        node = builder.build()  # No data or execution clients: no possible venue connection.
        observed = []

        class Fault(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("FAULT-001")))

            def on_start(self):
                self.cache.add("before-cache-failure", b"one")
                cache.process.kill()
                cache.process.wait(timeout=2)
                must_refuse(cache.health)
                self.cache.add("after-cache-failure", b"two")
                observed.append("failed-backend")
                node.handle().stop()

        node.add_strategy(Fault())
        started = time.monotonic()
        try:
            node.run()
        finally:
            node.dispose()
            must_refuse(cache.close)
        assert observed == ["failed-backend"], observed
        assert time.monotonic() - started < 15, "native node disposal exceeded its failed-backend budget"


def check_live_native_cache_failure() -> None:
    subprocess.run([sys.executable, "-c",
        "import runpy,sys; runpy.run_path(sys.argv[1])['_live_cache_failure_child']()", str(Path(__file__).resolve())],
        check=True, timeout=25)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("runtime", "service", "ide"))
    parser.add_argument("arch", choices=("arm64", "amd64"))
    parser.add_argument("--output", type=Path, default=Path("/tmp/native-check"))
    args = parser.parse_args()
    expected = {"arm64": "aarch64", "amd64": "x86_64"}[args.arch]
    assert platform.machine() == expected, (platform.machine(), expected)
    # Resolve product packages before exposing the checkout's tests. Otherwise tests might
    # silently exercise mounted sources instead of the image we are about to publish.
    packages = ("engine",) if args.kind == "runtime" else (
        "cli", "engine", "ledger", "market", "paper", "qualification", "registration", "replay", "report", "runtime")
    for package in packages:
        module = importlib.import_module(package)
        assert Path(module.__file__).is_relative_to("/opt/trade"), module.__file__
    sys.path.insert(0, "/opt/trade/ide")
    if args.kind != "runtime":
        module = importlib.import_module("research_graph")
        assert Path(module.__file__).is_relative_to("/opt/trade/ide"), module.__file__
    sys.path.insert(0, "/validation")
    if args.kind == "runtime":
        suite = unittest.defaultTestLoader.discover("/validation/tests/engine", top_level_dir="/validation")
    elif args.kind == "service":
        version = subprocess.check_output(["dolt", "version"], text=True)
        assert version.startswith("dolt version 2.7.2"), version
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            "tests.ledger.test_replica", "tests.paper.test_remote_control", "tests.paper.test_serve", "tests.paper.test_release",
            "tests.research_graph.test_research_sync"])
    else:
        from research_graph.render import built_page

        assert built_page()
        assert subprocess.check_output(["node", "--version"], text=True).startswith("v24.")
        print(f"Native {args.arch} IDE page and Node loaded")
        return
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    assert result.wasSuccessful(), "native image checks failed"
    assert not result.skipped, result.skipped
    if args.kind == "runtime":
        from engine.config import ACCOUNT_CONTRACT
        from engine.paper_redis import NativeCache
        from tests.engine.test_partial_entry_protection import replay

        with tempfile.TemporaryDirectory(prefix="native-cache-check-") as directory:
            output = Path(directory)
            identity = "a" * 64
            cache = NativeCache(output, identity, ACCOUNT_CONTRACT["trader_id"])
            try:
                (output / "events.jsonl").write_bytes(b"")
                cache.snapshot(None, {"phase": "native-platform-check"})
            finally:
                cache.close()
            cache = NativeCache(output, identity, ACCOUNT_CONTRACT["trader_id"])
            try:
                assert cache.state() == {"phase": "native-platform-check"}
            finally:
                cache.close()
        args.output.mkdir(parents=True, exist_ok=True)
        check_live_native_cache()
        check_live_native_cache_failure()
        audit = replay(args.output / "reports")
        assert audit["passed"], audit
        (args.output / "audit.json").write_text(json.dumps(audit, indent=2) + "\n")
        print(f"Native {args.arch} Paper Redis snapshot/reload, Live native AOF reopen and bracket replay passed")


if __name__ == "__main__":
    main()
