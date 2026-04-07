---
name: tech-indicators
description: >-
  Calculate technical analysis from local OHLCV files. Use when Codex needs to
  read manifest-driven OHLCV CSV data, compute selected indicators plus
  support, resistance, trendlines, and invalidation levels, and write
  machine-readable and readable summaries to local files.
---

# Tech Indicators

读取本地 OHLCV 数据并输出技术分析结果。

## 使用流程

1. 接收 `ohlcv-fetch` 产出的 `manifest.json`。
2. 缺依赖时，执行 `python3 -m pip install -r scripts/requirements.txt`。
3. 运行 `./scripts/run.sh --manifest ... --output-dir ...`。
4. 需要缩小范围时，显式传 `--indicators` 或 `--indicator-config`。
5. 需要解释指标含义时，读取 `references/indicators.md`。

## 输入要求

- 输入来源是 `ohlcv-fetch` 产出的 `manifest.json`。
- 每个 CSV 至少包含 `date`、`open`、`high`、`low`、`close`、`volume`。
- `manifest.json` 中的相对路径按 manifest 所在目录解析。

## 输出

脚本会写入：

- `analysis.json`
- `summary.md`
- `selected-indicators.json`

## 运行约束

- 只做本地分析，不连接交易所。
- 默认会执行 catalog 中全部已接入指标
- 默认 `all` 会跳过当前已知依赖未闭合的指标：`supertrend`、`pivots_points`
- 每个指标独立执行并独立容错
- 某个指标失败不会中断整次分析，错误会写进 `analysis.json`
- 支撑位、压力位、趋势线和失效位沿用当前仓库自己的计算口径
- 默认参数和指标释义见 `scripts/indicator_catalog.json` 与 `references/indicators.md`
