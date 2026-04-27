---
name: ohlcv-fetch
description: >-
  Fetch Binance USDM perpetual OHLCV data into local files for later analysis.
  Use when the agent needs to pull candles, normalize symbols, and write
  per-timeframe CSV files plus manifest.json for downstream analysis.
---

# OHLCV Fetch

从 Binance USDM 永续抓取 OHLCV，并把结果写成 `CSV + manifest.json`。

## 使用流程

1. 明确 `--symbol`。
2. 进入 skill 目录后直接执行 `./scripts/main.ts --...`。
3. 如需固定目录，显式传 `--output-dir`；未传时脚本会自动创建临时目录。
4. 脚本会把 `manifest.json` 和 `<timeframe>.csv` 落到输出目录，并在 stdout 返回 `{ ok, data }` 包装后的元信息。
5. 需要增量抓取时，传 `--since-ts <毫秒时间戳>`。
6. 需要给下游 `tech-indicators` 用时，优先直接传 `manifest_path`，不要自己再推测 symbol 映射。

## 运行约束

- 只抓 OHLCV，不做技术分析。
- 只支持 Binance USDM 永续。
- 需要本机可用的 `bun`；首次进入 skill 目录请先 `bun install`。
- 公共 K 线接口不需要 API key，无需配置 `BINANCE_API_KEY`。
- 默认周期是 `1w,1d,4h,1h`；需要变更时显式传 `--timeframes`。
- 输出的 CSV 按 `timestamp` 升序，适合直接去重追加。
- 支持性校验基于 USDM `exchangeInfo` 全量列表匹配，不依赖返回结果的第一条记录。

## 关键输入

- `--symbol`: 支持 `ETHUSDT`、`ETH/USDT`、`ETH/USDT:USDT` 这类常见写法
- `--exchange`: 默认 `binance`；只接受 `binance` 或 `binanceusdm`
- `--timeframes`: 逗号分隔周期列表
- `--output-dir`: 可选；manifest 与 CSV 的输出目录
- `--limit`: 可选；未传时按内置默认值抓取
- `--since-ts`: 可选；按 open timestamp 毫秒值增量抓取

## Symbol 口径

- 输入可用 `ETHUSDT`、`ETH/USDT`、`ETH/USDT:USDT`
- 如果输入是斜杠写法，manifest 会规范成 `ETH/USDT:USDT`
- 请求 Binance API 时会使用 `ETHUSDT`

## 校验逻辑

- 脚本会读取 USDM `exchangeInfo` 全量 `symbols` 列表，确认目标 symbol 存在且状态为 `TRADING`。
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
./scripts/main.ts --symbol ETHUSDT
./scripts/main.ts --symbol ETH/USDT
./scripts/main.ts --symbol BTCUSDT --timeframes 1d,4h,1h
```
