"""The runners' loopback Redis child: the runtime's pinned redis-server and one RESP command.

Paper (engine.paper_redis) and Live (engine.live_cache) each keep their own persistence options, close policy and
refusals; this module raises only FileNotFoundError and OSError. The child listens only on loopback; no credential
is accepted or supplied.
"""

from __future__ import annotations

import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from typing import IO, BinaryIO

REDIS = Path("/opt/trade/redis")
READY_SECONDS = 10


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


def command(port: int, *parts: str, timeout: float = 1) -> bytes | int | list:
    """One unauthenticated command to the local child; an error reply raises OSError."""
    payload = b"*" + str(len(parts)).encode() + b"\r\n"
    for part in parts:
        value = part.encode()
        payload += b"$" + str(len(value)).encode() + b"\r\n" + value + b"\r\n"
    with socket.create_connection(("127.0.0.1", port), timeout=timeout) as connection:
        connection.sendall(payload)
        with connection.makefile("rb") as stream:
            return _reply(stream)


def start(directory: Path, options: list[str], stdout: IO) -> tuple[subprocess.Popen, int]:
    """redis-server on a free loopback port, keeping its files in ``directory`` with the caller's persistence
    ``options``. FileNotFoundError when the runtime carries none; a host Redis is never used."""
    loaders = list(REDIS.glob("ld-musl-*.so.1"))
    if len(loaders) != 1 or not (REDIS / "redis-server").is_file():
        raise FileNotFoundError("the pinned runtime has no native Redis executable")
    with socket.socket() as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
    process = subprocess.Popen(
        # A fresh interpreter clears the runner's inherited blocked signal mask before exec.
        # preexec_fn would run Python after fork in a multithreaded process.
        [sys.executable, "-c", "import os,signal,sys; "
         "signal.pthread_sigmask(signal.SIG_SETMASK, []); os.execv(sys.argv[1], sys.argv[1:])",
         str(loaders[0]), "--library-path", str(REDIS / "lib"), str(REDIS / "redis-server"),
         "--bind", "127.0.0.1", "--port", str(port), "--dir", str(directory), *options],
        stdin=subprocess.DEVNULL, stdout=stdout, stderr=subprocess.STDOUT,
        env={"PATH": os.defpath, "LANG": "C"},
    )
    return process, port


def ready(process: subprocess.Popen, port: int) -> bool:
    """Whether the child answers PING within READY_SECONDS; False once it exited or the time ran out."""
    deadline = time.monotonic() + READY_SECONDS
    while process.poll() is None and time.monotonic() < deadline:
        try:
            if command(port, "PING") == b"PONG":
                return True
        except OSError:
            pass
        time.sleep(0.02)
    return False
