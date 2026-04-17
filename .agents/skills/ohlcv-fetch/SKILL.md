---
name: ohlcv-fetch
description: >-
  Fetch Binance OHLCV data into local files for later analysis. Use when
  Codex needs to pull Binance spot/usdm/coinm candles, normalize symbols, and
  write per-timeframe CSV files plus manifest.json for downstream analysis.
---

# OHLCV Fetch

从 Binance 抓取 OHLCV，并把结果写成 `CSV + manifest.json`。

## 使用流程

1. 明确 `--symbol`、`--market-type`；未指定 `--market-type` 时默认抓合约（`usdm`）。
2. 进入 skill 目录后直接执行 `go run ./scripts --...`。
3. 如需固定目录，显式传 `--output-dir`；未传时脚本会自动创建临时目录。
4. 脚本会把 `manifest.json` 和 `<timeframe>.csv` 落到输出目录，并在 stdout 返回 `{ ok, data }` 包装后的元信息。
5. 需要增量抓取时，传 `--since-ts <毫秒时间戳>`。
6. 需要给下游 `tech-indicators` 用时，优先直接传 `manifest_path`，不要自己再推测 symbol 映射。

## 运行约束

- 只抓 OHLCV，不做技术分析。
- 仅支持 Binance；不再通过 `ccxt` 代理其它交易所。
- 需要本机可用的 `go` 命令直接运行源码。
- 默认周期是 `1w,1d,4h,1h`；需要变更时显式传 `--timeframes`。
- 未指定 `--market-type` 时，默认抓合约（`usdm`），不是现货。
- 对 Binance 显式区分 `spot`、`usdm`、`coinm`；如果口径有要求，仍应显式传市场类型。
- `spot`、`usdm`、`coinm` 的 symbol 规范化规则不同，不要假设同一个 symbol 字符串能在三种市场里通用。
- 输出的 CSV 按 `timestamp` 升序，适合直接去重追加。
- 支持性校验基于对应市场的完整 `exchangeInfo` 列表匹配，不依赖返回结果的第一条记录。

## 关键输入

- `--symbol`: 支持 `ETHUSDT`、`ETH/USDT`、`ETH/USDT:USDT` 这类常见写法；会按市场类型规范化
- `--market-type`: `spot`、`usdm`、`coinm`；默认 `usdm`
- `--exchange`: 默认 `binance`
- `--timeframes`: 逗号分隔周期列表
- `--output-dir`: 可选；manifest 与 CSV 的输出目录
- `--limit`: 可选；未传时按内置默认值抓取
- `--since-ts`: 可选；按 open timestamp 毫秒值增量抓取

## Symbol 口径

- `spot`
  输入可用 `ETHUSDT` 或 `ETH/USDT`
  manifest 中保持现货口径，如 `ETH/USDT` 或直接输入的 `ETHUSDT`
- `usdm`
  输入可用 `ETHUSDT`、`ETH/USDT`、`ETH/USDT:USDT`
  如果输入是斜杠写法，manifest 会规范成 `ETH/USDT:USDT`
  请求 Binance API 时会使用 `ETHUSDT`
- `coinm`
  输入可用 `BTCUSD_PERP`、`BTC/USD`、`BTC/USD:BTC`
  如果输入是斜杠写法，manifest 会规范成 `BTC/USD:BTC`
  请求 Binance API 时会使用 `BTCUSD_PERP`

## 校验逻辑

- 脚本会先根据 `market-type` 选对 Binance endpoint，再独立解析 symbol，而不是把两者混在一起猜。
- 支持性校验会读取对应市场的完整 `exchangeInfo`，在 `symbols` 列表里查找目标 symbol。
- 如果 symbol 存在但状态不是 `TRADING`，会直接报“symbol not tradable”，而不是继续抓 K 线。
- 如果 symbol 根本不存在，才会报“does not support symbol”。
- 因此像 `ETHUSDT`、`TRXUSDT`、`NEARUSDT` 这类不在列表第一位的合约，也能被正确识别。

## 输出

脚本会写入：

- `manifest.json`
- `<timeframe>.csv`

stdout 会返回 `{ ok, data }`，其中包含：

- `output_dir`
- `manifest_path`
- `columns`
- `dedupe_key`
- 每个 timeframe 的 `file` / `rows` / `first_open_ts` / `last_open_ts`

推荐直接把 `manifest_path` 传给下游 `tech-indicators`。

## 示例

```bash
cd .agents/skills/ohlcv-fetch
go run ./scripts --symbol ETHUSDT --market-type usdm
go run ./scripts --symbol ETH/USDT --market-type usdm
go run ./scripts --symbol SOL/USDT --market-type spot
go run ./scripts --symbol BTC/USD --market-type coinm
```
