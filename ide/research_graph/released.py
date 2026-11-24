"""The newest released version of the product, for `/api/about`."""
from __future__ import annotations

from collections.abc import Callable
import json
import re
import threading
import time
from urllib.request import Request, urlopen

# The product's newest version is its latest GitHub release (CHANGELOG.md: a version is released with
# `gh release create vX.Y.Z`); a deployment whose version is older is told so (`/api/about`).
RELEASES = "https://api.github.com/repos/qOeOp/trade/releases/latest"
RELEASE_SECONDS = 3600.0
VERSION = re.compile(r"v(\d+\.\d+\.\d+)")


class Released:
    """The newest released version ("0.4.3"), read anonymously from GitHub at most once every RELEASE_SECONDS by
    whichever request comes due; None until a read succeeds, and a failed read keeps the last one. A request never
    waits on another's read."""

    def __init__(self, url: str = RELEASES, every: float = RELEASE_SECONDS, opener: Callable = urlopen):
        self.url, self.every, self.opener = url, every, opener
        self.value: str | None = None
        self.due = 0.0
        self.lock = threading.Lock()

    def __call__(self) -> str | None:
        if time.monotonic() >= self.due and self.lock.acquire(blocking=False):
            try:
                self.due = time.monotonic() + self.every
                request = Request(self.url, headers={"Accept": "application/vnd.github+json", "User-Agent": "trade-ide"})
                with self.opener(request, timeout=10) as response:
                    found = VERSION.fullmatch(str(json.load(response).get("tag_name")))
                if found:
                    self.value = found[1]
            except Exception:
                pass  # unknown this hour: the page says nothing rather than something wrong
            finally:
                self.lock.release()
        return self.value
