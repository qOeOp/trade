"""A bounded cache of product reads pinned to a ledger commit (the line index by commit, a trial's report by
trial and commit), shared by concurrent page and menu reads: one read per key at a time."""
from collections import OrderedDict
from collections.abc import Callable, Hashable
from concurrent.futures import Future
import threading


class Pinned[K: Hashable]:
    def __init__(self, read: Callable[[K], dict], capacity: int = 8):
        self.read, self.capacity = read, capacity
        self.lock = threading.Lock()
        self.values: OrderedDict[K, dict] = OrderedDict()
        self.pending: dict[K, Future] = {}

    def get(self, key: K) -> dict:
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
                value = self.read(key)
                with self.lock:
                    self.values[key] = value
                    while len(self.values) > self.capacity:
                        self.values.popitem(last=False)
                future.set_result(value)
            except Exception as exc:
                future.set_exception(exc)
            finally:
                with self.lock:
                    del self.pending[key]
        return future.result()
