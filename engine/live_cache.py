"""Private native Redis persistence for Live; venue reconciliation owns recovery.

This is process custody, not a snapshot or an alternative account ledger. An
interrupted runner is only reopened in observation/reconciliation mode.
"""

from __future__ import annotations

import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from typing import BinaryIO, TypedDict

from nautilus_trader.infrastructure import RedisCacheConfig

from engine.live_errors import LiveRefusal as Refusal


REDIS = Path("/opt/trade/redis")
IO_TIMEOUT_SECONDS = 1
class NativeConnection(TypedDict):
    connection_timeout: int
    response_timeout: int
    number_of_retries: int
    max_delay: int


NATIVE_CONNECTION: NativeConnection = {"connection_timeout": 1, "response_timeout": 1,
                                      "number_of_retries": 0, "max_delay": 1}


def _reply(stream: BinaryIO) -> bytes | int | list:
    line = stream.readline(65537)
    if len(line) > 65536 or not line.endswith(b"\r\n"):
        raise OSError("incomplete native cache response")
    kind, value = line[:1], line[1:-2]
    if kind == b"+":
        return value
    if kind == b"-":
        # Redis error text is not needed to decide whether persistence is healthy.
        raise OSError("native cache rejected the command")
    if kind == b":":
        return int(value)
    if kind == b"$":
        size = int(value)
        if not 0 <= size <= 65536:
            raise OSError("invalid native cache payload length")
        payload = stream.read(size + 2)
        if len(payload) != size + 2 or not payload.endswith(b"\r\n"):
            raise OSError("incomplete native cache payload")
        return payload[:-2]
    if kind == b"*":
        count = int(value)
        if not 0 <= count <= 32:
            raise OSError("invalid native cache response count")
        return [_reply(stream) for _ in range(count)]
    raise OSError("unsupported native cache response")


def redis_command(port: int, *parts: str) -> bytes | int | list:
    payload = b"*" + str(len(parts)).encode() + b"\r\n"
    for part in parts:
        value = part.encode()
        payload += b"$" + str(len(value)).encode() + b"\r\n" + value + b"\r\n"
    with socket.create_connection(("127.0.0.1", port), timeout=IO_TIMEOUT_SECONDS) as connection:
        connection.sendall(payload)
        with connection.makefile("rb") as stream:
            return _reply(stream)


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
        loaders = list(REDIS.glob("ld-musl-*.so.1"))
        if len(loaders) != 1 or not (REDIS / "redis-server").is_file():
            raise Refusal("LIVE_CACHE_RUNTIME", "the pinned runtime has no native Redis executable")
        with socket.socket() as available:
            available.bind(("127.0.0.1", 0))
            port = available.getsockname()[1]
        self.port = port
        self.log = (output / "native-cache.log").open("ab")
        self.process = subprocess.Popen(
            [sys.executable, "-c", "import os,signal,sys; "
             "signal.pthread_sigmask(signal.SIG_SETMASK, []); os.execv(sys.argv[1], sys.argv[1:])",
             str(loaders[0]), "--library-path", str(REDIS / "lib"), str(REDIS / "redis-server"),
             "--bind", "127.0.0.1", "--port", str(port), "--protected-mode", "yes",
             "--dir", str(self.root), "--appendonly", "yes", "--appendfsync", "always",
             # A never-ending run: Redis rewrites the AOF once it doubles past 64 MB, so the expired health
             # probes and superseded values stop growing the file (design §3.9). Nautilus's own lists stay whole.
             "--save", "", "--auto-aof-rewrite-percentage", "100", "--auto-aof-rewrite-min-size", "64mb"],
            stdin=subprocess.DEVNULL, stdout=self.log, stderr=subprocess.STDOUT,
            env={"PATH": os.defpath, "LANG": "C"},
        )
        try:
            deadline = time.monotonic() + 10
            while self.process.poll() is None and time.monotonic() < deadline:
                try:
                    if redis_command(port, "PING") == b"PONG":
                        self.config = RedisCacheConfig(host="127.0.0.1", port=port, **NATIVE_CONNECTION)
                        self.health()
                        return
                except OSError:
                    pass
                time.sleep(0.02)
            raise Refusal("LIVE_CACHE_UNAVAILABLE", "the native cache did not become ready; originals retained")
        except BaseException:
            self.close()
            raise

    def _persistence(self) -> None:
        info = redis_command(self.port, "INFO", "persistence")
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
            if redis_command(self.port, "CONFIG", "GET", "appendfsync") != [b"appendfsync", b"always"]:
                raise OSError("native cache durable-write mode changed")
            if redis_command(self.port, "SET", "trade-live-health", "1", "PX", "1000") != b"OK":
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
