---
name: binance-order-cancel
description: EXECUTE 阶段的 Binance 撤单 skill。用于撤销 USDM 的普通单与 Algo 条件单，支持单笔或整组取消。
---

# Binance Order Cancel

写操作 skill。负责撤单，不负责重挂。

## 何时使用

- 当前轮重点已进入 `EXECUTE`
- 已明确要取消现有挂单
- 已能确认 `symbol` 和取消目标

## 不该使用

- 重建订单结构
- 补保护或重新开单
- 账户快照恢复

## 最小输入

- `symbol`
- `--all` 或具体标识符
- 标识符可为 `--order-id` / `--orig-client-order-id` / `--algo-id` / `--client-algo-id`
- 真实撤单必须显式带 `--yes`

## 脚本边界

- 入口脚本是 [main.ts](./scripts/main.ts)
- 优先直接执行 `./scripts/main.ts`
- 只支持 USDM
- 支持普通单取消、全部普通单取消、Algo 单取消、全部 Algo 单取消
