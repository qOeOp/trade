"""Paper's native cache (engine.paper_redis.NativeCache) under Redis faults, with the runtime image's redis-server.

Hosts without it skip; run in the execution image with this checkout's engine and tests mounted:
docker run --rm --network none -v "$PWD/engine:/opt/trade/engine:ro" -v "$PWD/tests:/opt/trade/tests:ro" \
  --entrypoint python ghcr.io/qoeop/trade-runtime:exec-main -m unittest tests.engine.test_paper_cache_faults
"""

import json
from pathlib import Path
import signal
import tempfile
import threading
import unittest
from unittest import mock

from engine import redis_child
from engine.config import Refusal
from engine.paper_redis import CacheUnavailable, NativeCache

IDENTITY, TRADER = "fault-identity", "TRADER-001"


def journal(output: Path, line: str) -> None:
    with (output / "events.jsonl").open("a") as stream:
        stream.write(json.dumps({"event": line}) + "\n")


@unittest.skipUnless((redis_child.REDIS / "redis-server").exists(), "needs the runtime image's redis-server")
class CacheFaultTests(unittest.TestCase):
    def setUp(self):
        self.output = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.cache = NativeCache(self.output, IDENTITY, TRADER)
        self.addCleanup(lambda: self.cache.close())
        journal(self.output, "warmup")
        self.cut = self.cache.snapshot(None, {"step": 1})

    def restart(self) -> NativeCache:
        cache = NativeCache(self.output, IDENTITY, TRADER)
        self.addCleanup(cache.close)
        return cache

    def test_a_killed_cache_ends_the_run_and_the_next_process_recovers_the_checkpoint(self):
        self.cache.process.send_signal(signal.SIGKILL)
        self.cache.process.wait()
        with self.assertRaisesRegex(CacheUnavailable, "exited with -9"):
            self.cache.health()
        again = self.restart()
        self.assertEqual((again.restored, again.state()), (self.cut, {"step": 1}))

    def test_a_missing_original_refuses_recovery_and_keeps_the_cut(self):
        self.cache.close()
        (self.output / "recovery" / f"{self.cut['cache_sha256']}.rdb").unlink()
        with self.assertRaisesRegex(Refusal, "PAPER_RECOVERY_UNAVAILABLE: recovery original is missing"):
            NativeCache(self.output, IDENTITY, TRADER)
        self.assertTrue((self.output / "recovery" / "current.json").exists())

    def test_a_cache_killed_during_save_publishes_nothing_and_the_earlier_cut_recovers(self):
        filler = "x" * 4096  # 100 MB of keys: SAVE is still writing when the kill comes
        for first in range(0, 25_000, 2500):
            redis_child.command(self.cache.port, "MSET", *(part for key in range(first, first + 2500)
                                                          for part in (f"filler:{key}", filler)), timeout=30)
        command = redis_child.command

        def killed_during_save(port, *parts, timeout=1):
            if parts[:1] == ("SAVE",):
                threading.Timer(0.02, self.cache.process.send_signal, (signal.SIGKILL,)).start()
            return command(port, *parts, timeout=timeout)

        journal(self.output, "bar")
        with mock.patch.object(redis_child, "command", killed_during_save), \
                self.assertRaisesRegex(Refusal, "the native cache snapshot failed"):
            self.cache.snapshot(None, {"step": 2})
        self.assertTrue(any(path.name.startswith("temp-") for path in Path(self.cache.working.name).iterdir()))
        self.assertEqual(json.loads((self.output / "recovery" / "current.json").read_bytes()), self.cut)
        self.cache.close()
        with self.assertRaisesRegex(Refusal, "unhandled tail"):  # the bar after the cut was journaled
            NativeCache(self.output, IDENTITY, TRADER)
        with (self.output / "events.jsonl").open("r+b") as stream:
            stream.truncate(self.cut["journal_bytes"])
        self.assertEqual(self.restart().state(), {"step": 1})


if __name__ == "__main__":
    unittest.main()
