---
name: ohlcv-fetch
description: >-
  Use when the user needs exchange OHLCV data fetched into local files for
  later analysis. This skill uses CCXT to fetch crypto candle data and writes
  per-timeframe CSV files plus a manifest.json.
---

# OHLCV Fetch

这个 skill 只负责从交易所抓取 OHLCV，并写到本地文件。

不做：

- 技术指标计算
- 支撑压力判断
- 趋势线判断

## 默认周期

- `1w`
- `1d`
- `4h`
- `1h`

## 安装

```bash
cd .agents/skills/ohlcv-fetch
python3 -m pip install -r requirements.txt
```

## 用法

运行时应由 agent 显式传入：

- `--symbol`
- `--output-dir`

`--output-dir` 可以由 agent 基于当前工作区路径、环境变量或运行上下文先拼好。

示例：

```bash
cd .agents/skills/ohlcv-fetch
export RUN_ROOT=../../data/runs
python3 fetch.py --symbol ETH/USDT --exchange binance --timeframes 1w,1d,4h,1h --output-dir "$RUN_ROOT/20260406-eth-ohlcv"
```

## 输出

脚本会写入传入的 `--output-dir`：

- `manifest.json`
- `1w.csv`
- `1d.csv`
- `4h.csv`
- `1h.csv`

## 说明

- 默认使用公开市场数据，不需要 API key
- `symbol` 和 `output-dir` 都由大模型决定并传入
- 路径可以使用环境变量或 agent 拼好的相对路径
- `manifest.json` 中保存的是相对文件路径，便于迁移和复用
- 下游的 `tech-indicators` 应读取这里产出的 `manifest.json`
