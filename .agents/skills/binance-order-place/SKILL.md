---
name: binance-order-place
description: 执行 Binance 真实下单。当前只负责较窄的现货/USDM 标准开仓入口，适合 `LIMIT` / `MARKET` 类进场单。
---

# Binance Order Place

这是写操作 skill。默认先预览，再执行。

## 快速开始

```bash
./scripts/build-skills.sh
./.agents/skills/binance-order-place/scripts/binance-order-place --check-env
./.agents/skills/binance-order-place/scripts/binance-order-place --symbol BTCUSDT --market usdm --side BUY --type LIMIT --quantity 0.01 --price 65000 --yes
```

## 使用边界

- 会修改真实 Binance 状态。
- 执行前优先先跑 `binance-order-preview`。
- 当前只收窄到标准开仓入口：
  - 现货：`LIMIT` / `MARKET` / `LIMIT_MAKER`
  - USDM：`LIMIT` / `MARKET`
- TP/SL、追踪止损等保护单不要走这里，切到 `binance-position-protect`。

## CLI 约定

- 入口是 [binance-order-place](/Users/vx/WebstormProjects/trade/.agents/skills/binance-order-place/scripts/binance-order-place)。
- 实现在 [main.ts](/Users/vx/WebstormProjects/trade/cmd/binance-order-place/main.ts)。
- 真实下单必须显式带 `--yes`。
- 现货支持 `--test` 走 `orderTest`。
