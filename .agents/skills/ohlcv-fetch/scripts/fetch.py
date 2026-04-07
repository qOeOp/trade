#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

try:
    import pandas as pd
except ImportError as pandas_import_error:  # pragma: no cover - runtime guidance
    raise SystemExit(
        f"pandas 未安装，请先执行: python3 -m pip install -r {Path(__file__).with_name('requirements.txt')}"
    ) from pandas_import_error


DEFAULT_LIMITS = {
    "1w": 300,
    "1d": 320,
    "4h": 420,
    "1h": 520,
}

TIMEFRAME_ORDER = ["1w", "1d", "4h", "1h"]
LOCAL_TZ = ZoneInfo("Asia/Shanghai")
REQUIREMENTS_FILE = Path(__file__).with_name("requirements.txt")
MARKET_TYPE_TO_EXCHANGE = {
    "spot": "binance",
    "usdm": "binanceusdm",
    "coinm": "binancecoinm",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch OHLCV and write local CSV files")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--exchange", default="binance")
    parser.add_argument("--market-type", choices=["spot", "usdm", "coinm"], default="spot")
    parser.add_argument("--timeframes", default="1w,1d,4h,1h")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--limit", type=int, default=None)
    return parser.parse_args()


def resolve_cli_path(raw_path: str) -> Path:
    expanded = os.path.expandvars(raw_path)
    path = Path(expanded).expanduser()
    if path.is_absolute():
        return path
    return (Path.cwd() / path).resolve()


def resolve_exchange_id(exchange_id: str, market_type: str) -> str:
    if exchange_id == "binance":
        return MARKET_TYPE_TO_EXCHANGE[market_type]
    return exchange_id


def resolve_symbol(symbol: str, market_type: str) -> str:
    if ":" in symbol or "/" not in symbol:
        return symbol

    base, quote = symbol.split("/", 1)
    if market_type == "usdm":
        return f"{base}/{quote}:{quote}"
    if market_type == "coinm":
        return f"{base}/{quote}:{base}"
    return symbol


def get_exchange(exchange_id: str) -> Any:
    try:
        import ccxt
    except ImportError as ccxt_import_error:  # pragma: no cover - runtime guidance
        raise SystemExit(
            f"ccxt 未安装，请先执行: python3 -m pip install -r {REQUIREMENTS_FILE}"
        ) from ccxt_import_error

    exchange_cls = getattr(ccxt, exchange_id, None)
    if exchange_cls is None:
        raise SystemExit(f"不支持的交易所: {exchange_id}")
    exchange = exchange_cls({"enableRateLimit": True})
    exchange.load_markets()
    return exchange


def ensure_symbol_supported(exchange: Any, symbol: str) -> None:
    if symbol not in exchange.markets:
        raise SystemExit(f"{exchange.id} 不支持该交易对: {symbol}")


def fetch_ohlcv(exchange: Any, symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    raw = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    if not raw:
        raise SystemExit(f"{symbol} {timeframe} 未返回 OHLCV")

    df = pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["date"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    return df[["date", "timestamp", "open", "high", "low", "close", "volume"]]


def ordered_timeframes(raw_timeframes: str) -> list[str]:
    parsed: list[str] = []
    for raw_timeframe in raw_timeframes.split(","):
        timeframe = raw_timeframe.strip()
        if timeframe:
            parsed.append(timeframe)

    ordered: list[str] = []
    for canonical_timeframe in TIMEFRAME_ORDER:
        if canonical_timeframe in parsed:
            ordered.append(canonical_timeframe)
    for timeframe in parsed:
        if timeframe not in TIMEFRAME_ORDER:
            ordered.append(timeframe)
    return ordered


def main() -> None:
    args = parse_args()
    base_output = resolve_cli_path(args.output_dir)
    base_output.mkdir(parents=True, exist_ok=True)

    resolved_exchange_id = resolve_exchange_id(args.exchange, args.market_type)
    resolved_symbol = resolve_symbol(args.symbol, args.market_type)
    exchange = get_exchange(resolved_exchange_id)
    ensure_symbol_supported(exchange, resolved_symbol)
    timeframes = ordered_timeframes(args.timeframes)
    if not timeframes:
        raise SystemExit("没有可抓取的 timeframe")

    manifest_timeframes: dict[str, dict[str, Any]] = {}
    for timeframe in timeframes:
        limit = args.limit if args.limit is not None else DEFAULT_LIMITS.get(timeframe, 300)
        df = fetch_ohlcv(exchange, resolved_symbol, timeframe, limit)
        csv_path = base_output / f"{timeframe}.csv"
        df_to_write = df.copy()
        df_to_write["date"] = df_to_write["date"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        df_to_write.to_csv(csv_path, index=False)
        manifest_timeframes[timeframe] = {
            "file": csv_path.name,
            "rows": len(df_to_write),
            "limit": limit,
        }

    payload = {
        "symbol": resolved_symbol,
        "requested_symbol": args.symbol,
        "exchange": resolved_exchange_id,
        "requested_exchange": args.exchange,
        "market_type": args.market_type,
        "generated_at": datetime.now(LOCAL_TZ).isoformat(),
        "output_dir": ".",
        "timeframes": manifest_timeframes,
    }

    manifest_path = base_output / "manifest.json"
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
