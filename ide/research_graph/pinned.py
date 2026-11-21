"""Product reads kept as the JSON a page is sent, by what they were read for (a trial's report by trial and commit,
a contract's bars by days and market day), shared by concurrent reads: one read per key at a time. The least recently
used are dropped once what is kept passes `limit` bytes; a failed read is not kept."""
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import Future
import json
import threading


class Pinned:
    def __init__(self, limit: int):
        self.limit = limit
        self.lock = threading.Lock()
        self.values: OrderedDict[tuple, bytes] = OrderedDict()
        self.size = 0
        self.pending: dict[tuple, Future[bytes]] = {}

    def get(self, key: tuple, read: Callable[[], dict]) -> bytes:
        with self.lock:
            if key in self.values:
                self.values.move_to_end(key)
                return self.values[key]
            future = self.pending.get(key)
            owner = future is None
            if future is None:
                future = self.pending[key] = Future()
        if owner:
            try:
                value = json.dumps(read(), ensure_ascii=False).encode()
                with self.lock:
                    self.size += len(value) - len(self.values.pop(key, b""))
                    self.values[key] = value
                    while self.size > self.limit and len(self.values) > 1:
                        self.size -= len(self.values.popitem(last=False)[1])
                future.set_result(value)
            except Exception as exc:
                future.set_exception(exc)
            finally:
                with self.lock:
                    del self.pending[key]
        return future.result()

    def drop(self, which: Callable[[tuple], bool]) -> None:
        """Forget the values whose keys `which` names; a read already running still answers its callers."""
        with self.lock:
            for key in [key for key in self.values if which(key)]:
                self.size -= len(self.values.pop(key))
