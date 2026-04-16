name: binance-symbol-snapshot
description: 快速读取 Binance 单标的市场快照。适合在不拉全量 OHLCV 的前提下查看 24h 变化、盘口价格、合约 premiumIndex 与 openInterest。
---

# Binance Symbol Snapshot

回答“这个标的现在大概什么状态”，不负责账户、不负责多周期 K 线。

## 快速开始

```bash
./scripts/build-skills.sh
./.agents/skills/binance-symbol-snapshot/scripts/binance-symbol-snapshot --symbol BTCUSDT --market usdm
./.agents/skills/binance-symbol-snapshot/scripts/binance-symbol-snapshot --symbol ETHUSDT --market spot
```

## 使用边界

- 负责单标的 `24h ticker`。
- 现货额外返回 `bookTicker`。
- 合约额外返回 `premiumIndex` 与 `openInterest`。
- 不负责账户、挂单、历史订单。
- 不负责 OHLCV、技术指标、支撑阻力。

## CLI 约定

- 入口是 [binance-symbol-snapshot](/Users/vx/WebstormProjects/trade/.agents/skills/binance-symbol-snapshot/scripts/binance-symbol-snapshot)。
- 实现在 [main.ts](/Users/vx/WebstormProjects/trade/cmd/binance-symbol-snapshot/main.ts)。
- 默认市场是 `usdm`。
- 支持 `--market spot` 与 `--market usdm`。
- 返回 JSON，便于 agent 继续串联 `ohlcv-fetch` 或 `tech-indicators`。
