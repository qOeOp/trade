"""Helpers shared by test modules."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from shared.errors import Refusal


def refused(call: Callable[..., Any], *args: Any, error: type[Exception] = Refusal, **kwargs: Any) -> Any:
    """The `error` (a Refusal by default) that `call(*args, **kwargs)` raises; its `.code` is the refusal code."""
    try:
        call(*args, **kwargs)
    except error as caught:
        return caught
    raise AssertionError(f"{getattr(call, '__name__', call)} raised no {error.__name__}")
