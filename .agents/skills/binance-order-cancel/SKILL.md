---
name: binance-order-cancel
description: 撤销 Binance 现货或 USDM 挂单。支持普通订单和期货 Algo 条件单的单笔或整组取消。
---

# Binance Order Cancel

这是写操作 skill，负责撤单，不负责重挂。

## 快速开始

```bash
cd .agents/skills/binance-order-cancel
./scripts/main.ts --symbol BTCUSDT --market usdm --order-id 123456 --yes
./scripts/main.ts --symbol BTCUSDT --market usdm --algo --all --yes
```

## 使用边界

- 会修改真实 Binance 状态。
- 支持普通单取消、全部普通单取消、期货 Algo 单取消、全部 Algo 单取消。
- 不负责重建订单结构；如果取消后要补保护或重新开单，切到对应 skill。

## 脚本约定

- 入口源码是 [main.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-order-cancel/scripts/main.ts)。
- 当前本 skill 的脚本 helper 已内联在 [main.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-order-cancel/scripts/main.ts)。
- 依赖定义在 [package.json](/Users/vx/WebstormProjects/trade/.agents/skills/binance-order-cancel/package.json)。
- 优先直接执行 `./scripts/main.ts`；只有本机首次运行或提示依赖缺失时再执行 `bun install`，不要每次都先装一遍。
- 必须显式带 `--yes`。
- 需要 `--all` 或具体标识符，例如 `--order-id`、`--orig-client-order-id`、`--algo-id`、`--client-algo-id`。
