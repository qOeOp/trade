---
name: tech-indicators
description: >-
  Calculate technical analysis from local OHLCV files. Use when Codex needs to
  read manifest-driven OHLCV CSV data, compute selected indicators plus
  support, resistance, trendlines, and invalidation levels, and write
  machine-readable and readable summaries to local files.
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
