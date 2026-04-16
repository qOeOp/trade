---
name: binance-order-preview
description: 生成 Binance 下单预览，不执行真实订单。适合在执行前检查方法归属、关键参数、保护单类型和当前参考价格。
---

# Binance Order Preview

先做预演，再决定是否执行。

## 快速开始

```bash
./scripts/build-skills.sh
./.agents/skills/binance-order-preview/scripts/binance-order-preview --symbol BTCUSDT --market usdm --side BUY --type LIMIT --quantity 0.01 --price 65000
./.agents/skills/binance-order-preview/scripts/binance-order-preview --symbol ETHUSDT --market usdm --side SELL --type STOP_MARKET --close-position true --stop-price 2400
```

## 使用边界

- 不会发真实订单。
- 负责把参数整理成将要调用的 Binance 方法。
- 会给出当前参考价格与执行建议入口。
- 若识别到是期货保护单，会把执行入口指向 `binance-position-protect`。

## CLI 约定

- 入口是 [binance-order-preview](/Users/vx/WebstormProjects/trade/.agents/skills/binance-order-preview/scripts/binance-order-preview)。
- 实现在 [main.ts](/Users/vx/WebstormProjects/trade/cmd/binance-order-preview/main.ts)。
- 默认市场是 `usdm`。
- 输出里包含 `request`、`execution`、`marketContext`、`warnings`。
