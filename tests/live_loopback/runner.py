"""The product's Live runner (engine.live.main) with the Binance origins of one environment pointed at the loopback fake
venue.

`python -m tests.live_loopback.runner --http ORIGIN --ws ORIGIN --environment ENV [--memory-cache] -- <engine.live
arguments>`

Only destinations change, and only ENV's: Nautilus's Binance data and execution clients built for ENV's native
environment get the fake's `base_url_http` and `base_url_ws`, and ENV's hosts in engine.live_venue.VENUES (the account
reader, the klines and funding reads, the kline side connection) the fake's origin, without TLS. The other
environment's hosts all point at a closed port, so a run that reached for them could not work. The metrics reads
(production's REST host in either environment, engine.metrics) get the fake's origin too. `--memory-cache` stands in for the runtime image's Redis child where the
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


CLOSED_HTTP, CLOSED_WS, CLOSED_HOST = "http://127.0.0.1:9", "ws://127.0.0.1:9/ws", "closed.invalid"


def patches(http: str, ws: str, environment: str, memory_cache: bool) -> list:
    from urllib.parse import urlsplit
    from engine import kline_events, klines, live, live_node, live_venue, realtime
    host, port = urlsplit(http).hostname, urlsplit(http).port
    native = live_node.NATIVE[environment]

    def with_origins(build):
        def built(*args, **kwargs):
            ours = kwargs.get("environment") == native
            return build(*args, **{**kwargs, "base_url_http": http if ours else CLOSED_HTTP,
                                   "base_url_ws": ws if ours else CLOSED_WS})
        return built

    venues = {name: {"rest": http, "stream": host} if name == environment else {"rest": CLOSED_HTTP,
                                                                                  "stream": CLOSED_HOST}
              for name in live_venue.VENUES}
    found = [
        mock.patch.object(realtime, "BinanceDataClientConfig", with_origins(realtime.BinanceDataClientConfig)),
        mock.patch.object(live_node, "BinanceExecutionClientConfig",
                          with_origins(live_node.BinanceExecutionClientConfig)),
        mock.patch.dict(live_venue.VENUES, venues),
        mock.patch.object(klines, "REST_BASE", http),
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
    parser.add_argument("--environment", required=True)
    parser.add_argument("--memory-cache", action="store_true")
    parser.add_argument("rest", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    socket.setdefaulttimeout(None)
    from engine import live
    applied = patches(args.http, args.ws, args.environment, args.memory_cache)
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
