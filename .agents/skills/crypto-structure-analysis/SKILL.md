name: crypto-structure-analysis
description: >-
  Use when the user wants real crypto multi-timeframe market structure
  analysis from exchange data, including support levels, resistance levels,
  active trendlines, and invalidation conditions. This skill fetches OHLCV
  via CCXT and generates JSON and markdown summaries. Trigger phrases include:
  多周期分析, 支撑压力, 趋势线, support resistance, trendline, market structure.
---

# Crypto Structure Analysis

这个 skill 用真实交易所 OHLCV 数据，对任意加密交易对做多周期结构分析。

默认分析周期：

- `1w`
- `1d`
- `4h`
- `1h`

输出内容：

- 每个周期的趋势判断
- 支撑位与压力位
- 活跃趋势线
- 多头 / 空头失效条件
- JSON 与 Markdown 摘要

## 安装

先进入 skill 目录，再安装依赖：

```bash
cd .agents/skills/crypto-structure-analysis
python3 -m pip install -r requirements.txt
```

## 用法

运行时应由 agent 根据用户上下文显式传入 `--symbol` 和 `--output-dir`。

`--output-dir` 不由脚本内部管理。
应由大模型先在项目根目录下创建本次记录目录，再把目录路径传给脚本。

示例：

```bash
cd .agents/skills/crypto-structure-analysis
python3 analyze.py --symbol ETH/USDT --exchange binance --timeframes 1w,1d,4h,1h --output-dir /Users/vx/WebstormProjects/trade/data/runs/20260406-eth-structure
```

## 输出目录

脚本会写入传入的 `--output-dir`：

- `analysis.json`
- `summary.md`

## 说明

- 默认使用 `Binance` 的公开市场数据，不需要 API key
- `symbol` 应由大模型根据用户当前分析对象传入，而不是固定写成 BTC
- `output-dir` 应由大模型在项目根目录下统一管理后传入
- 这是结构分析工具，不会下单
- 支撑压力位和趋势线都来自脚本计算，不是模型臆测
