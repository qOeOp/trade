---
name: ohlcv-fetch
description: >-
  Fetch Binance OHLCV data into local files for later analysis. Use when
  Codex needs to pull Binance spot/usdm/coinm candles, normalize symbols, and
  write per-timeframe CSV files plus manifest.json for downstream analysis.
---

# OHLCV Fetch

从 Binance 抓取 OHLCV，并直接返回可拼接的 JSON candles。

## 使用流程

1. 明确 `--symbol`、`--market-type`；未指定 `--market-type` 时默认抓合约（`usdm`）。
2. 先运行 `./scripts/build-skills.sh`，再直接执行 `./.agents/skills/ohlcv-fetch/scripts/ohlcv-fetch ...`。
3. CLI 只返回 JSON，不再自动写 `manifest.json` 或 CSV 副本。
4. 如果要给下游分析用，LLM 自己维护本地 CSV/manifest，并按 `timestamp` 做去重追加。
5. 需要增量抓取时，传 `--since-ts <毫秒时间戳>`。

## 运行约束

- 只抓 OHLCV，不做技术分析。
- 仅支持 Binance；不再通过 `ccxt` 代理其它交易所。
- 需要本机可用的 `go` 命令来先构建二进制。
- 默认周期是 `1w,1d,4h,1h`；需要变更时显式传 `--timeframes`。
- 未指定 `--market-type` 时，默认抓合约（`usdm`），不是现货。
- 对 Binance 显式区分 `spot`、`usdm`、`coinm`；如果口径有要求，仍应显式传市场类型。
- 返回结果按 `timestamp` 升序，适合直接追加到 LLM 自己维护的 CSV。

## 关键输入

- `--symbol`: 如 `ETH/USDT`
- `--market-type`: `spot`、`usdm`、`coinm`；默认 `usdm`
- `--exchange`: 默认 `binance`
- `--timeframes`: 逗号分隔周期列表
- `--limit`: 可选；未传时按内置默认值抓取
- `--since-ts`: 可选；按 open timestamp 毫秒值增量抓取

## 输出

CLI 直接返回：

- `columns`
- `dedupe_key`
- 每个 timeframe 的 `candles`
- `first_open_ts` / `last_open_ts`

推荐用 `timestamp` 作为主键去重，再把新行追加进你维护的 CSV。
