---
name: binance-symbol-snapshot
description: OBSERVE 阶段的 Binance 单标的快照 skill。用于在不拉全量 OHLCV 的前提下查看 24h 变化、盘口价格、premiumIndex、fundingRate 与 openInterest，并可选补轻量多周期 K 线快照。
---

# Binance Symbol Snapshot

只读 skill。回答“这个标的现在大概什么状态”，支持轻量临盘快照，但不负责账户或重型 OHLCV 落盘。

## 何时使用

- 当前轮处于 `OBSERVE`
- 已确定 symbol，但还不需要全量 OHLCV
- 需要先看 24h、盘口、funding、OI 等即时快照
- 需要快速补几组 `15m/1h/4h` 最近 K 线，而不想走 `ohlcv-fetch -> manifest`

## 不该使用

- 账户恢复
- 挂单 / 历史订单读取
- 大窗口 OHLCV、技术指标、支撑阻力分析

## 脚本边界

- 只支持 USDM 永续，不暴露 market 参数
- 负责单标的 `24h ticker`、`premiumIndex`、最近 fundingRate 历史与 `openInterest`
- 返回 `priceSnapshot`，区分 `tradePrice / markPrice / indexPrice / bestBid / bestAsk`
- 可选返回 `recentKlines`
- 默认带最近 `5` 条 fundingRate 历史
- `--pulse` 适合快速看盘，默认补 `15m,1h,4h` 最近 K 线
- 返回 JSON，便于继续串联 `ohlcv-fetch` 或 `tech-indicators`

## 常用参数

- `--symbol BTCUSDT`
- `--funding-limit 5`
- `--recent-klines 15m,1h,4h`
- `--recent-kline-limit 16`
- `--pulse`

## 示例

```bash
cd .agents/skills/binance-symbol-snapshot
./scripts/main.ts --symbol BTCUSDT
./scripts/main.ts --symbol BTCUSDT --pulse
./scripts/main.ts --symbol BTCUSDT --recent-klines 15m,1h,4h --recent-kline-limit 12
./scripts/main.ts --symbol ETHUSDT --funding-limit 8
```
