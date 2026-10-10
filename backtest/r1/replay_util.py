"""
Small helpers for the native shared-account replay.
"""

import math
import re
from datetime import UTC
from datetime import datetime
from decimal import Decimal


def _json_safe(value):
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _utc_datetime(value: str) -> datetime:
    """Parse an explicit ISO-8601 timezone without consulting the host timezone."""
    try:
        if re.search(r"[+-]\d{2}(?::?\d{2})?(?::?\d{2})?[.,]\d+$", value):
            raise ValueError("fractional UTC offsets are unsupported")
        if any(len(fraction) > 6 for fraction in re.findall(r"[.,](\d+)", value)):
            raise ValueError("time precision must not exceed six fractional digits")
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            "time must be an ISO-8601 datetime with explicit Z or UTC offset, "
            "at most six fractional digits and no fractional UTC offset"
        ) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("time must include explicit Z or UTC offset")
    try:
        return parsed.astimezone(UTC)
    except OverflowError as exc:
        raise ValueError("time is outside the representable UTC datetime range") from exc


def _ns(value: str) -> int:
    elapsed = _utc_datetime(value) - datetime(1970, 1, 1, tzinfo=UTC)
    return ((elapsed.days * 86400 + elapsed.seconds) * 1_000_000 + elapsed.microseconds) * 1000


def _snapshot_equity_usdt(snapshot) -> Decimal:
    if snapshot is None or snapshot.is_stale or snapshot.unpriced_instruments:
        raise RuntimeError("native portfolio equity snapshot is missing or stale")
    equity = snapshot.base_currency_equity
    if equity is None or equity.currency.code != "USDT":
        raise RuntimeError("native portfolio snapshot lacks USDT base equity")
    return equity.as_decimal()
