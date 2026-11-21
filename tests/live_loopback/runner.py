"""The product's Live runner (engine.live.main) with every Binance origin pointed at the loopback fake venue.

`python -m tests.live_loopback.runner --http ORIGIN --ws ORIGIN [--memory-cache] -- <engine.live arguments>`

Only destinations change: Nautilus's Binance data and execution clients get the fake's `base_url_http` and
`base_url_ws`, and the product's own clients (the account reader, the klines and metrics reads, the kline side
connection) the fake's origin, without TLS. `--memory-cache` stands in for the runtime image's Redis child where the
host has none: Nautilus keeps its cache in memory and the health probe always passes, so a test with it says nothing
about persistence. Orders, fills, reconciliation, risk and every product check run unchanged.
"""

from __future__ import annotations

if __name__ == "__main__":
    from engine.signals import block
    block()  # as engine.live does, before Nautilus starts any thread

import argparse
import socket
import sys
import traceback
from unittest import mock


class _PlainContext:
    """The kline side connection's TLS context, without TLS: the fake venue speaks plain WebSocket."""

    minimum_version = None

    def wrap_socket(self, raw, server_hostname=None):
        return raw


class _MemoryBuilder:
    """The native LiveNode builder, except that a cache database of None leaves Nautilus's cache in memory."""

    def __init__(self, native):
        self._native = native

    def with_cache_database_factory(self, factory):
        return self if factory is None else self._native.with_cache_database_factory(factory)

    def __getattr__(self, name):
        return getattr(self._native, name)


class MemoryCache:
    """engine.live_cache.LiveCache's interface with no database: Nautilus keeps its cache in memory."""

    def __init__(self, output, *, resume: bool):
        self.config = None
        self.failure = None

    def health(self) -> None:
        pass

    def close(self) -> None:
        pass


def patches(http: str, ws: str, memory_cache: bool) -> list:
    from urllib.parse import urlsplit
    from engine import kline_events, klines, live, live_node, live_venue, realtime
    host, port = urlsplit(http).hostname, urlsplit(http).port

    def with_origins(native):
        return lambda *args, **kwargs: native(*args, **{**kwargs, "base_url_http": http, "base_url_ws": ws})

    found = [
        mock.patch.object(realtime, "BinanceDataClientConfig", with_origins(realtime.BinanceDataClientConfig)),
        mock.patch.object(live_node, "BinanceExecutionClientConfig",
                          with_origins(live_node.BinanceExecutionClientConfig)),
        mock.patch.object(live_venue.BinanceReadOnly, "ORIGIN", http),
        mock.patch.object(klines, "REST_BASE", http),
        mock.patch.object(kline_events, "HOST", host),
        mock.patch.object(kline_events, "PORT", port),
        mock.patch.object(kline_events.ssl, "create_default_context", _PlainContext),
    ]
    if memory_cache:
        node_base = live_node.node_base
        found += [mock.patch.object(live, "LiveCache", MemoryCache),
                  mock.patch.object(live_node, "node_base", lambda *args: _MemoryBuilder(node_base(*args)))]
    return found


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--http", required=True)
    parser.add_argument("--ws", required=True)
    parser.add_argument("--memory-cache", action="store_true")
    parser.add_argument("rest", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    socket.setdefaulttimeout(None)
    from engine import live
    applied = patches(args.http, args.ws, args.memory_cache)
    for patch in applied:
        patch.start()
    execute = live.execute

    def traced(*inner):
        # engine.live.main prints no exception text (a real one can carry signed URLs); this venue's cannot.
        try:
            return execute(*inner)
        except Exception:
            traceback.print_exc()
            raise

    applied.append(mock.patch.object(live, "execute", traced))
    applied[-1].start()
    try:
        return live.main(args.rest[1:] if args.rest[:1] == ["--"] else args.rest)
    finally:
        for patch in reversed(applied):
            patch.stop()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
