"""One Live loopback run: a fake venue, a run directory the host would prepare, and the real runner in a subprocess.

    with Loopback() as run:
        run.start()                       # engine.live --mode run, origins on the fake venue
        run.wait_event("connecting")
        run.venue.bar("BTCUSDT", 76000, volume=2)   # the next minute's kline: the probe enters
        run.wait(lambda: run.venue.open_algos())    # its stop is at the venue
        run.stop()                        # the STOP file, as `live stop` writes it
        run.wait_exit()

The credential is a fixed throwaway test key (KEY, SECRET) the fake venue checks signatures with; no real credential, host or network
is involved. Output (events.jsonl, the runner's stdout and stderr) stays in a temporary directory removed on exit.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
import hashlib
import json
import os
import resource
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

from engine.config import RUNTIME_CONTRACT
from engine.live_venue import MANIFEST_FORMAT, Credentials
from engine.live_records import strategy_ids
from tests.live_loopback.probe_source import SOURCE
from tests.live_loopback.venue import Venue

ROOT = Path(__file__).resolve().parents[2]
SYMBOL = "BTCUSDT"
# The throwaway test key the fake venue checks signatures with; the credentials file holds the same literal.
KEY, SECRET = "loopback-key", "loopback-secret"
TERMS = {"price": "76000", "tick": "0.10", "step": "0.001", "min_notional": "50"}
# rc7 keeps Nautilus's cache in Redis in the runtime image; a host without its Redis runs with Nautilus's in-memory
# cache instead (tests.live_loopback.runner.MemoryCache): such a run proves nothing about persistence.
MEMORY_CACHE = not Path("/opt/trade/redis/redis-server").exists()


def needs_redis(test):
    """Marks a test, or a class of tests, whose later start reloads the native cache. Only the runtime image's check
    (.github/scripts/check-native-runtime.py) runs these: it selects them by this mark."""
    test.needs_redis = True
    return unittest.skipIf(MEMORY_CACHE, "a start again needs the runtime image's Redis")(test)


class Loopback:
    def __init__(self, *, wallet: str = "100", source: str = SOURCE, terms: dict | None = None,
                 environment: str = "live", venue_key: tuple[str, str] | None = None):
        """`environment`: the run's (its manifest's config.environment); the runner puts the fake venue on that
        environment's hosts alone. `venue_key`: the key the venue's account knows, when not the run's (another
        environment's key)."""
        self.environment = environment
        self.temp = tempfile.TemporaryDirectory(prefix="live-loopback-")
        self.root = Path(self.temp.name)
        self.output = self.root / "run"
        self.credentials_file = self.root / "credentials.json"  # the 0600 file `live serve` would prepare
        self.credentials_file.write_bytes(b'{"api_key":"loopback-key","api_secret":"loopback-secret"}')
        os.chmod(self.credentials_file, 0o600)
        self.credentials = Credentials(KEY, SECRET)
        known = venue_key or (self.credentials.api_key, self.credentials.api_secret)
        self.venue = Venue(api_key=known[0], api_secret=known[1],
                           symbols={SYMBOL: dict(TERMS, **(terms or {}))}, wallet=wallet)
        self.process: subprocess.Popen | None = None
        self.stdout = None
        self.manifest = self._prepare(source, wallet)

    def __enter__(self) -> Loopback:
        self.venue.start()
        return self

    def __exit__(self, *exc) -> None:
        try:
            if self.process is not None and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(30)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
        finally:
            if self.stdout is not None:
                self.stdout.close()
            self.venue.close()
            if os.environ.get("LIVE_LOOPBACK_KEEP"):
                kept = Path(os.environ["LIVE_LOOPBACK_KEEP"]) / f"{self.manifest['run_id']}-{time.time_ns()}"
                shutil.copytree(self.root, kept, ignore=shutil.ignore_patterns("credentials.json"))
                (kept / "requests.json").write_text(json.dumps(self.venue.requests))
            self.temp.cleanup()

    def _prepare(self, source: str, wallet: str) -> dict:
        strategy, universe = self.root / "source.py", self.root / "universe.json"
        strategy.write_text(source)
        universe.write_text(json.dumps({"membership": {SYMBOL: [[0, 9999999999999999999]]}}))
        image = "ghcr.io/qoeop/trade-runtime@sha256:" + "a" * 64
        manifest = {
            "format": MANIFEST_FORMAT, "run_id": "loopback-" + os.urandom(4).hex(), "trader_id": "LIVE-001",
            "account_id": "BINANCE-LOOPBACK", "credential_binding": self.credentials.binding, "symbols": [SYMBOL],
            "candidate": {"strategy_id": "loopback-probe", "revision": 1},
            "source": {"entry_class": "Probe", "source_sha256": hashlib.sha256(source.encode()).hexdigest()},
            "runtime": {"image_ref": image, "image_digest": "sha256:" + "a" * 64, "runtime_contract": RUNTIME_CONTRACT},
            "config": {"environment": self.environment, "drawdown_brake": "0.15", "duration_seconds": None, "leverage": "50"},
            "market": {"market_day": datetime.now(UTC).date().isoformat(), "terms": {SYMBOL: {
                "price_increment": self.venue.terms[SYMBOL]["tick"], "size_increment": self.venue.terms[SYMBOL]["step"],
                "min_notional": self.venue.terms[SYMBOL]["min_notional"]}}},
            "strategy_file": str(strategy), "universe_file": str(universe),
            "universe_sha256": hashlib.sha256(universe.read_bytes()).hexdigest(),
            "evidence": [{"trial_id": 1, "starting_balance_usdt": str(Decimal(wallet)), "image_ref": image}],
        }
        (self.root / "manifest.json").write_text(json.dumps(manifest))
        return manifest

    @property
    def strategy_id(self) -> str:
        return strategy_ids(self.manifest)[SYMBOL]

    def start(self, mode: str = "run", *, file_size_limit: int | None = None) -> None:
        """`file_size_limit`: RLIMIT_FSIZE for the runner, a full disk for every file it writes (Python ignores
        SIGXFSZ, so a write past it fails with EFBIG)."""
        command = [sys.executable, "-m", "tests.live_loopback.runner", "--http", self.venue.http_origin,
                   "--ws", self.venue.ws_origin, "--environment", self.environment, *(["--memory-cache"] if MEMORY_CACHE else []), "--",
                   "--manifest", str(self.root / "manifest.json"), "--credentials-file",
                   str(self.credentials_file), "--output", str(self.output), "--mode", mode]
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith(("BINANCE", "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"))}
        environment["NO_PROXY"] = environment["no_proxy"] = "127.0.0.1"
        if self.stdout is not None:
            self.stdout.close()  # an earlier start's
        self.stdout = (self.root / f"runner-{mode}.out").open("w")
        def limit():
            if file_size_limit is not None:
                resource.setrlimit(resource.RLIMIT_FSIZE, (file_size_limit, resource.RLIM_INFINITY))

        self.process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=self.stdout,
                                        stderr=subprocess.STDOUT, text=True, preexec_fn=limit)

    def stop(self) -> None:
        """What `live stop` asks: the STOP file, which the runner observes."""
        (self.output / "STOP").touch()

    def interrupt(self) -> None:
        self.process.terminate()

    def events(self) -> list[dict]:
        path = self.output / "events.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    def log(self) -> str:
        path = self.root / "runner-run.out"
        return path.read_text(errors="replace") if path.exists() else ""

    def wait(self, condition, timeout: float = 150, what: str = "condition"):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            found = condition()
            if found:
                return found
            if self.process is not None and self.process.poll() is not None:
                found = condition()
                if found:
                    return found
                raise AssertionError(f"runner exited ({self.process.returncode}) before {what}\n"
                                     f"{self.log()[-4000:]}\n{json.dumps(self.events()[-10:], indent=1)}")
            time.sleep(0.2)
        raise AssertionError(f"timed out waiting for {what}\n{self.log()[-4000:]}\n"
                             f"{json.dumps(self.events()[-10:], indent=1)}")

    def wait_event(self, name: str, timeout: float = 150, **fields) -> dict:
        return self.wait(lambda: next((row for row in self.events() if row.get("event") == name
                                       and all(row.get(key) == value for key, value in fields.items())), None),
                         timeout, f"event {name}")

    def ready(self, timeout: float = 150) -> int:
        """Wait until the source has warmed up and the kline closing at its warm-up time T has gone by: a bar planned
        now (Venue.bar) is the first the source trades on. Returns T in ns."""
        at = self.wait_event("warmup", timeout)["at_ns"]
        while time.time_ns() < at + 1_000_000_000:
            time.sleep(0.1)
        return at

    def enter(self) -> None:
        """Warm up, then the probe's long entry (command 2): returns once its stop is working at the venue."""
        self.ready()
        self.venue.bar(SYMBOL, TERMS["price"], volume=2)
        self.wait(lambda: self.venue.open_algos(), what="the entry's stop at the venue")

    def named(self, event: str) -> list[dict]:
        return [row for row in self.events() if row.get("event") == event]

    def native(self, kind: str) -> list[dict]:
        return [row["native"] for row in self.events() if (row.get("native") or {}).get("type") == kind]

    def wait_exit(self, timeout: float = 120) -> int:
        try:
            return self.process.wait(timeout)
        except subprocess.TimeoutExpired:
            raise AssertionError(f"runner did not exit\n{self.log()[-4000:]}") from None
