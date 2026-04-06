#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

try:
    import pandas as pd
except ImportError as pandas_import_error:  # pragma: no cover - runtime guidance
    raise SystemExit(
        "pandas 未安装，请先执行: python3 -m pip install -r requirements.txt"
    ) from pandas_import_error


CATALOG_FILE = "indicator_catalog.json"
TIMEFRAME_ORDER = ["1w", "1d", "4h", "1h"]
LOCAL_TZ = ZoneInfo("Asia/Shanghai")

PIVOT_WINDOWS = {
    "1w": 4,
    "1d": 5,
    "4h": 6,
    "1h": 8,
}

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
    parser = argparse.ArgumentParser(description="Technical indicators from local OHLCV files")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--indicators", default="all")
    parser.add_argument("--indicator-config", default=None)
    return parser.parse_args()


def resolve_cli_path(raw_path: str) -> Path:
    expanded = os.path.expandvars(raw_path)
    path = Path(expanded).expanduser()
    if path.is_absolute():
        return path
    return (Path.cwd() / path).resolve()


def catalog_path() -> Path:
    return Path(__file__).with_name(CATALOG_FILE)


def load_indicator_catalog() -> dict[str, dict[str, Any]]:
    return json.loads(catalog_path().read_text(encoding="utf-8"))


def load_manifest(manifest_path: Path) -> dict[str, Any]:
    if not manifest_path.exists():
        raise SystemExit(f"manifest 不存在: {manifest_path}")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def load_indicator_config(config_path: str | None) -> dict[str, dict[str, Any]]:
    if not config_path:
        return {}

    path = resolve_cli_path(config_path)
    if not path.exists():
        raise SystemExit(f"indicator-config 不存在: {path}")

    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("indicator-config 必须是一个对象")
    return payload


def selected_indicator_names(raw_value: str, catalog: dict[str, dict[str, Any]]) -> list[str]:
    if raw_value.strip().lower() == "all":
        return list(catalog.keys())

    selected: list[str] = []
    for raw_name in raw_value.split(","):
        indicator_name = raw_name.strip()
        if not indicator_name:
            continue
        if indicator_name not in catalog:
            raise SystemExit(f"未知指标: {indicator_name}")
        selected.append(indicator_name)

    if not selected:
        raise SystemExit("没有选中任何指标")
    return selected


def ordered_timeframes_from_manifest(manifest: dict[str, Any]) -> list[str]:
    manifest_timeframes = manifest.get("timeframes", {})
    ordered: list[str] = []
    for timeframe in TIMEFRAME_ORDER:
        if timeframe in manifest_timeframes:
            ordered.append(timeframe)
    for timeframe in manifest_timeframes:
        if timeframe not in TIMEFRAME_ORDER:
            ordered.append(timeframe)
    return ordered


def load_ohlcv_csv(csv_path: Path) -> pd.DataFrame:
    if not csv_path.exists():
        raise SystemExit(f"OHLCV 文件不存在: {csv_path}")

    df = pd.read_csv(csv_path)
    required_columns = ["date", "open", "high", "low", "close", "volume"]
    for column_name in required_columns:
        if column_name not in df.columns:
            raise SystemExit(f"{csv_path} 缺少字段: {column_name}")

    df["date"] = pd.to_datetime(df["date"], utc=True)
    df.set_index("date", inplace=True, drop=False)
    return df


def resolve_manifest_member_path(manifest_path: Path, raw_path: str) -> Path:
    expanded = os.path.expandvars(raw_path)
    path = Path(expanded).expanduser()
    if path.is_absolute():
        return path
    return (manifest_path.parent / path).resolve()


def normalize_scalar(value: Any) -> Any:
    if value is None:
        return None

    if isinstance(value, pd.Timestamp):
        return value.isoformat()

    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass

    try:
        if pd.isna(value):
            return None
    except Exception:
        pass

    if isinstance(value, float):
        return round(value, 6)

    return value


def latest_series_value(series: pd.Series) -> Any:
    cleaned = series.dropna()
    if cleaned.empty:
        return None
    return normalize_scalar(cleaned.iloc[-1])


def serialize_dataframe_result(
    dataframe: pd.DataFrame,
    base_columns: set[str],
    output_names: list[str] | None,
) -> dict[str, Any]:
    selected_columns: list[str] = []
    if output_names:
        for column_name in output_names:
            if column_name in dataframe.columns:
                selected_columns.append(column_name)
    else:
        for column_name in dataframe.columns:
            if column_name not in base_columns:
                selected_columns.append(column_name)

    if not selected_columns:
        for column_name in dataframe.columns:
            selected_columns.append(column_name)

    values: dict[str, Any] = {}
    for column_name in selected_columns:
        values[column_name] = latest_series_value(dataframe[column_name])

    return {"type": "dataframe", "values": values}


def serialize_dict_result(result: dict[str, Any], base_columns: set[str]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for key, value in result.items():
        values[key] = serialize_value(value, base_columns)
    return {"type": "dict", "values": values}


def serialize_sequence_result(
    result: list[Any] | tuple[Any, ...],
    base_columns: set[str],
    output_names: list[str] | None,
) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for index_number, value in enumerate(result):
        key = output_names[index_number] if output_names and index_number < len(output_names) else f"item_{index_number}"
        values[key] = serialize_value(value, base_columns)
    return {"type": "sequence", "values": values}


def serialize_value(value: Any, base_columns: set[str]) -> Any:
    if isinstance(value, pd.Series):
        return latest_series_value(value)
    if isinstance(value, pd.DataFrame):
        return serialize_dataframe_result(value, base_columns, None)
    if isinstance(value, dict):
        return serialize_dict_result(value, base_columns)
    if isinstance(value, tuple):
        return serialize_sequence_result(value, base_columns, None)
    if isinstance(value, list):
        return serialize_sequence_result(value, base_columns, None)
    return normalize_scalar(value)


def import_indicator_callable(module_name: str, function_name: str) -> Any:
    try:
        module = importlib.import_module(module_name)
    except ImportError as import_error:  # pragma: no cover - runtime guidance
        raise SystemExit(
            "technical 或其依赖未安装，请先执行: python3 -m pip install -r requirements.txt"
        ) from import_error
    return getattr(module, function_name)


def execute_indicator(
    dataframe: pd.DataFrame,
    indicator_name: str,
    spec: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, Any]:
    params = dict(spec.get("defaults", {}))
    params.update(config)
    func = import_indicator_callable(spec["module"], spec["function"])
    base_columns = set(dataframe.columns)

    try:
        raw_result = func(dataframe.copy(), **params)
        serialized_output = serialize_value(raw_result, base_columns)

        if isinstance(raw_result, tuple) or isinstance(raw_result, list):
            serialized_output = serialize_sequence_result(
                raw_result,
                base_columns,
                spec.get("output_names"),
            )
        elif isinstance(raw_result, pd.DataFrame):
            serialized_output = serialize_dataframe_result(
                raw_result,
                base_columns,
                spec.get("output_names"),
            )

        return {
            "status": "ok",
            "category": spec["category"],
            "params": params,
            "output": serialized_output,
        }
    except Exception as indicator_error:
        return {
            "status": "error",
            "category": spec["category"],
            "params": params,
            "error": str(indicator_error),
        }


def compute_library_indicators(
    dataframe: pd.DataFrame,
    selected_names: list[str],
    catalog: dict[str, dict[str, Any]],
    config: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for indicator_name in selected_names:
        spec = catalog[indicator_name]
        overrides = config.get(indicator_name, {})
        results[indicator_name] = execute_indicator(dataframe, indicator_name, spec, overrides)
    return results


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


def calculate_macd(df: pd.DataFrame) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema_fast = df["close"].ewm(span=12, adjust=False).mean()
    ema_slow = df["close"].ewm(span=26, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def apply_core_fields(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["ema_50"] = out["close"].ewm(span=50, adjust=False).mean()
    out["ema_200"] = out["close"].ewm(span=200, adjust=False).mean()
    out["atr_14"] = calculate_atr(out, 14)
    macd_line, signal_line, histogram = calculate_macd(out)
    out["macd"] = macd_line
    out["macd_signal"] = signal_line
    out["macd_histogram"] = histogram
    return out


def pivot_price_key(pivot_point: Pivot) -> float:
    return pivot_point.price


def pivot_index_key(pivot_point: Pivot) -> int:
    return pivot_point.index


def level_sort_key(price_level: PriceLevel) -> tuple[int, int]:
    return -price_level.touches, -price_level.last_touch_index


def trendline_score_key(trendline_entry: Trendline) -> float:
    return trendline_entry.score


def detect_pivots(df: pd.DataFrame, window: int) -> tuple[list[Pivot], list[Pivot]]:
    highs: list[Pivot] = []
    lows: list[Pivot] = []
    for index_number in range(window, len(df) - window):
        high_window = df["high"].iloc[index_number - window : index_number + window + 1]
        low_window = df["low"].iloc[index_number - window : index_number + window + 1]
        current_high = float(df["high"].iloc[index_number])
        current_low = float(df["low"].iloc[index_number])
        timestamp = df.index[index_number].isoformat()

        if current_high >= float(high_window.max()):
            highs.append(Pivot(index_number, timestamp, current_high, "high"))
        if current_low <= float(low_window.min()):
            lows.append(Pivot(index_number, timestamp, current_low, "low"))

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

    pivots_sorted = sorted(pivots, key=pivot_price_key)
    clusters: list[list[Pivot]] = [[pivots_sorted[0]]]
    for pivot in pivots_sorted[1:]:
        current_cluster = clusters[-1]
        cluster_total = 0.0
        for cluster_pivot in current_cluster:
            cluster_total += cluster_pivot.price
        cluster_avg = cluster_total / len(current_cluster)
        tolerance = max(cluster_avg * cluster_pct, atr_value * atr_multiplier)
        if abs(pivot.price - cluster_avg) <= tolerance:
            current_cluster.append(pivot)
        else:
            clusters.append([pivot])

    levels: list[PriceLevel] = []
    for cluster in clusters:
        cluster_total = 0.0
        for cluster_pivot in cluster:
            cluster_total += cluster_pivot.price
        avg_price = float(cluster_total / len(cluster))
        tolerance = max(avg_price * cluster_pct, atr_value * atr_multiplier)
        touch_indices = count_horizontal_touches(df, kind, avg_price, tolerance)
        touches = max(len(cluster), len(touch_indices))
        if touch_indices:
            last_touch_index = touch_indices[-1]
        else:
            last_touch_index = max(cluster, key=pivot_index_key).index

        if touches >= 5:
            strength = "strong"
        elif touches >= 3:
            strength = "moderate"
        else:
            strength = "weak"

        source_prices: list[float] = []
        for cluster_pivot in cluster:
            source_prices.append(round(cluster_pivot.price, 2))

        levels.append(
            PriceLevel(
                price=round(avg_price, 2),
                touches=touches,
                strength=strength,
                last_touch_index=last_touch_index,
                last_touch_time=df.index[last_touch_index].isoformat(),
                source_prices=source_prices,
            )
        )

    levels.sort(key=level_sort_key)
    deduped: list[PriceLevel] = []
    for level in levels:
        is_duplicate = False
        for existing_level in deduped:
            tolerance = max(existing_level.price * cluster_pct, atr_value * atr_multiplier)
            if abs(level.price - existing_level.price) <= tolerance:
                is_duplicate = True
                break
        if is_duplicate:
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
    for index_number, value in enumerate(series):
        if abs(float(value) - level_price) <= tolerance:
            if not touch_indices or (index_number - touch_indices[-1]) >= min_gap:
                touch_indices.append(index_number)
    return touch_indices


def select_levels(
    timeframe: str,
    support_levels: list[PriceLevel],
    resistance_levels: list[PriceLevel],
    current_price: float,
    max_levels: int,
) -> tuple[list[PriceLevel], list[PriceLevel]]:
    max_distance_ratio = LEVEL_DISTANCE_LIMITS.get(timeframe, 0.10)

    def within_range(price_level: PriceLevel) -> bool:
        return abs(price_level.price - current_price) / current_price <= max_distance_ratio

    def support_rank(price_level: PriceLevel) -> tuple[float, int, int]:
        return (
            current_price - price_level.price,
            -price_level.last_touch_index,
            -price_level.touches,
        )

    def resistance_rank(price_level: PriceLevel) -> tuple[float, int, int]:
        return (
            price_level.price - current_price,
            -price_level.last_touch_index,
            -price_level.touches,
        )

    support_candidates_in_range: list[PriceLevel] = []
    for support_level in support_levels:
        if support_level.price < current_price and within_range(support_level):
            support_candidates_in_range.append(support_level)
    supports = sorted(support_candidates_in_range, key=support_rank)

    resistance_candidates_in_range: list[PriceLevel] = []
    for resistance_level in resistance_levels:
        if resistance_level.price > current_price and within_range(resistance_level):
            resistance_candidates_in_range.append(resistance_level)
    resistances = sorted(resistance_candidates_in_range, key=resistance_rank)

    if not supports:
        fallback_supports: list[PriceLevel] = []
        for support_level in support_levels:
            if support_level.price < current_price:
                fallback_supports.append(support_level)
        supports = sorted(fallback_supports, key=support_rank)[:1]

    if not resistances:
        fallback_resistances: list[PriceLevel] = []
        for resistance_level in resistance_levels:
            if resistance_level.price > current_price:
                fallback_resistances.append(resistance_level)
        resistances = sorted(fallback_resistances, key=resistance_rank)[:1]

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
    for index_number in range(start_index, len(df)):
        line_price = slope * index_number + intercept
        tolerance = max(abs(line_price) * 0.0015, atr_value * 0.25)
        close_price = float(df["close"].iloc[index_number])
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
            score = (
                len(touch_indices) * 18
                + min(span, 240) * 0.08
                - (abs(projected - current_price) / max(atr_value, 1.0))
            )
            invalidation_side = "below" if kind == "support" else "above"
            last_touch_index = touch_indices[-1]
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
                    last_touch_time=df.index[last_touch_index].isoformat(),
                    invalidation=f"{timeframe} close {invalidation_side} trendline ({projected:.2f})",
                    score=round(score, 2),
                )
            )

    candidates.sort(key=trendline_score_key, reverse=True)
    selected: list[Trendline] = []
    for candidate_item in candidates:
        duplicate = False
        for existing in selected:
            projected_gap = abs(candidate_item.projected_price - existing.projected_price)
            slope_gap = abs(candidate_item.slope - existing.slope)
            if projected_gap <= max(atr_value * 0.5, current_price * 0.0025) and slope_gap <= 0.02:
                duplicate = True
                break
        if not duplicate:
            selected.append(candidate_item)
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
    for index_number in range(start_index, len(df)):
        line_price = slope * index_number + intercept
        tolerance = max(abs(line_price) * 0.0035, atr_value * 0.45)
        if abs(float(series.iloc[index_number]) - line_price) <= tolerance:
            if not touch_indices or (index_number - touch_indices[-1]) >= min_gap:
                touch_indices.append(index_number)
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


def build_highlight_lines(result: dict[str, Any]) -> list[str]:
    highlights: list[str] = []
    indicators = result["indicators"]

    for indicator_name in ["ema", "sma", "bollinger_bands", "supertrend", "ichimoku", "chaikin_money_flow", "atr_percent", "williams_percent"]:
        indicator_result = indicators.get(indicator_name)
        if not indicator_result or indicator_result.get("status") != "ok":
            continue
        output = indicator_result["output"]
        highlights.append(f"- {indicator_name}: `{json.dumps(output, ensure_ascii=False)}`")

    if not highlights:
        highlights.append("- 关键指标未生成，可查看 analysis.json 中的 error 字段")
    return highlights


def build_markdown_report(
    symbol: str,
    exchange_id: str,
    timeframe_results: dict[str, dict[str, Any]],
    summary: dict[str, str],
    selected_indicators: list[str],
) -> str:
    lines = [
        f"# {symbol} 技术分析",
        "",
        f"- 交易所: `{exchange_id}`",
        f"- 生成时间: `{datetime.now(LOCAL_TZ).strftime('%Y-%m-%d %H:%M:%S %Z')}`",
        f"- 总体倾向: `{summary['bias']}`",
        f"- 当前建议: {summary['suggestion']}",
        f"- 已执行指标数量: `{len(selected_indicators)}`",
        "",
        "完整指标结果见 `analysis.json`。",
        "",
    ]

    for timeframe in TIMEFRAME_ORDER:
        result = timeframe_results.get(timeframe)
        if not result:
            continue

        core = result["core_context"]
        lines.extend(
            [
                f"## {timeframe}",
                "",
                f"- 趋势: `{result['trend']}`",
                f"- 当前价: `{core['current_price']}`",
                f"- EMA50 / EMA200: `{core['ema_50']}` / `{core['ema_200']}`",
                f"- ATR14: `{core['atr_14']}`",
                f"- 区间位置: `{result['position_in_range']}`",
                f"- 多头失效: {result['bullish_invalidation']}",
                f"- 空头失效: {result['bearish_invalidation']}",
                "",
                "### 指标快照",
                "",
            ]
        )
        lines.extend(build_highlight_lines(result))

        lines.extend(["", "### 支撑位", ""])
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
            for report_line in result["trendlines"]:
                lines.append(
                    f"- `{report_line['kind']}` line @ `{report_line['projected_price']}` | touches={report_line['touches']} | invalidation={report_line['invalidation']}"
                )
        else:
            lines.append("- 无有效活跃趋势线")
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def timeframe_analysis(
    timeframe: str,
    df: pd.DataFrame,
    selected_names: list[str],
    catalog: dict[str, dict[str, Any]],
    config: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    df = apply_core_fields(df)
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
    trendlines.sort(key=trendline_score_key, reverse=True)
    trendlines = trendlines[:4]

    trend = detect_trend(df, highs, lows)
    position_in_range = classify_range_position(current_price, supports, resistances)
    bullish_invalidation = (
        f"{timeframe} close below {supports[0].price:.2f}" if supports else "暂无明确近端支撑失效位"
    )
    bearish_invalidation = (
        f"{timeframe} close above {resistances[0].price:.2f}" if resistances else "暂无明确近端压力失效位"
    )

    serialized_supports: list[dict[str, Any]] = []
    for support_level in supports:
        serialized_supports.append(asdict(support_level))

    serialized_resistances: list[dict[str, Any]] = []
    for resistance_level in resistances:
        serialized_resistances.append(asdict(resistance_level))

    serialized_trendlines: list[dict[str, Any]] = []
    for trendline_entry in trendlines:
        serialized_trendlines.append(asdict(trendline_entry))

    library_indicators = compute_library_indicators(df, selected_names, catalog, config)
    core_context = {
        "current_price": round(current_price, 2),
        "atr_14": round(atr_value, 2),
        "ema_50": round(float(df["ema_50"].iloc[-1]), 2),
        "ema_200": round(float(df["ema_200"].iloc[-1]), 2),
        "macd": round(float(df["macd"].iloc[-1]), 4),
        "macd_signal": round(float(df["macd_signal"].iloc[-1]), 4),
        "macd_histogram": round(float(df["macd_histogram"].iloc[-1]), 4),
    }

    return {
        "trend": trend,
        "core_context": core_context,
        "indicators": library_indicators,
        "supports": serialized_supports,
        "resistances": serialized_resistances,
        "trendlines": serialized_trendlines,
        "position_in_range": position_in_range,
        "bullish_invalidation": bullish_invalidation,
        "bearish_invalidation": bearish_invalidation,
    }


def build_selected_indicator_catalog(
    selected_names: list[str],
    catalog: dict[str, dict[str, Any]],
    config: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    selected_catalog: dict[str, dict[str, Any]] = {}
    for indicator_name in selected_names:
        spec = dict(catalog[indicator_name])
        params = dict(spec.get("defaults", {}))
        params.update(config.get(indicator_name, {}))
        spec["defaults"] = params
        selected_catalog[indicator_name] = spec
    return selected_catalog


def main() -> None:
    args = parse_args()
    manifest_path = resolve_cli_path(args.manifest)
    base_output = resolve_cli_path(args.output_dir)
    base_output.mkdir(parents=True, exist_ok=True)

    manifest = load_manifest(manifest_path)
    catalog = load_indicator_catalog()
    config = load_indicator_config(args.indicator_config)
    selected_names = selected_indicator_names(args.indicators, catalog)
    selected_catalog = build_selected_indicator_catalog(selected_names, catalog, config)

    ordered_timeframes = ordered_timeframes_from_manifest(manifest)
    if not ordered_timeframes:
        raise SystemExit("manifest 中没有可分析的 timeframe")

    raw_results: dict[str, dict[str, Any]] = {}
    manifest_timeframes = manifest["timeframes"]
    for timeframe in ordered_timeframes:
        csv_path = resolve_manifest_member_path(manifest_path, manifest_timeframes[timeframe]["file"])
        df = load_ohlcv_csv(csv_path)
        raw_results[timeframe] = timeframe_analysis(timeframe, df, selected_names, catalog, config)

    summary = summarize_overall(raw_results)
    payload = {
        "symbol": manifest["symbol"],
        "exchange": manifest["exchange"],
        "source_manifest": str(manifest_path),
        "generated_at": datetime.now(LOCAL_TZ).isoformat(),
        "selected_indicators": selected_catalog,
        "timeframes": raw_results,
        "summary": summary,
        "output_dir": str(base_output),
    }

    (base_output / "analysis.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (base_output / "selected-indicators.json").write_text(
        json.dumps(selected_catalog, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (base_output / "summary.md").write_text(
        build_markdown_report(
            manifest["symbol"],
            manifest["exchange"],
            raw_results,
            summary,
            selected_names,
        ),
        encoding="utf-8",
    )

    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
