"""A bounded, commit-pinned line index shared by concurrent page and menu reads."""
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import Future
import threading


class LineIndex:
    def __init__(self, read: Callable[[str], dict], capacity: int = 8):
        self.read, self.capacity = read, capacity
        self.lock = threading.Lock()
        self.values: OrderedDict[str, dict] = OrderedDict()
        self.pending: dict[str, Future] = {}

    def get(self, commit: str) -> dict:
        with self.lock:
            if commit in self.values:
                self.values.move_to_end(commit)
                return self.values[commit]
            future = self.pending.get(commit)
            owner = future is None
            if future is None:
                future = self.pending[commit] = Future()
        if owner:
            try:
                value = self.read(commit)
                with self.lock:
                    self.values[commit] = value
                    while len(self.values) > self.capacity:
                        self.values.popitem(last=False)
                future.set_result(value)
            except Exception as exc:
                future.set_exception(exc)
            finally:
                with self.lock:
                    del self.pending[commit]
        return future.result()
