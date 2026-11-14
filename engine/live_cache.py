"""Private native Redis persistence for Live; venue reconciliation owns recovery.

This is process custody, not a snapshot or an alternative account ledger. An
interrupted runner is only reopened in observation/reconciliation mode.
"""

from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
from typing import TypedDict

from nautilus_trader.infrastructure import RedisCacheConfig

from engine import redis_child
from engine.live_errors import LiveRefusal as Refusal


class NativeConnection(TypedDict):
    connection_timeout: int
    response_timeout: int
    number_of_retries: int
    max_delay: int


NATIVE_CONNECTION: NativeConnection = {"connection_timeout": 1, "response_timeout": 1,
                                      "number_of_retries": 0, "max_delay": 1}


class LiveCache:
    """One loopback-only Redis child with persistent native AOF bytes."""

    def __init__(self, output: Path, *, resume: bool):
        self.failure: str | None = None
        self.closed = False
        self.root = output / "native-cache"
        if resume and not (self.root / "appendonlydir").is_dir():
            raise Refusal("LIVE_CACHE_MISSING", "reconciliation needs the retained native cache")
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.root, 0o700)
        self.log = (output / "native-cache.log").open("ab")
        try:
            self.process, self.port = redis_child.start(self.root, [
                "--protected-mode", "yes", "--appendonly", "yes", "--appendfsync", "always",
                # A never-ending run: Redis rewrites the AOF once it doubles past 64 MB, so the expired health
                # probes and superseded values stop growing the file (design §3.9). Nautilus's own lists stay whole.
                "--save", "", "--auto-aof-rewrite-percentage", "100", "--auto-aof-rewrite-min-size", "64mb"], self.log)
        except FileNotFoundError:
            self.log.close()
            raise Refusal("LIVE_CACHE_RUNTIME", "the pinned runtime has no native Redis executable") from None
        try:
            if not redis_child.ready(self.process, self.port):
                raise Refusal("LIVE_CACHE_UNAVAILABLE", "the native cache did not become ready; originals retained")
            self.config = RedisCacheConfig(host="127.0.0.1", port=self.port, **NATIVE_CONNECTION)
            self.health()
        except BaseException:
            self.close()
            raise

    def _persistence(self) -> None:
        info = redis_child.command(self.port, "INFO", "persistence")
        if not isinstance(info, bytes):
            raise OSError("native cache did not return persistence state")
        fields = dict(line.split(b":", 1) for line in info.splitlines() if b":" in line)
        if fields.get(b"aof_enabled") != b"1" or fields.get(b"aof_last_write_status") != b"ok":
            raise OSError("native cache AOF is not writable")

    def health(self) -> None:
        """Latch a failed durable-write probe; it cannot silently recover during trading.

        Redis acknowledges SET after appendfsync=always. The expiring key is only
        a storage probe; it carries no account or strategy facts. This observes
        the backend now, not completeness of arbitrary earlier native writes.
        """
        if self.failure is not None:
            raise Refusal("LIVE_CACHE_HEALTH", self.failure)
        try:
            if self.process.poll() is not None:
                raise OSError("native cache process exited")
            self._persistence()
            if redis_child.command(self.port, "CONFIG", "GET", "appendfsync") != [b"appendfsync", b"always"]:
                raise OSError("native cache durable-write mode changed")
            if redis_child.command(self.port, "SET", "trade-live-health", "1", "PX", "1000") != b"OK":
                raise OSError("native cache write barrier failed")
            self._persistence()
            if self.process.poll() is not None:
                raise OSError("native cache process exited")
        except (OSError, ValueError, TypeError) as exc:
            self.failure = f"native persistence is unavailable ({type(exc).__name__}); execution remains unresolved"
            raise Refusal("LIVE_CACHE_HEALTH", self.failure) from None

    def close(self) -> None:
        if self.closed:
            if self.failure is not None:
                raise Refusal("LIVE_CACHE_HEALTH", self.failure)
            return
        try:
            self.health()
        except Refusal:
            pass  # Stop the owned child even when health is already latched failed.
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                # Never SIGKILL a native persistence writer merely to make shutdown pass.
                self.log.close()
                self.failure = "native cache shutdown timed out; originals retained"
                raise Refusal("LIVE_CACHE_STOP", "native cache shutdown is unresolved; originals retained") from None
        self.log.close()
        self.closed = True
        if self.process.returncode != 0:
            self.failure = "native cache exited unsuccessfully; originals retained"
        if self.failure is not None:
            raise Refusal("LIVE_CACHE_HEALTH", self.failure)
