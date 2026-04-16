---
name: binance-order-cancel
description: 撤销 Binance 现货或 USDM 挂单。支持普通订单和期货 Algo 条件单的单笔或整组取消。
---

# Binance Order Cancel

这是写操作 skill，负责撤单，不负责重挂。

## 快速开始

```bash
./scripts/build-skills.sh
./.agents/skills/binance-order-cancel/scripts/binance-order-cancel --symbol BTCUSDT --market usdm --order-id 123456 --yes
./.agents/skills/binance-order-cancel/scripts/binance-order-cancel --symbol BTCUSDT --market usdm --algo --all --yes
```

## 使用边界

- 会修改真实 Binance 状态。
- 支持普通单取消、全部普通单取消、期货 Algo 单取消、全部 Algo 单取消。
- 不负责重建订单结构；如果取消后要补保护或重新开单，切到对应 skill。

## CLI 约定

- 入口是 [binance-order-cancel](/Users/vx/WebstormProjects/trade/.agents/skills/binance-order-cancel/scripts/binance-order-cancel)。
- 实现在 [main.ts](/Users/vx/WebstormProjects/trade/cmd/binance-order-cancel/main.ts)。
- 必须显式带 `--yes`。
- 需要 `--all` 或具体标识符，例如 `--order-id`、`--orig-client-order-id`、`--algo-id`、`--client-algo-id`。
