---
name: ohlcv-fetch
description: >-
  Fetch exchange OHLCV data into local files for later analysis. Use when
  Codex needs to pull crypto candle data from an exchange, normalize Binance
  spot/usdm/coinm symbols, and write per-timeframe CSV files plus manifest.json
  for downstream analysis.
---

# OHLCV Fetch

从交易所抓取 OHLCV 并写入本地目录。

## 使用流程

1. 明确 `--symbol`、`--market-type`、`--output-dir`；未指定 `--market-type` 时默认抓合约（`usdm`）。
2. 缺依赖时，执行 `python3 -m pip install -r scripts/requirements.txt`。
3. 运行 `python3 scripts/fetch.py ...`。
4. 把输出目录里的 `manifest.json` 交给下游分析 skill。

## 运行约束

- 只抓 OHLCV，不做技术分析。
- 默认周期是 `1w,1d,4h,1h`；需要变更时显式传 `--timeframes`。
- 未指定 `--market-type` 时，默认抓合约（`usdm`），不是现货。
- 对 Binance 显式区分 `spot`、`usdm`、`coinm`；如果口径有要求，仍应显式传市场类型。
- 由当前工作区或显式参数决定 `--output-dir`，不要写死仓库外路径。

## 关键输入

- `--symbol`: 如 `ETH/USDT`
- `--market-type`: `spot`、`usdm`、`coinm`；默认 `usdm`
- `--output-dir`: 目标目录
- `--exchange`: 默认 `binance`
- `--timeframes`: 逗号分隔周期列表
- `--limit`: 可选；未传时按内置默认值抓取

## 输出

脚本会写入：

- `manifest.json`
- `<timeframe>.csv`

`manifest.json` 会记录请求值、解析后的 `exchange`/`symbol`、生成时间和各周期文件信息。
