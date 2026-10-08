"""
Small helpers for the native shared-account replay.
"""

import math
from datetime import datetime
from decimal import Decimal


SOURCE_COMMIT = "0725a7b3f89902e27cd421a18b4b879a13268534"


def _json_safe(value):
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _ns(value: str) -> int:
    return int(datetime.fromisoformat(value).timestamp() * 1_000_000_000)


def _snapshot_equity_usdt(snapshot) -> Decimal:
    if snapshot is None or snapshot.is_stale or snapshot.unpriced_instruments:
        raise RuntimeError("native portfolio equity snapshot is missing or stale")
    equity = snapshot.base_currency_equity
    if equity is None or equity.currency.code != "USDT":
        raise RuntimeError("native portfolio snapshot lacks USDT base equity")
    return equity.as_decimal()
