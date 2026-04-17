#!/usr/bin/env python3

import importlib
import json
import math
import pathlib
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional


BINANCE_USDM_BASE_URL = "https://fapi.binance.com"
PYTHON_PACKAGE_NAME = "liquidator-indicator==0.1.2"
PYTHON_REQUIREMENTS_PATH = str(pathlib.Path(__file__).resolve().parents[1] / "requirements.txt")


@dataclass
class Config:
    symbol: str
    aggtrades_file: Optional[str] = None
    snapshot_file: Optional[str] = None
    lookback_minutes: int = 30
    limit: int = 1000
    zone_pct: float = 0.003
    timeout: int = 10_000


HELP_TEXT = """Usage:
  ./scripts/main.py --symbol BTCUSDT
  ./scripts/main.py --symbol BTCUSDT --aggtrades-file /tmp/aggtrades.json --snapshot-file /tmp/snapshot.json

Key flags:
  --symbol <symbol>              Required. Example: BTCUSDT
  --aggtrades-file <path>        Optional upstream aggTrades JSON
  --snapshot-file <path>         Optional upstream premium/open-interest JSON
  --lookback-minutes <minutes>   Default: 30
  --limit <count>                Default: 1000
  --zone-pct <ratio>             Default: 0.003
  --timeout <ms>                 Default: 10000
  --help                         Show this help
"""


def main() -> None:
    argv = sys.argv[1:]
    if "--help" in argv or "-h" in argv:
        sys.stdout.write(HELP_TEXT)
        return

    response = run(argv)
    print_json(response)
    if not response["ok"]:
        raise SystemExit(1)


def run(argv: list[str]) -> dict[str, Any]:
    try:
        config = parse_args(argv)
        data = build_liquidation_zones(config)
        return {"ok": True, "data": data}
    except Exception as error:  # pragma: no cover - exercised through script behavior
        return {"ok": False, "error": format_error(error)}


def parse_args(argv: list[str]) -> Config:
    config = Config(symbol="")

    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--symbol":
            index += 1
            config.symbol = normalize_symbol(read_flag_value(argv, index, arg))
        elif arg == "--aggtrades-file":
            index += 1
            config.aggtrades_file = read_flag_value(argv, index, arg)
        elif arg == "--snapshot-file":
            index += 1
            config.snapshot_file = read_flag_value(argv, index, arg)
        elif arg == "--lookback-minutes":
            index += 1
            config.lookback_minutes = parse_positive_int(read_flag_value(argv, index, arg), "--lookback-minutes")
        elif arg == "--limit":
            index += 1
            config.limit = parse_positive_int(read_flag_value(argv, index, arg), "--limit")
        elif arg == "--zone-pct":
            index += 1
            config.zone_pct = parse_positive_float(read_flag_value(argv, index, arg), "--zone-pct")
        elif arg == "--timeout":
            index += 1
            config.timeout = parse_positive_int(read_flag_value(argv, index, arg), "--timeout")
        else:
            raise ValueError(f"unknown flag: {arg}")
        index += 1

    validate_config(config)
    return config


def build_liquidation_zones(config: Config) -> dict[str, Any]:
    liquidator_module = load_liquidator_module()
    timeout_seconds = config.timeout / 1000
    end_time = int(time.time() * 1000)
    start_time = end_time - config.lookback_minutes * 60 * 1000

    aggtrades_payload = load_aggtrades_payload(config.aggtrades_file) if config.aggtrades_file else None
    snapshot_payload = load_snapshot_payload(config.snapshot_file) if config.snapshot_file else None
    symbol = resolve_symbol(config.symbol, aggtrades_payload, snapshot_payload)

    requests_module = None
    if aggtrades_payload is None or snapshot_payload is None:
        requests_module = load_requests_module()

    agg_trades, aggtrades_source, request_meta = resolve_aggtrades(
        config,
        symbol,
        aggtrades_payload,
        requests_module,
        timeout_seconds,
        start_time,
        end_time,
    )
    premium_index, open_interest, snapshot_source = resolve_snapshot(
        symbol,
        snapshot_payload,
        requests_module,
        timeout_seconds,
    )

    symbol_coin = extract_coin(symbol)
    liquidator = liquidator_module.Liquidator.from_exchange(
        symbol,
        "binance",
        raw_data=agg_trades,
        pct_merge=config.zone_pct,
        window_minutes=config.lookback_minutes,
        cutoff_hours=max(1, math.ceil(config.lookback_minutes / 60)),
    )
    liquidator.ingest_funding_rates(
        {
            symbol_coin: {
                "funding_rate": to_float(premium_index.get("lastFundingRate")),
                "open_interest": to_float(open_interest.get("openInterest")),
                "timestamp": to_iso8601_from_millis(premium_index.get("time")) or now_utc().isoformat(),
            }
        }
    )
    zones_frame = liquidator.compute_zones(
        window_minutes=config.lookback_minutes,
        pct_merge=config.zone_pct,
        use_atr=False,
    )

    inferred_liqs = frame_to_records(getattr(liquidator, "_inferred_liqs", None))
    zones = serialize_zones(zones_frame, premium_index, open_interest)

    return {
        "exchange": "binance",
        "market": "usdm",
        "symbol": symbol,
        "generatedAt": now_in_shanghai(),
        "engine": {
            "name": "liquidator-indicator",
            "version": getattr(liquidator_module, "__version__", None),
            "mode": "python-package",
        },
        "request": {
            "symbol": symbol,
            "lookbackMinutes": config.lookback_minutes,
            "limit": request_meta["limit"],
            "zonePct": config.zone_pct,
            "startTime": request_meta["startTime"],
            "endTime": request_meta["endTime"],
            "sources": {
                "aggTrades": aggtrades_source,
                "snapshot": snapshot_source,
            },
        },
        "marketContext": build_market_context(symbol, premium_index, open_interest),
        "sample": build_sample(agg_trades, inferred_liqs, zones),
        "zones": zones,
        "warnings": build_warnings(agg_trades, inferred_liqs, zones, aggtrades_source, snapshot_source),
    }


def load_liquidator_module():
    try:
        return importlib.import_module("liquidator_indicator")
    except ImportError as error:
        raise RuntimeError(
            "missing python package liquidator_indicator. "
            f"install with: python3 -m pip install -r {PYTHON_REQUIREMENTS_PATH} "
            f"(tested with {PYTHON_PACKAGE_NAME})"
        ) from error


def load_requests_module():
    try:
        return importlib.import_module("requests")
    except ImportError as error:
        raise RuntimeError(
            "missing python package requests. "
            f"install with: python3 -m pip install -r {PYTHON_REQUIREMENTS_PATH}"
        ) from error


def request_json(requests_module, path: str, params: dict[str, Any], timeout_seconds: float) -> Any:
    response = requests_module.get(
        f"{BINANCE_USDM_BASE_URL}{path}",
        params=params,
        timeout=timeout_seconds,
        headers={"User-Agent": "trade/binance-liquidation-zones"},
    )
    if response.status_code != 200:
        body = response.text.strip()
        detail = f": {body[:200]}" if body else ""
        raise RuntimeError(f"request failed for {path}: {response.status_code}{detail}")
    return response.json()


def load_json_file(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def unwrap_skill_payload(payload: Any) -> Any:
    if isinstance(payload, dict) and "ok" in payload and "data" in payload:
        if payload.get("ok") is False:
            raise ValueError(f"upstream skill payload is not ok: {payload.get('error') or 'unknown error'}")
        return payload.get("data")
    return payload


def load_aggtrades_payload(path: str) -> dict[str, Any]:
    payload = unwrap_skill_payload(load_json_file(path))
    if isinstance(payload, dict) and isinstance(payload.get("trades"), list):
        return payload
    if isinstance(payload, list):
        return {"trades": payload}
    raise ValueError("--aggtrades-file must contain binance-aggtrades-fetch output or a trade array")


def load_snapshot_payload(path: str) -> dict[str, Any]:
    payload = unwrap_skill_payload(load_json_file(path))
    if not isinstance(payload, dict):
        raise ValueError("--snapshot-file must contain binance-symbol-snapshot output")
    if not isinstance(payload.get("premiumIndex"), dict) or not isinstance(payload.get("openInterest"), dict):
        raise ValueError("--snapshot-file must contain usdm premiumIndex and openInterest")
    return payload


def resolve_symbol(config_symbol: str, aggtrades_payload: Optional[dict[str, Any]], snapshot_payload: Optional[dict[str, Any]]) -> str:
    candidates = []
    if config_symbol:
        candidates.append(config_symbol)
    if aggtrades_payload:
        payload_symbol = stringify(aggtrades_payload.get("symbol"))
        if payload_symbol:
            candidates.append(normalize_symbol(payload_symbol))
        trades = aggtrades_payload.get("trades")
        if isinstance(trades, list) and trades:
            trade_symbol = stringify(as_map(trades[0]).get("symbol"))
            if trade_symbol:
                candidates.append(normalize_symbol(trade_symbol))
    if snapshot_payload:
        payload_symbol = stringify(snapshot_payload.get("symbol"))
        if payload_symbol:
            candidates.append(normalize_symbol(payload_symbol))
        premium_index = as_map(snapshot_payload.get("premiumIndex"))
        premium_symbol = stringify(premium_index.get("symbol"))
        if premium_symbol:
            candidates.append(normalize_symbol(premium_symbol))

    normalized = [item for item in candidates if item]
    unique = []
    for item in normalized:
        if item not in unique:
            unique.append(item)

    if not unique:
        raise ValueError("provide --symbol or pass a symbol-bearing --aggtrades-file / --snapshot-file")
    if len(unique) > 1:
        raise ValueError(f"symbol mismatch across inputs: {', '.join(unique)}")
    return unique[0]


def resolve_aggtrades(
    config: Config,
    symbol: str,
    aggtrades_payload: Optional[dict[str, Any]],
    requests_module,
    timeout_seconds: float,
    start_time: int,
    end_time: int,
) -> tuple[list[dict[str, Any]], str, dict[str, Optional[int]]]:
    if aggtrades_payload is not None:
        trades = aggtrades_payload.get("trades")
        if not isinstance(trades, list):
            raise ValueError("--aggtrades-file must contain a trades list")
        request = as_map(aggtrades_payload.get("request"))
        return trades, "file", {
            "startTime": to_optional_int(request.get("startTime")),
            "endTime": to_optional_int(request.get("endTime")),
            "limit": to_optional_int(request.get("limit")) or len(trades),
        }

    if requests_module is None:
        raise ValueError("missing requests runtime for network aggTrades fetch")

    trades = request_json(
        requests_module,
        "/fapi/v1/aggTrades",
        {
            "symbol": symbol,
            "startTime": start_time,
            "endTime": end_time,
            "limit": config.limit,
        },
        timeout_seconds,
    )
    if not isinstance(trades, list):
        raise ValueError("unexpected aggTrades response shape")
    return trades, "network", {"startTime": start_time, "endTime": end_time, "limit": config.limit}


def resolve_snapshot(
    symbol: str,
    snapshot_payload: Optional[dict[str, Any]],
    requests_module,
    timeout_seconds: float,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    if snapshot_payload is not None:
        premium_index = snapshot_payload.get("premiumIndex")
        open_interest = snapshot_payload.get("openInterest")
        if not isinstance(premium_index, dict) or not isinstance(open_interest, dict):
            raise ValueError("--snapshot-file must contain premiumIndex and openInterest maps")
        return premium_index, open_interest, "file"

    if requests_module is None:
        raise ValueError("missing requests runtime for network snapshot fetch")

    premium_index = request_json(
        requests_module,
        "/fapi/v1/premiumIndex",
        {"symbol": symbol},
        timeout_seconds,
    )
    open_interest = request_json(
        requests_module,
        "/fapi/v1/openInterest",
        {"symbol": symbol},
        timeout_seconds,
    )
    if not isinstance(premium_index, dict):
        raise ValueError("unexpected premiumIndex response shape")
    if not isinstance(open_interest, dict):
        raise ValueError("unexpected openInterest response shape")
    return premium_index, open_interest, "network"


def build_market_context(symbol: str, premium_index: dict[str, Any], open_interest: dict[str, Any]) -> dict[str, Any]:
    return {
        "premiumIndex": {
            "symbol": str(premium_index.get("symbol") or symbol),
            "markPrice": round(to_float(premium_index.get("markPrice")), 8),
            "indexPrice": round(to_float(premium_index.get("indexPrice")), 8),
            "lastFundingRate": round(to_float(premium_index.get("lastFundingRate")), 8),
            "nextFundingTime": to_int(premium_index.get("nextFundingTime")),
            "time": to_int(premium_index.get("time")),
        },
        "openInterest": {
            "symbol": str(open_interest.get("symbol") or symbol),
            "openInterest": round(to_float(open_interest.get("openInterest")), 4),
            "time": to_int(open_interest.get("time")),
        },
    }


def serialize_zones(zones_frame, premium_index: dict[str, Any], open_interest: dict[str, Any]) -> list[dict[str, Any]]:
    zones = []
    rows = frame_to_records(zones_frame)

    for row in rows:
        dominant_side = normalize_dominant_side(row.get("dominant_side"))
        zones.append(
            {
                "priceLow": round(to_float(row.get("price_min")), 8),
                "priceHigh": round(to_float(row.get("price_max")), 8),
                "priceMean": round(to_float(row.get("price_mean")), 8),
                "entryLow": round(to_float(row.get("entry_low")), 8) if has_value(row.get("entry_low")) else None,
                "entryHigh": round(to_float(row.get("entry_high")), 8) if has_value(row.get("entry_high")) else None,
                "bandPct": round(to_float(row.get("band_pct")), 6) if has_value(row.get("band_pct")) else None,
                "totalUsd": round(to_float(row.get("total_usd")), 2),
                "tradeCount": to_int(row.get("count")),
                "dominantLiquidationSide": dominant_side,
                "strength": round(to_float(row.get("strength")), 4),
                "qualityLabel": stringify(row.get("quality_label")),
                "qualityScore": round(to_float(row.get("quality_score")), 1) if has_value(row.get("quality_score")) else None,
                "evidence": {
                    "fundingRate": round(to_float(premium_index.get("lastFundingRate")), 8),
                    "openInterestSnapshot": round(to_float(open_interest.get("openInterest")), 4),
                    "markPrice": round(to_float(premium_index.get("markPrice")), 8),
                    "firstTimestamp": to_millis(row.get("first_ts")),
                    "lastTimestamp": to_millis(row.get("last_ts")),
                    "packageDominantSide": stringify(row.get("dominant_side")),
                },
            }
        )

    return zones


def build_sample(agg_trades: list[dict[str, Any]], inferred_liqs: list[dict[str, Any]], zones: list[dict[str, Any]]) -> dict[str, Any]:
    first_timestamp = trade_timestamp(agg_trades[0]) if agg_trades else None
    last_timestamp = trade_timestamp(agg_trades[-1]) if agg_trades else None
    total_notional = 0.0

    for trade in agg_trades:
        total_notional += trade_notional(trade)

    return {
        "tradeCount": len(agg_trades),
        "inferredLiquidationCount": len(inferred_liqs),
        "candidateZoneCount": len(zones),
        "firstTimestamp": to_int(first_timestamp) if first_timestamp is not None else None,
        "lastTimestamp": to_int(last_timestamp) if last_timestamp is not None else None,
        "totalNotionalUsd": round(total_notional, 2),
    }


def build_warnings(
    agg_trades: list[dict[str, Any]],
    inferred_liqs: list[dict[str, Any]],
    zones: list[dict[str, Any]],
    aggtrades_source: str,
    snapshot_source: str,
) -> list[str]:
    warnings = [
        "powered by liquidator-indicator on public aggTrades; this is still not a real liquidation feed",
        "current integration injects only the latest premiumIndex and openInterest snapshot; it does not stream funding or open-interest history",
        "strength and qualityLabel come from liquidator-indicator's internal scoring and should be treated as relative ranking, not win rate",
    ]
    if aggtrades_source == "file" or snapshot_source == "file":
        warnings.append("file-fed mode trusts upstream skill payloads; verify symbol, market, and freshness before acting")

    if len(agg_trades) < 100:
        warnings.append("trade sample is small; zone quality may be unstable")
    if len(inferred_liqs) == 0:
        warnings.append("no liquidation-like prints were inferred from the current aggTrades window")
    if len(zones) == 0:
        warnings.append("no candidate zones were found in the current lookback window")

    return warnings


def frame_to_records(frame) -> list[dict[str, Any]]:
    if frame is None:
        return []
    empty = getattr(frame, "empty", None)
    if empty is True:
        return []
    if hasattr(frame, "to_dict"):
        return frame.to_dict(orient="records")
    return []


def as_map(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def trade_timestamp(trade: dict[str, Any]) -> Optional[int]:
    value = trade.get("T")
    if value is None:
        value = trade.get("timestamp")
    return to_optional_int(value)


def trade_notional(trade: dict[str, Any]) -> float:
    explicit = trade.get("notional")
    if has_value(explicit):
        return to_float(explicit)

    price = trade.get("p")
    if price is None:
        price = trade.get("price")
    quantity = trade.get("q")
    if quantity is None:
        quantity = trade.get("quantity", trade.get("size"))
    return to_float(price) * to_float(quantity)


def normalize_dominant_side(value: Any) -> Optional[str]:
    normalized = stringify(value)
    if normalized is None:
        return None
    if normalized.lower() == "long":
        return "LONG"
    if normalized.lower() == "short":
        return "SHORT"
    return normalized.upper()


def extract_coin(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    for quote in ("USDT", "BUSD", "USDC", "FDUSD", "USD"):
        if normalized.endswith(quote):
            return normalized[: -len(quote)]
    return normalized


def normalize_symbol(symbol: str) -> str:
    return "".join(char for char in symbol.strip().upper() if char not in "/:_- ")


def read_flag_value(argv: list[str], index: int, name: str) -> str:
    if index >= len(argv):
        raise ValueError(f"{name} requires a value")
    value = argv[index]
    if value.startswith("--"):
        raise ValueError(f"{name} requires a value")
    return value


def parse_positive_int(value: str, name: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise ValueError(f"{name} must be greater than 0")
    return parsed


def parse_positive_float(value: str, name: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise ValueError(f"{name} must be greater than 0")
    return parsed


def validate_config(config: Config) -> None:
    if not config.symbol and not config.aggtrades_file and not config.snapshot_file:
        raise ValueError("provide --symbol or pass --aggtrades-file / --snapshot-file")
    if config.limit > 1000:
        raise ValueError("--limit cannot be greater than 1000")
    if config.zone_pct >= 0.05:
        raise ValueError("--zone-pct must be greater than 0 and less than 0.05")


def to_float(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    return parsed if math.isfinite(parsed) else 0.0


def to_int(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def to_optional_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return False
    return True


def stringify(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    if isinstance(value, float) and math.isnan(value):
        return None
    return str(value)


def to_millis(value: Any) -> Optional[int]:
    if value is None:
        return None
    iso_value = to_iso8601(value)
    if iso_value is None:
        return None
    try:
        return int(datetime.fromisoformat(iso_value.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def to_iso8601(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return stringify(value)


def to_iso8601_from_millis(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        timestamp = float(value) / 1000
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_in_shanghai() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat()


def print_json(value: Any) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False))


def format_error(error: Exception) -> str:
    message = str(error).strip()
    return message or error.__class__.__name__


if __name__ == "__main__":
    main()
