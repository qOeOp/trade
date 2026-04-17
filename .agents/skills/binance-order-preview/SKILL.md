---
name: binance-order-preview
description: 生成 Binance 下单预览，不执行真实订单。适合在执行前检查方法归属、关键参数、保护单类型和当前参考价格。
---

# Binance Order Preview

先做预演，再决定是否执行。

## 快速开始

```bash
cd .agents/skills/binance-order-preview
./scripts/main.ts --symbol BTCUSDT --market usdm --side BUY --type LIMIT --quantity 0.01 --price 65000
./scripts/main.ts --symbol ETHUSDT --market usdm --side SELL --type STOP_MARKET --close-position true --stop-price 2400
```

## 使用边界

- 不会发真实订单。
- 负责把参数整理成将要调用的 Binance 方法。
- 会给出当前参考价格与执行建议入口。
- 若识别到是期货保护单，会把执行入口指向 `binance-position-protect`。

## 脚本约定

- 入口源码是 [main.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-order-preview/scripts/main.ts)。
- 当前本 skill 的共享 helper 在 [shared.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-order-preview/scripts/shared.ts)。
- 依赖定义在 [package.json](/Users/vx/WebstormProjects/trade/.agents/skills/binance-order-preview/package.json)。
- 优先直接执行 `./scripts/main.ts`；只有本机首次运行或提示依赖缺失时再执行 `bun install`，不要每次都先装一遍。
- 默认市场是 `usdm`。
- 输出里包含 `request`、`execution`、`marketContext`、`warnings`。
