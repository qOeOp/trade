---
name: binance-symbol-snapshot
description: OBSERVE 阶段的 Binance 单标的快照 skill。用于在不拉全量 OHLCV 的前提下查看 24h 变化、盘口价格、premiumIndex 与 openInterest。
---

# Binance Symbol Snapshot

只读 skill。回答“这个标的现在大概什么状态”，不负责账户或多周期 K 线。

## 何时使用

- 当前轮处于 `OBSERVE`
- 已确定 symbol，但还不需要全量 OHLCV
- 需要先看 24h、盘口、funding、OI 等即时快照

## 不该使用

- 账户恢复
- 挂单 / 历史订单读取
- OHLCV、技术指标、支撑阻力分析

## 脚本边界

- 负责单标的 `24h ticker`
- 现货额外返回 `bookTicker`
- 合约额外返回 `premiumIndex` 与 `openInterest`
- 返回 `priceSnapshot`，区分 `tradePrice / markPrice / indexPrice / bestBid / bestAsk`
- 默认市场是 `usdm`
- 返回 JSON，便于继续串联 `ohlcv-fetch` 或 `tech-indicators`
