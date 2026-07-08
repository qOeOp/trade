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
- 默认剔除尚未闭合的 K 线；manifest 固定 `closed_candles_only=true`。
- 支持性校验基于 USDM `exchangeInfo` 全量列表匹配，不依赖返回结果的第一条记录。

## 关键输入

- `--symbol`: 支持 `ETHUSDT`、`ETH/USDT`、`ETH/USDT:USDT` 这类常见写法
- `--exchange`: 默认 `binance`；只接受 `binance` 或 `binanceusdm`
- `--timeframes`: 逗号分隔周期列表
- `--output-dir`: 可选；manifest 与 CSV 的输出目录
- `--limit`: 可选；未传时按内置默认值抓取；超过 1500 时分页
- `--since-ts`: 可选；按 open timestamp 毫秒值增量抓取

超过 Binance 单请求上限 1500 根时必须同时提供 `--since-ts`。分页从该时间向前推进，按 open timestamp 去重并升序输出；无更多数据时提前停止。

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
- `schema_version=2`、Binance USDM source identity、每个 timeframe 的 `content_sha256`

推荐直接把 `manifest_path` 传给下游 `tech-indicators`。

## 示例

```bash
cd .agents/skills/ohlcv-fetch
./scripts/main.ts --symbol ETHUSDT
./scripts/main.ts --symbol ETH/USDT
./scripts/main.ts --symbol BTCUSDT --timeframes 1d,4h,1h
```

## Calibration panel

`calibration-panel.ts` 用来重复生成 trade-flow `--strategy-calibration-suite` 输入；它只编排 OHLCV 拉取与 manifest 汇总，不做策略判断。

```bash
./scripts/calibration-panel.ts --output-root ./data/calibration-panel --timeframe 4h --since-ts 1609459200000 --limit 12000
```

- 默认 symbol universe 为 20 个 USDM 主流合约。
- 输出 `panel-manifest.json` 与 `calibration-suite-input.json`。
- 若传 `--funding-report-root`，会按 `<root>/<symbol>/market-features.json` 等路径自动挂入 `indicator_report_path`。
- 支持 `--dry-run` 只生成路径与 suite input，不连接 Binance。

`calibration-market-features.ts` 读取 `panel-manifest.json`，逐 symbol 生成 tech-indicators `--feature-series` base report，再调用 `market-features.ts` 补 exact funding events，输出 `calibration-suite-input-with-funding.json`。

```bash
./scripts/calibration-market-features.ts --panel-manifest ./data/calibration-panel/panel-manifest.json --output-root ./data/calibration-market-features --external false
```

- 输出的 suite input 可直接传给 `trade-flow --strategy-calibration-suite --json ...`。
- 默认只补 Binance/Vision 可得数据；Deribit/BRK 外部源需显式 `--external true`。

## 加密原生特征

`market-features.ts` 以 `tech-indicators --feature-series` 报告的时间网格为基准，因果对齐 Binance / Deribit / BRK 数据；输出仍是可直接交给 R&D 的 factor report。

```bash
./scripts/market-features.ts --symbol BTCUSDT --timeframe 4h --since-ts 1609459200000 --base-report /tmp/factors.json
./scripts/market-features.ts --symbol BTCUSDT --timeframe 4h --since-ts 1704067200000 --base-report /tmp/factors.json --microstructure-days 1
```

- funding / premium 走 REST 长历史；原始 funding events 写入 report，供 replay 精确结算。
- OI / taker ratio 默认从 Binance Vision 每日 metrics 恢复长历史；`--metrics-source rest` 才退回近 30 天。
- `--microstructure-days 1..7` 从 Vision 临时读取 aggTrades 与 ±1% bookDepth，聚合 orderflow / concentration / depth 后立即释放原始 ZIP；默认不抓。
- BTC / ETH 接 Deribit DVOL；BTC 接 BRK `MVRV / SOPR-24h / active-addresses-24h-average`。外部源失败写入 `external_errors`，不拖垮 Binance 主链。
- 每个 Vision ZIP 都校验官方 SHA-256；长期只保存 factor report，不保留原始归档。
- 完整 L2 queue、真实 liquidation label、带地址标签的 CEX netflow、完整历史期权曲面仍标为 capability gap，不做推测填充。
