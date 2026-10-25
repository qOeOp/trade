"""The paper run's only way out: an HTTP CONNECT proxy that admits Binance's public USD-M hosts alone.

A paper runner container sits on an internal Docker network with no route out; this proxy is the one
container on both that network and an outbound one (docs/plans/paper-trading-design.zh.md §3). It tunnels
CONNECT to ALLOWED on port 443 and answers everything else 403, so the runner can reach public market
data and nothing else. Each request line is logged with its verdict to ``--log``, which the sealing step
keeps as evidence of where the run connected.
"""

from __future__ import annotations

import argparse
import asyncio
import time

ALLOWED = frozenset({("fapi.binance.com", 443), ("fstream.binance.com", 443)})
HEAD_LIMIT = 8192  # bytes of a request head
HEAD_SECONDS = 10
CONNECT_SECONDS = 15


def admitted(request_line: str) -> tuple[str, int] | None:
    """engine.egress.admitted: the (host, port) a CONNECT request line names when it is allowed, else None."""
    parts = request_line.split(" ")
    if len(parts) != 3 or parts[0] != "CONNECT" or not parts[2].startswith("HTTP/1."):
        return None
    host, _, port = parts[1].rpartition(":")
    if not port.isdigit():
        return None
    target = (host.lower(), int(port))
    return target if target in ALLOWED else None


class Log:
    def __init__(self, path: str):
        self._stream = open(path, "a", encoding="utf-8", buffering=1)

    def write(self, verdict: str, peer, line: str) -> None:
        self._stream.write(f"{time.time_ns()} {verdict} {peer[0] if peer else '-'} {line!r}\n")

    def close(self) -> None:
        self._stream.close()


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        writer.close()


async def _refuse(writer: asyncio.StreamWriter) -> None:
    writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    try:
        await writer.drain()
    finally:
        writer.close()


def handler(log: Log):
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        peer = writer.get_extra_info("peername")
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), HEAD_SECONDS)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, TimeoutError, ConnectionError):
            log.write("DROP", peer, "")
            writer.close()
            return
        line = head.split(b"\r\n", 1)[0].decode("latin-1")
        target = admitted(line)
        if target is None:
            log.write("DENY", peer, line)
            await _refuse(writer)
            return
        try:
            up_reader, up_writer = await asyncio.wait_for(asyncio.open_connection(*target), CONNECT_SECONDS)
        except (OSError, TimeoutError):
            log.write("FAIL", peer, line)
            writer.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            writer.close()
            return
        log.write("ALLOW", peer, line)
        writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await writer.drain()
        await asyncio.gather(_pipe(reader, up_writer), _pipe(up_reader, writer))

    return handle


async def serve(host: str, port: int, log: Log) -> None:
    server = await asyncio.start_server(handler(log), host, port, limit=HEAD_LIMIT)
    async with server:
        await server.serve_forever()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m engine.egress", description=__doc__.split("\n")[0])
    parser.add_argument("--port", type=int, default=3128)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--log", required=True, help="the request log, appended line by line")
    args = parser.parse_args(argv)
    asyncio.run(serve(args.host, args.port, Log(args.log)))


if __name__ == "__main__":
    main()
