name: binance-symbol-snapshot
description: 快速读取 Binance 单标的市场快照。适合在不拉全量 OHLCV 的前提下查看 24h 变化、盘口价格、合约 premiumIndex 与 openInterest。
---

# Binance Symbol Snapshot

回答“这个标的现在大概什么状态”，不负责账户、不负责多周期 K 线。

## 快速开始

```bash
cd .agents/skills/binance-symbol-snapshot
./scripts/main.ts --symbol BTCUSDT --market usdm
./scripts/main.ts --symbol ETHUSDT --market spot
```

## 使用边界

- 负责单标的 `24h ticker`。
- 现货额外返回 `bookTicker`。
- 合约额外返回 `premiumIndex` 与 `openInterest`。
- 不负责账户、挂单、历史订单。
- 不负责 OHLCV、技术指标、支撑阻力。

## 脚本约定

- 入口源码是 [main.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-symbol-snapshot/scripts/main.ts)。
- 当前本 skill 的脚本 helper 已内联在 [main.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-symbol-snapshot/scripts/main.ts)。
- 依赖定义在 [package.json](/Users/vx/WebstormProjects/trade/.agents/skills/binance-symbol-snapshot/package.json)。
- 优先直接执行 `./scripts/main.ts`；只有本机首次运行或提示依赖缺失时再执行 `bun install`，不要每次都先装一遍。
- 默认市场是 `usdm`。
- 支持 `--market spot` 与 `--market usdm`。
- 返回 JSON，便于 agent 继续串联 `ohlcv-fetch` 或 `tech-indicators`。
