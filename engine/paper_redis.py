"""The native Paper cache's local Redis process and durable FIFO barrier.

Redis contains Nautilus' own serialized state, not an alternative account or matching engine.
It listens only on loopback inside the runner. No credential is accepted or supplied.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import uuid

from nautilus_trader.core import UUID4
from nautilus_trader.infrastructure import RedisCacheConfig
# Published rc7 exports this class but omits it from infrastructure.pyi.
from nautilus_trader.infrastructure import RedisCacheDatabase  # type: ignore[attr-defined]
from nautilus_trader.model import Currency, TraderId, Venue

from engine import paper_checkpoint as checkpoint
from engine.config import ACCOUNT_CONTRACT


MARKER = "paper-recovery"
REDIS = Path("/opt/trade/redis")
SECONDS = 10.0


def command(port: int, *parts: str) -> bytes | int:
    """One local, unauthenticated Redis command; used only for PING and synchronous SAVE."""
    payload = b"*" + str(len(parts)).encode() + b"\r\n"
    for part in parts:
        data = part.encode()
        payload += b"$" + str(len(data)).encode() + b"\r\n" + data + b"\r\n"
    with socket.create_connection(("127.0.0.1", port), timeout=SECONDS) as conn:
        conn.sendall(payload)
        with conn.makefile("rb") as stream:
            response = stream.readline()
    if response.startswith(b"+"):
        return response[1:-2]
    if response.startswith(b":"):
        return int(response[1:-2])
    raise checkpoint.fail(f"the local native cache command failed: {response.decode(errors='replace').strip()}")


class NativeCache:
    def __init__(self, output: Path, identity: str, trader_id: str, *, port: int | None = None,
                 rdb: Path | None = None):
        self.output, self.identity = output, identity
        self.root = output / "recovery"
        self.root.mkdir(parents=True, exist_ok=True)
        self.process: subprocess.Popen | None = None
        self.io = ThreadPoolExecutor(max_workers=1, thread_name_prefix="paper-native-cache")
        self.working = tempfile.TemporaryDirectory(prefix="paper-native-cache-")
        self.restored = checkpoint.read(output, identity) if (output / "events.jsonl").exists() else None
        directory = Path(self.working.name)
        self.rdb = rdb or directory / "dump.rdb"
        if self.restored:
            original = checkpoint.retain_used(output, self.restored)
            if port is None:
                # Never bootstrap from a mutable cache left behind by the process which crashed.
                checkpoint.atomic(self.rdb, original.read_bytes())
        if port is None:
            loaders = list(REDIS.glob("ld-musl-*.so.1"))
            if not (REDIS / "redis-server").is_file() or len(loaders) != 1:
                raise checkpoint.fail("the pinned runtime does not carry the native cache service")
            with socket.socket() as available:
                available.bind(("127.0.0.1", 0))
                port = available.getsockname()[1]
            self.process = subprocess.Popen(
                # A fresh interpreter clears Paper's inherited blocked signal mask before
                # exec. preexec_fn would run Python after fork in a multithreaded process.
                [sys.executable, "-c", "import os,signal,sys; "
                 "signal.pthread_sigmask(signal.SIG_SETMASK, []); os.execv(sys.argv[1], sys.argv[1:])",
                 str(loaders[0]), "--library-path", str(REDIS / "lib"),
                 str(REDIS / "redis-server"), "--bind", "127.0.0.1", "--port", str(port),
                 "--dir", str(directory), "--dbfilename", "dump.rdb", "--save", "", "--appendonly", "no"],
                stdin=subprocess.DEVNULL, stdout=sys.stderr, stderr=subprocess.STDOUT,
                env={"PATH": os.defpath, "LANG": "C"},
            )
            deadline = time.monotonic() + SECONDS
            while True:
                if self.process.poll() is not None:
                    self.close()
                    raise checkpoint.fail("the native cache service failed to load; its log and originals are retained")
                try:
                    if command(port, "PING") == b"PONG":
                        break
                except OSError:
                    pass
                if time.monotonic() >= deadline:
                    self.close()
                    raise checkpoint.fail("the native cache service did not become ready")
                time.sleep(0.02)
        self.port = port
        self.config = RedisCacheConfig(host="127.0.0.1", port=port)
        try:
            self.reader = RedisCacheDatabase(
                TraderId(trader_id), UUID4(), json.dumps({"encoding": "json", "use_instance_id": False}).encode(),
                json.dumps({"host": "127.0.0.1", "port": port}).encode(),
            )
        except BaseException:
            self.close()
            raise

    def state(self) -> dict | None:
        if not self.restored:
            return None
        values = self.reader.read(f"general:{MARKER}")
        if len(values) != 1:
            raise checkpoint.fail("the native checkpoint has no unique runner/strategy state")
        try:
            return json.loads(values[0])["state"]
        except (ValueError, KeyError, TypeError) as exc:
            raise checkpoint.fail("the native checkpoint runner state is invalid") from exc

    def accounts(self) -> dict:
        return self.reader.load_all()["accounts"]

    def snapshot(self, cache, state: dict) -> dict:
        """The owner must already be at a quiescent cut and keep callbacks stopped until this returns."""
        marker = json.dumps({"nonce": uuid.uuid4().hex, "state": state}, sort_keys=True).encode()
        if cache is None:
            # Before the node exists the native cache has no account or strategies to lose.
            # This writer's own FIFO is the only one, so an interrupted warm-up can continue.
            self.reader.insert(f"general:{MARKER}", [marker])
            expected: dict[str, list[str]] = {key: [] for key in ("accounts", "orders", "positions")}
        else:
            account = cache.account_for_venue(Venue(ACCOUNT_CONTRACT["venue"]))
            if account and account.to_dict().get("calculate_account_state") is not True:
                raise checkpoint.fail("the Sandbox account calculation mode is not initialized")
            expected = {"accounts": self._native([account] if account else []),
                        "orders": self._native(cache.orders()), "positions": self._native(cache.positions())}
            cache.add(MARKER, marker)
        # RedisCacheDatabase.read drives its own Tokio runtime. Running it on a LiveNode
        # callback's Tokio thread aborts the process (published rc7). Keep the owner blocked
        # while a separate I/O thread drains that same native FIFO and freezes the file.
        return self.io.submit(self._freeze, marker, expected).result()

    @staticmethod
    def _native(values) -> list[str]:
        found = []
        for value in values:
            data = value.to_dict()
            if "calculate_account_state" in data:
                # rc7's native account loader constructs a non-calculating account, then
                # Sandbox/portfolio owns its runtime calculation mode. Native Redis also
                # appends repeated historical AccountState entries with the same UUID.
                data.pop("calculate_account_state")
                events: dict[str, dict] = {}
                compact: list[dict] = []
                for event in data["events"]:
                    key = event["event_id"]
                    if key in events and events[key] != event:
                        raise checkpoint.fail("a native account event UUID has conflicting payloads")
                    events[key] = event
                    if not compact or compact[-1] != event:
                        compact.append(event)
                data["events"] = compact
                data["last_event"] = value.last_event.to_dict()
                data["margins"] = {str(key): str(item) for key, item in value.margins().items()}
                data["account_margins"] = {str(key): str(item) for key, item in value.account_margins().items()}
                currency = Currency.from_str(ACCOUNT_CONTRACT["base_currency"])
                data["balances"] = {key: str(getattr(value, f"balance_{key}")(currency))
                                    for key in ("total", "locked", "free")}
            if "liquidity_side" in data and Decimal(str(data.get("filled_qty") or 0)) == 0:
                # Without a fill an order has no liquidity side. rc7's Sandbox sets MAKER on a resting limit order
                # without an event, and the order Redis rebuilds from its events has NO_LIQUIDITY_SIDE, so an unfilled
                # limit order that expired or was canceled would keep every later checkpoint dirty.
                data.pop("liquidity_side")
            found.append(json.dumps(data, sort_keys=True, default=str))
        return sorted(found)

    def _freeze(self, marker: bytes, expected: dict) -> dict:
        deadline = time.monotonic() + SECONDS
        while self.reader.read(f"general:{MARKER}") != [marker]:
            if time.monotonic() >= deadline:
                raise checkpoint.fail("native cache writes did not reach their FIFO barrier")
            time.sleep(0.01)
        # The adapter logs some failed writes and keeps processing. A successful marker alone
        # proves FIFO progress, not that earlier economic writes succeeded. Verify native
        # deserialization against the owner's frozen native objects before publishing any cut.
        loaded = self.reader.load_all()
        if any(self._native(loaded[key].values()) != values for key, values in expected.items()):
            raise checkpoint.fail("native cache readback differs from the owner; the checkpoint stays dirty")
        if command(self.port, "SAVE") != b"OK":
            raise checkpoint.fail("the native cache snapshot failed")
        found = checkpoint.publish(self.output, self.identity, self.rdb)
        # Only current and actually-used originals are retained. Unused generations are working cache.
        for old in self.root.glob("*.rdb"):
            if old.name != f"{found['cache_sha256']}.rdb":
                old.unlink()
        return found

    def close(self) -> None:
        self.io.shutdown(wait=True)
        reader = getattr(self, "reader", None)
        if reader is not None:
            reader.close()
            self.reader = None
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=SECONDS)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.working.cleanup()
