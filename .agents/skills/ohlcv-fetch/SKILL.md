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

1. 明确 `--symbol`、`--market-type`；未指定 `--market-type` 时默认抓合约（`usdm`）。
2. 直接运行 `./scripts/run.sh ...`；需要自定义落盘位置时再显式传 `--output-dir`。
3. `run.sh` 会自动在当前项目根目录下创建并复用 `.cache/skills/ohlcv-fetch/.venv`，并固定使用 Python 3.9+。
4. 未传 `--output-dir` 时，默认写入当前项目根目录下 `tmp/market/<symbol>-<market-type>/`。
5. 把输出目录里的 `manifest.json` 交给下游分析 skill。

## 运行约束

- 只抓 OHLCV，不做技术分析。
- 仅支持 Python 3.9+；检测到其他版本时直接报错。
- 默认周期是 `1w,1d,4h,1h`；需要变更时显式传 `--timeframes`。
- 未指定 `--market-type` 时，默认抓合约（`usdm`），不是现货。
- 对 Binance 显式区分 `spot`、`usdm`、`coinm`；如果口径有要求，仍应显式传市场类型。
- 默认输出与虚拟环境都落在当前项目根目录，不要写入 skill 自己的源码目录。
- 需要保留多份结果时，再显式传 `--output-dir`。

## 关键输入

- `--symbol`: 如 `ETH/USDT`
- `--market-type`: `spot`、`usdm`、`coinm`；默认 `usdm`
- `--output-dir`: 可选；未传时默认落到项目根目录下 `tmp/market/<symbol>-<market-type>/`
- `--exchange`: 默认 `binance`
- `--timeframes`: 逗号分隔周期列表
- `--limit`: 可选；未传时按内置默认值抓取

## 输出

脚本会写入：

- `manifest.json`
- `<timeframe>.csv`

`manifest.json` 会记录请求值、解析后的 `exchange`/`symbol`、生成时间和各周期文件信息。
