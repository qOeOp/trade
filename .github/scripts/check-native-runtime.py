"""Exercise the built image on its native CI runner, with no venue or host Docker access.

The small protected-entry replay is a packaging regression check, not the paired CLI acceptance in engine/README.md.
"""

import argparse
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, nullcontext
import importlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time
import unittest


@contextmanager
def service_test_imports(validation: Path):
    """Child interpreters use image product packages, even from the mounted fixture cwd."""
    previous = {name: os.environ.get(name) for name in ("PYTHONPATH", "PYTHONSAFEPATH")}
    os.environ["PYTHONPATH"] = os.pathsep.join(("/opt/trade", "/opt/trade/ide"))
    os.environ["PYTHONSAFEPATH"] = "1"
    try:
        # Deliberately use the mounted checkout as cwd: it must not replace packaged code,
        # even if a future subprocess fixture changes directories before invoking Python.
        subprocess.run([sys.executable, "-c", """
import importlib
from pathlib import Path
for name in ('cli', 'live', 'deploy', 'deploy.live_configuration'):
    module = importlib.import_module(name)
    expected = Path('/opt/trade') / name.split('.')[0]
    assert Path(module.__file__).resolve().is_relative_to(expected), module.__file__
"""], cwd=validation, check=True, timeout=30)
        yield
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def check_live_native_cache() -> None:
    """Round-trip native general bytes through the packaged Redis AOF, without a venue."""
    from nautilus_trader.core import UUID4
    from nautilus_trader.infrastructure import RedisCacheDatabase
    from nautilus_trader.model import TraderId

    from engine import redis_child
    from engine.live_cache import LiveCache

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
                    json.dumps(redis_child.connection(cache.port)).encode(),
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

    from engine.live_cache import LiveCache
    from engine import redis_child
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
            json.dumps(redis_child.connection(cache.port)).encode())
        try:
            assert redis_child.command(cache.port, "CONFIG", "SET", "maxmemory", "1") == b"OK"
            # INFO and PING still work, but the actual durable write is rejected.
            assert redis_child.command(cache.port, "PING") == b"PONG"
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


def _cases(suite: unittest.TestSuite) -> Iterator[unittest.TestCase]:
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            yield from _cases(test)
        else:
            yield test


def redis_restart_tests(root: Path) -> list[str]:
    """The Live loopback tests that start a run again on its native cache (tests.live_loopback.harness.needs_redis).
    Quality runs the others, and skips these: it has no Redis."""
    suite = unittest.defaultTestLoader.discover(str(root / "tests/live_loopback"), top_level_dir=str(root))
    names = []
    for test in _cases(suite):
        method = getattr(type(test), test._testMethodName, None)
        if method is None:  # a module that does not import
            test.debug()
        if getattr(test, "needs_redis", False) or getattr(method, "needs_redis", False):
            names.append(test.id())
    return names


def check_live_restarts(root: Path) -> None:
    """Each test in its own process, as many at once as the runner has CPUs: they mostly wait on their runner. Engine
    code is the image's; the tests, and the host packages they read a journal with, are the checkout's."""
    environment = {**os.environ, "PYTHONPATH": os.pathsep.join(("/opt/trade", str(root))), "PYTHONSAFEPATH": "1"}

    def python(*argv: str, timeout: int) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, *argv], cwd=root, env=environment, capture_output=True, text=True,
                              check=False, timeout=timeout)

    found = python("-c", "import engine; print(engine.__file__)", timeout=30)
    assert found.stdout.strip() == "/opt/trade/engine/__init__.py", (found.stdout, found.stderr)

    def run(name: str) -> tuple[str, subprocess.CompletedProcess, float]:
        start = time.monotonic()
        try:
            done = python("-m", "unittest", name, timeout=600)
        except subprocess.TimeoutExpired as exc:
            done = subprocess.CompletedProcess(exc.cmd, 1, "", f"{exc}\n{exc.stderr!r}")
        return name, done, time.monotonic() - start

    names = redis_restart_tests(root)
    assert names, "no Live loopback test needs Redis"
    failed = []
    with ThreadPoolExecutor(os.process_cpu_count() or 1) as pool:
        for name, done, seconds in pool.map(run, names):
            passed = done.returncode == 0 and "skipped=" not in done.stderr
            print(f"=== {name}: {'ok' if passed else 'FAILED'} in {seconds:.1f} s", flush=True)
            if not passed:
                failed.append(name)
                print(done.stdout + done.stderr, flush=True)
    assert not failed, failed


def check_replay_image(output: Path) -> None:
    """The replay image holds its closure and nothing Paper or Live runs; a protected-entry replay passes its audit."""
    from engine.config import AUDIT_PATH, RUNTIME_SOURCE_PATHS

    shipped = {path.name for path in Path("/opt/trade/engine").glob("*.py")}
    expected = {Path(path).name for path in (*RUNTIME_SOURCE_PATHS.values(), AUDIT_PATH)}
    assert shipped == expected, sorted(shipped ^ expected)
    for name in sorted(expected - {"__init__.py"}):
        importlib.import_module(f"engine.{name.removesuffix('.py')}")
    for name in ("engine.paper", "engine.live"):
        try:
            importlib.import_module(name)
        except ModuleNotFoundError:
            continue
        raise AssertionError(f"the replay image holds {name}")
    from tests.engine.test_fill_model import audited_replay

    output.mkdir(parents=True, exist_ok=True)
    audit = audited_replay(output / "reports")
    assert audit["passed"], audit
    (output / "audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    print(f"Native {platform.machine()} replay image: closure only, protected-entry replay passed")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("replay", "runtime", "service", "ide"))
    parser.add_argument("arch", choices=("arm64", "amd64"))
    parser.add_argument("--output", type=Path, default=Path("/tmp/native-check"))
    args = parser.parse_args()
    expected = {"arm64": "aarch64", "amd64": "x86_64"}[args.arch]
    assert platform.machine() == expected, (platform.machine(), expected)
    # Resolve product packages before exposing the checkout's tests. Otherwise tests might
    # silently exercise mounted sources instead of the image we are about to publish.
    packages = ("engine",) if args.kind in ("replay", "runtime") else (
        "cli", "deploy", "engine", "ledger", "live", "market", "paper", "registration", "replay",
        "report", "runtime", "shared")
    for package in packages:
        module = importlib.import_module(package)
        assert module.__file__ is not None
        assert Path(module.__file__).resolve().is_relative_to("/opt/trade"), module.__file__
    if args.kind not in ("replay", "runtime"):
        module = importlib.import_module("deploy.live_configuration")
        assert module.__file__ is not None
        assert Path(module.__file__).resolve().is_relative_to("/opt/trade/deploy"), module.__file__
    sys.path.insert(0, "/opt/trade/ide")
    if args.kind not in ("replay", "runtime"):
        module = importlib.import_module("research_graph")
        assert module.__file__ is not None
        assert Path(module.__file__).is_relative_to("/opt/trade/ide"), module.__file__
    sys.path.insert(0, "/validation")
    if args.kind == "replay":
        check_replay_image(args.output)
        return
    if args.kind == "runtime":
        suite = unittest.defaultTestLoader.discover("/validation/tests/engine", top_level_dir="/validation")
    elif args.kind == "service":
        version = subprocess.check_output(["dolt", "version"], text=True)
        assert version.startswith("dolt version 2.7.2"), version
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            "tests.ledger.test_replica", "tests.paper.test_remote_control", "tests.paper.test_serve", "tests.paper.test_release",
            "tests.research_graph.test_research_sync"])
        # These use isolated custody, fake keys and simulated Docker/venue responses. The
        # container also has no network or host Docker socket; Live imports stay in the image.
        suite.addTests(unittest.defaultTestLoader.discover("/validation/tests/live", top_level_dir="/validation"))
    else:
        from research_graph.render import built_page

        assert built_page()
        assert subprocess.check_output(["node", "--version"], text=True).startswith("v24.")
        print(f"Native {args.arch} IDE page and Node loaded")
        return
    with service_test_imports(Path("/validation")) if args.kind == "service" else nullcontext():
        result = unittest.TextTestRunner(verbosity=2).run(suite)
    assert result.wasSuccessful(), "native image checks failed"
    assert not result.skipped, result.skipped
    if args.kind == "runtime":
        from engine.config import ACCOUNT_CONTRACT
        from engine.paper_redis import NativeCache
        from tests.engine.test_fill_model import audited_replay

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
        check_live_restarts(Path("/validation"))
        audit = audited_replay(args.output / "reports")
        assert audit["passed"], audit
        (args.output / "audit.json").write_text(json.dumps(audit, indent=2) + "\n")
        print(f"Native {args.arch} Paper Redis snapshot/reload, Live native AOF reopen, "
              "Live restarts on it and protected-entry replay passed")


if __name__ == "__main__":
    main()
