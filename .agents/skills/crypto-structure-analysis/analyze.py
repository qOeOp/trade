#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd


DEFAULT_LIMITS = {
    "1w": 300,
    "1d": 320,
    "4h": 420,
    "1h": 520,
}

PIVOT_WINDOWS = {
    "1w": 4,
    "1d": 5,
    "4h": 6,
    "1h": 8,
}

TIMEFRAME_ORDER = ["1w", "1d", "4h", "1h"]
LOCAL_TZ = ZoneInfo("Asia/Shanghai")

LEVEL_DISTANCE_LIMITS = {
    "1w": 0.30,
    "1d": 0.15,
    "4h": 0.08,
    "1h": 0.05,
}


@dataclass
class Pivot:
    index: int
    timestamp: str
    price: float
    kind: str


@dataclass
class PriceLevel:
    price: float
    touches: int
    strength: str
    last_touch_index: int
    last_touch_time: str
    source_prices: list[float]


@dataclass
class Trendline:
    kind: str
    anchor_indices: list[int]
    anchor_prices: list[float]
    touches: int
    slope: float
    intercept: float
    projected_price: float
    last_touch_index: int
    last_touch_time: str
    invalidation: str
    score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Crypto multi-timeframe structure analysis")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--exchange", default="binance")
    parser.add_argument("--timeframes", default="1w,1d,4h,1h")
    parser.add_argument("--output-dir", default=None)
    return parser.parse_args()


def get_exchange(exchange_id: str) -> Any:
    try:
        import ccxt
    except ImportError as exc:  # pragma: no cover - runtime guidance
        raise SystemExit(
            "ccxt 未安装，请先执行: python3 -m pip install -r requirements.txt"
        ) from exc

    exchange_cls = getattr(ccxt, exchange_id, None)
    if exchange_cls is None:
        raise SystemExit(f"不支持的交易所: {exchange_id}")
    exchange = exchange_cls({"enableRateLimit": True})
    exchange.load_markets()
    return exchange


def fetch_ohlcv(exchange: Any, symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    raw = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    if not raw:
        raise ValueError(f"{symbol} {timeframe} 未返回 OHLCV")
    df = pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df.set_index("datetime", inplace=True)
    return df


def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.rolling(period, min_periods=period).mean()


def calculate_emas(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["ema_20"] = out["close"].ewm(span=20, adjust=False).mean()
    out["ema_50"] = out["close"].ewm(span=50, adjust=False).mean()
    out["ema_200"] = out["close"].ewm(span=200, adjust=False).mean()
    out["atr_14"] = calculate_atr(out, 14)
    return out


def detect_pivots(df: pd.DataFrame, window: int) -> tuple[list[Pivot], list[Pivot]]:
    highs: list[Pivot] = []
    lows: list[Pivot] = []
    for i in range(window, len(df) - window):
        high_window = df["high"].iloc[i - window : i + window + 1]
        low_window = df["low"].iloc[i - window : i + window + 1]
        current_high = float(df["high"].iloc[i])
        current_low = float(df["low"].iloc[i])
        ts = df.index[i].isoformat()

        if current_high >= float(high_window.max()):
            highs.append(Pivot(i, ts, current_high, "high"))
        if current_low <= float(low_window.min()):
            lows.append(Pivot(i, ts, current_low, "low"))

    return highs, lows


def cluster_levels(
    df: pd.DataFrame,
    pivots: list[Pivot],
    kind: str,
    atr_value: float,
    cluster_pct: float,
    atr_multiplier: float,
    max_levels: int,
) -> list[PriceLevel]:
    if not pivots:
        return []

    pivots_sorted = sorted(pivots, key=lambda p: p.price)
    clusters: list[list[Pivot]] = [[pivots_sorted[0]]]
    for pivot in pivots_sorted[1:]:
        current_cluster = clusters[-1]
        cluster_avg = sum(item.price for item in current_cluster) / len(current_cluster)
        tolerance = max(cluster_avg * cluster_pct, atr_value * atr_multiplier)
        if abs(pivot.price - cluster_avg) <= tolerance:
            current_cluster.append(pivot)
        else:
            clusters.append([pivot])

    levels: list[PriceLevel] = []
    for cluster in clusters:
        avg_price = float(sum(item.price for item in cluster) / len(cluster))
        tolerance = max(avg_price * cluster_pct, atr_value * atr_multiplier)
        touch_indices = count_horizontal_touches(df, kind, avg_price, tolerance)
        touches = max(len(cluster), len(touch_indices))
        last_touch_index = touch_indices[-1] if touch_indices else max(cluster, key=lambda p: p.index).index
        last_touch_time = df.index[last_touch_index].isoformat()
        if touches >= 5:
            strength = "strong"
        elif touches >= 3:
            strength = "moderate"
        else:
            strength = "weak"
        levels.append(
            PriceLevel(
                price=round(avg_price, 2),
                touches=touches,
                strength=strength,
                last_touch_index=last_touch_index,
                last_touch_time=last_touch_time,
                source_prices=[round(item.price, 2) for item in cluster],
            )
        )

    levels.sort(key=lambda item: (-item.touches, -item.last_touch_index))
    deduped: list[PriceLevel] = []
    for level in levels:
        if any(abs(level.price - existing.price) <= max(existing.price * cluster_pct, atr_value * atr_multiplier) for existing in deduped):
            continue
        deduped.append(level)
    return deduped[:max_levels]


def count_horizontal_touches(
    df: pd.DataFrame,
    kind: str,
    level_price: float,
    tolerance: float,
) -> list[int]:
    series = df["low"] if kind == "support" else df["high"]
    min_gap = max(3, len(df) // 80)
    touch_indices: list[int] = []
    for i, value in enumerate(series):
        if abs(float(value) - level_price) <= tolerance:
            if not touch_indices or (i - touch_indices[-1]) >= min_gap:
                touch_indices.append(i)
    return touch_indices


def select_levels(
    timeframe: str,
    support_levels: list[PriceLevel],
    resistance_levels: list[PriceLevel],
    current_price: float,
    max_levels: int,
) -> tuple[list[PriceLevel], list[PriceLevel]]:
    max_distance_ratio = LEVEL_DISTANCE_LIMITS.get(timeframe, 0.10)

    def within_range(level: PriceLevel) -> bool:
        return abs(level.price - current_price) / current_price <= max_distance_ratio

    supports = sorted(
        [level for level in support_levels if level.price < current_price and within_range(level)],
        key=lambda level: (current_price - level.price, -level.last_touch_index, -level.touches),
    )
    resistances = sorted(
        [level for level in resistance_levels if level.price > current_price and within_range(level)],
        key=lambda level: (level.price - current_price, -level.last_touch_index, -level.touches),
    )

    if not supports:
        supports = sorted(
            [level for level in support_levels if level.price < current_price],
            key=lambda level: (current_price - level.price, -level.last_touch_index, -level.touches),
        )[:1]
    if not resistances:
        resistances = sorted(
            [level for level in resistance_levels if level.price > current_price],
            key=lambda level: (level.price - current_price, -level.last_touch_index, -level.touches),
        )[:1]

    return supports[:max_levels], resistances[:max_levels]


def count_line_touches(
    pivots: list[Pivot],
    slope: float,
    intercept: float,
    atr_value: float,
    proximity_pct: float,
) -> tuple[list[Pivot], int]:
    touched: list[Pivot] = []
    for pivot in pivots:
        line_price = slope * pivot.index + intercept
        tolerance = max(abs(line_price) * proximity_pct, atr_value * 0.35)
        if abs(pivot.price - line_price) <= tolerance:
            touched.append(pivot)
    return touched, len(touched)


def line_broken(
    df: pd.DataFrame,
    kind: str,
    start_index: int,
    slope: float,
    intercept: float,
    atr_value: float,
) -> bool:
    for i in range(start_index, len(df)):
        line_price = slope * i + intercept
        tolerance = max(abs(line_price) * 0.0015, atr_value * 0.25)
        close_price = float(df["close"].iloc[i])
        if kind == "support" and close_price < line_price - tolerance:
            return True
        if kind == "resistance" and close_price > line_price + tolerance:
            return True
    return False


def detect_trendlines(
    df: pd.DataFrame,
    pivots: list[Pivot],
    kind: str,
    timeframe: str,
    atr_value: float,
    current_price: float,
    max_lines: int = 3,
) -> list[Trendline]:
    if len(pivots) < 3:
        return []

    recent_pivots = pivots[-14:]
    candidates: list[Trendline] = []

    for left in range(len(recent_pivots) - 1):
        for right in range(left + 1, len(recent_pivots)):
            first = recent_pivots[left]
            second = recent_pivots[right]
            span = second.index - first.index
            if span < 8:
                continue

            slope = (second.price - first.price) / span
            intercept = first.price - slope * first.index
            pivot_touches, _ = count_line_touches(
                recent_pivots,
                slope,
                intercept,
                atr_value,
                proximity_pct=0.0035,
            )
            if len(pivot_touches) < 2:
                continue

            touch_indices = count_trendline_touches(
                df,
                kind,
                first.index,
                slope,
                intercept,
                atr_value,
            )
            if len(touch_indices) < 3:
                continue
            if line_broken(df, kind, second.index + 1, slope, intercept, atr_value):
                continue

            projected = slope * (len(df) - 1) + intercept
            last_touch_index = touch_indices[-1]
            last_touch_time = df.index[last_touch_index].isoformat()
            score = (
                len(touch_indices) * 18
                + min(span, 240) * 0.08
                - (abs(projected - current_price) / max(atr_value, 1.0))
            )
            invalidation_side = "below" if kind == "support" else "above"
            candidates.append(
                Trendline(
                    kind=kind,
                    anchor_indices=[first.index, second.index],
                    anchor_prices=[round(first.price, 2), round(second.price, 2)],
                    touches=len(touch_indices),
                    slope=round(slope, 6),
                    intercept=round(intercept, 2),
                    projected_price=round(projected, 2),
                    last_touch_index=last_touch_index,
                    last_touch_time=last_touch_time,
                    invalidation=f"{timeframe} close {invalidation_side} trendline ({projected:.2f})",
                    score=round(score, 2),
                )
            )

    candidates.sort(key=lambda line: line.score, reverse=True)
    selected: list[Trendline] = []
    for line in candidates:
        duplicate = False
        for existing in selected:
            projected_gap = abs(line.projected_price - existing.projected_price)
            slope_gap = abs(line.slope - existing.slope)
            if projected_gap <= max(atr_value * 0.5, current_price * 0.0025) and slope_gap <= 0.02:
                duplicate = True
                break
        if not duplicate:
            selected.append(line)
        if len(selected) >= max_lines:
            break
    return selected


def count_trendline_touches(
    df: pd.DataFrame,
    kind: str,
    start_index: int,
    slope: float,
    intercept: float,
    atr_value: float,
) -> list[int]:
    series = df["low"] if kind == "support" else df["high"]
    min_gap = max(4, len(df) // 90)
    touch_indices: list[int] = []
    for i in range(start_index, len(df)):
        line_price = slope * i + intercept
        tolerance = max(abs(line_price) * 0.0035, atr_value * 0.45)
        if abs(float(series.iloc[i]) - line_price) <= tolerance:
            if not touch_indices or (i - touch_indices[-1]) >= min_gap:
                touch_indices.append(i)
    return touch_indices


def detect_trend(df: pd.DataFrame, highs: list[Pivot], lows: list[Pivot]) -> str:
    latest = df.iloc[-1]
    close_price = float(latest["close"])
    ema_50 = float(latest["ema_50"])
    ema_200 = float(latest["ema_200"])

    higher_high = len(highs) >= 2 and highs[-1].price > highs[-2].price
    higher_low = len(lows) >= 2 and lows[-1].price > lows[-2].price
    lower_high = len(highs) >= 2 and highs[-1].price < highs[-2].price
    lower_low = len(lows) >= 2 and lows[-1].price < lows[-2].price

    if close_price > ema_50 > ema_200 and higher_high and higher_low:
        return "bullish"
    if close_price < ema_50 < ema_200 and lower_high and lower_low:
        return "bearish"
    if close_price > ema_200 and higher_low:
        return "bullish-leaning"
    if close_price < ema_200 and lower_high:
        return "bearish-leaning"
    return "neutral"


def classify_range_position(
    current_price: float,
    supports: list[PriceLevel],
    resistances: list[PriceLevel],
) -> str:
    nearest_support = supports[0].price if supports else None
    nearest_resistance = resistances[0].price if resistances else None
    if nearest_support is None or nearest_resistance is None:
        return "unbounded"
    span = nearest_resistance - nearest_support
    if span <= 0:
        return "compressed"
    ratio = (current_price - nearest_support) / span
    if ratio < 0.25:
        return "lower-quarter"
    if ratio < 0.45:
        return "lower-middle"
    if ratio < 0.65:
        return "mid-range"
    if ratio < 0.85:
        return "upper-middle"
    return "upper-quarter"


def timeframe_bias_label(trend: str) -> int:
    return {
        "bullish": 2,
        "bullish-leaning": 1,
        "neutral": 0,
        "bearish-leaning": -1,
        "bearish": -2,
    }.get(trend, 0)


def summarize_overall(timeframe_results: dict[str, dict[str, Any]]) -> dict[str, str]:
    weights = {"1w": 4, "1d": 3, "4h": 2, "1h": 1}
    score = 0
    for timeframe, result in timeframe_results.items():
        score += timeframe_bias_label(result["trend"]) * weights.get(timeframe, 1)

    if score >= 7:
        bias = "偏多"
        suggestion = "更适合等回踩支撑后观察承接"
    elif score >= 2:
        bias = "轻度偏多"
        suggestion = "更适合等回踩或低周期重新站稳"
    elif score <= -7:
        bias = "偏空"
        suggestion = "更适合等反弹压力后观察转弱"
    elif score <= -2:
        bias = "轻度偏空"
        suggestion = "更适合等反弹或低周期失守"
    else:
        bias = "中性"
        suggestion = "更适合先观察，等待区间边缘或突破确认"
    return {"bias": bias, "suggestion": suggestion}


def build_markdown_report(
    symbol: str,
    exchange_id: str,
    timeframe_results: dict[str, dict[str, Any]],
    summary: dict[str, str],
) -> str:
    lines = [
        f"# {symbol} 多周期结构分析",
        "",
        f"- 交易所: `{exchange_id}`",
        f"- 生成时间: `{datetime.now(LOCAL_TZ).strftime('%Y-%m-%d %H:%M:%S %Z')}`",
        f"- 总体倾向: `{summary['bias']}`",
        f"- 当前建议: {summary['suggestion']}",
        "",
    ]

    for timeframe in TIMEFRAME_ORDER:
        result = timeframe_results.get(timeframe)
        if not result:
            continue
        lines.extend(
            [
                f"## {timeframe}",
                "",
                f"- 趋势: `{result['trend']}`",
                f"- 区间位置: `{result['position_in_range']}`",
                f"- 多头失效: {result['bullish_invalidation']}",
                f"- 空头失效: {result['bearish_invalidation']}",
                "",
                "### 支撑位",
                "",
            ]
        )
        if result["supports"]:
            for level in result["supports"]:
                lines.append(
                    f"- `{level['price']}` | touches={level['touches']} | strength={level['strength']}"
                )
        else:
            lines.append("- 无明显近端支撑位")

        lines.extend(["", "### 压力位", ""])
        if result["resistances"]:
            for level in result["resistances"]:
                lines.append(
                    f"- `{level['price']}` | touches={level['touches']} | strength={level['strength']}"
                )
        else:
            lines.append("- 无明显近端压力位")

        lines.extend(["", "### 趋势线", ""])
        if result["trendlines"]:
            for line in result["trendlines"]:
                lines.append(
                    f"- `{line['kind']}` line @ `{line['projected_price']}` | touches={line['touches']} | invalidation={line['invalidation']}"
                )
        else:
            lines.append("- 无有效活跃趋势线")
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def timeframe_analysis(timeframe: str, df: pd.DataFrame) -> dict[str, Any]:
    df = calculate_emas(df)
    current_price = float(df["close"].iloc[-1])
    atr_value = float(df["atr_14"].dropna().iloc[-1]) if not df["atr_14"].dropna().empty else max(current_price * 0.005, 1.0)

    highs, lows = detect_pivots(df, PIVOT_WINDOWS.get(timeframe, 5))
    support_candidates = cluster_levels(
        df,
        lows,
        "support",
        atr_value,
        cluster_pct=0.005,
        atr_multiplier=0.8,
        max_levels=8,
    )
    resistance_candidates = cluster_levels(
        df,
        highs,
        "resistance",
        atr_value,
        cluster_pct=0.005,
        atr_multiplier=0.8,
        max_levels=8,
    )
    supports, resistances = select_levels(
        timeframe,
        support_candidates,
        resistance_candidates,
        current_price,
        max_levels=5,
    )

    support_lines = detect_trendlines(df, lows, "support", timeframe, atr_value, current_price)
    resistance_lines = detect_trendlines(df, highs, "resistance", timeframe, atr_value, current_price)
    trendlines = support_lines + resistance_lines
    trendlines.sort(key=lambda item: item.score, reverse=True)
    trendlines = trendlines[:4]

    trend = detect_trend(df, highs, lows)
    position_in_range = classify_range_position(current_price, supports, resistances)
    bullish_invalidation = (
        f"{timeframe} close below {supports[0].price:.2f}" if supports else "暂无明确近端支撑失效位"
    )
    bearish_invalidation = (
        f"{timeframe} close above {resistances[0].price:.2f}" if resistances else "暂无明确近端压力失效位"
    )

    return {
        "dataframe": df,
        "high_pivots": highs,
        "low_pivots": lows,
        "trend": trend,
        "supports": [asdict(level) for level in supports],
        "resistances": [asdict(level) for level in resistances],
        "trendlines": [asdict(line) for line in trendlines],
        "position_in_range": position_in_range,
        "bullish_invalidation": bullish_invalidation,
        "bearish_invalidation": bearish_invalidation,
        "current_price": round(current_price, 2),
        "atr_14": round(atr_value, 2),
    }


def serialize_results(raw_results: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    serialized: dict[str, dict[str, Any]] = {}
    for timeframe, result in raw_results.items():
        serialized[timeframe] = {
            key: value
            for key, value in result.items()
            if key not in {"dataframe", "high_pivots", "low_pivots"}
        }
    return serialized


def main() -> None:
    args = parse_args()
    timeframes = [item.strip() for item in args.timeframes.split(",") if item.strip()]
    ordered_timeframes = [tf for tf in TIMEFRAME_ORDER if tf in timeframes] + [
        tf for tf in timeframes if tf not in TIMEFRAME_ORDER
    ]

    timestamp = datetime.now(LOCAL_TZ).strftime("%Y%m%d-%H%M%S")
    base_output = Path(args.output_dir) if args.output_dir else Path(__file__).resolve().parent / "output" / timestamp
    base_output.mkdir(parents=True, exist_ok=True)

    exchange = get_exchange(args.exchange)

    raw_results: dict[str, dict[str, Any]] = {}
    for timeframe in ordered_timeframes:
        limit = DEFAULT_LIMITS.get(timeframe, 300)
        df = fetch_ohlcv(exchange, args.symbol, timeframe, limit)
        raw_results[timeframe] = timeframe_analysis(timeframe, df)

    summary = summarize_overall(raw_results)
    serializable = serialize_results(raw_results)
    payload = {
        "symbol": args.symbol,
        "exchange": args.exchange,
        "generated_at": datetime.now(LOCAL_TZ).isoformat(),
        "timeframes": serializable,
        "summary": summary,
        "output_dir": str(base_output),
    }

    json_path = base_output / "analysis.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    markdown = build_markdown_report(args.symbol, args.exchange, serializable, summary)
    summary_path = base_output / "summary.md"
    summary_path.write_text(markdown, encoding="utf-8")

    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
