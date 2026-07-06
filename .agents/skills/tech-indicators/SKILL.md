---
name: tech-indicators
description: >-
  Calculate technical analysis and BTC beta from local OHLCV files. Use when
  Codex needs to read manifest-driven OHLCV CSV data, compute selected
  indicators plus support, resistance, trendlines, and invalidation levels,
  or compute per-symbol BTC beta (full + downside) for cross-lane risk
  aggregation, and write machine-readable and readable summaries to local
  files.
---

# Tech Indicators

读取本地 OHLCV 数据并返回技术分析 JSON。

## 使用流程

1. 接收 `ohlcv-fetch` 落盘后的 `manifest.json`。
2. 进入 skill 目录后直接执行 `go run ./scripts --manifest ...`。
3. 脚本只返回 JSON，不再自动写 `analysis.json`、`summary.md` 或其它副本。
4. 需要缩小范围时，显式传 `--indicators` 或 `--indicator-config`。
5. 需要解释指标含义时，读取 `references/indicators.md`。

## 输入要求

- 输入来源是 `ohlcv-fetch` 产出的 `manifest.json`。
- 每个 CSV 至少包含 `date`、`open`、`high`、`low`、`close`、`volume`。
- `manifest.json` 中的相对路径按 manifest 所在目录解析。
- `--catalog` 可选；未传时默认读取源码目录下的 `indicator_catalog.json`。

## 输出

脚本会返回 `{ ok, data }`，其中 `data` 包含：

- `summary`
- `summary_markdown`
- `selected_indicators`
- 各 timeframe 的完整 `indicators` / `supports` / `resistances` / `trendlines`
- 结构输出会附带当前仓库口径下的证据字段与历史触碰自校验统计
- 各 timeframe 的 `structure_validation`，用于输出 walk-forward 的第二层历史验证汇总
- 结构字段定义见 `references/indicators.md`

## β 计算（compute_beta_btc）

除技术指标外，本 skill 还承担 BTC β 计算职责，供 `G-BTC-BETA-DIRECTION-CAP` 使用。

### 接口约定

`compute_beta_btc(symbol, lookback_days=30)` 返回：

```json
{
  "ok": true,
  "data": {
    "symbol": "SOLUSDT",
    "lookback_days": 30,
    "beta_full": 1.42,
    "beta_downside": 1.71,
    "sample_count": 720,
    "downside_count": 312,
    "fallback_reason": null
  }
}
```

### 计算口径

- 拉 `symbol` 与 `BTCUSDT` 的 1H K 线，窗口 = `lookback_days` 天
- 按时间戳对齐，丢弃任一侧缺失的 bar
- 计算 1H 简单收益率 `r_t = close_t / close_{t-1} - 1`
- `beta_full`：对全部对齐样本做 OLS（`r_symbol = α + β × r_btc`），返回 β
- `beta_downside`：仅取 `r_btc < 0` 的子集做相同回归，返回 β
- `beta_effective = max(beta_full, beta_downside)` 由调用方在 reduce 时投影，本接口不返回

### Fallback 行为

| 触发条件 | 返回 |
|---|---|
| `sample_count < 500`（lookback 内 K 线不足） | `beta_full=null, fallback_reason="insufficient_samples"` |
| `downside_count < 100` | `beta_downside = beta_full`（不单独算）|
| BTC 收益率方差 ≈ 0（极端低波动） | `fallback_reason="btc_variance_zero"`，调用方应沿用上一日 cache |
| OHLCV 拉取失败 / 数据空洞 | 抛错；调用方按 lazy compute 流程沿用 cache 或返回 `(1.5, 1.5, "no_cache_fallback")` |

### 调用方约定

- 由 `trade-flow` 慢轨入口在 lazy compute 流程中触发，详见 [design-architecture.md §β 缓存与 lazy compute](../../../docs/design-architecture.md)
- 本 skill 不负责落库；调用方拿到结果后写入 `trade.db.beta_cache`
- 同一 UTC 日同一 symbol 应只调用一次，由调用方查 cache 控制

## 运行约束

- 只做本地分析，不连接交易所。
- 需要本机可用的 `go` 命令直接运行源码。
- 默认会执行 catalog 中全部已接入指标
- 默认 `all` 会跳过当前已知依赖未闭合的指标：`supertrend`、`pivots_points`
- 每个指标独立执行并独立容错
- 某个指标失败不会中断整次分析，错误会直接写进返回 JSON 的对应指标节点
- 支撑位、压力位、趋势线和失效位沿用当前仓库自己的计算口径
- 默认参数和指标释义见 `scripts/indicator_catalog.json` 与 `references/indicators.md`
- 如果你要持久化分析结果，由 LLM 自己决定是否落盘
