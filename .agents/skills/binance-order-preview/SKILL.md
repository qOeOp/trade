---
name: binance-order-preview
description: PLAN / EXECUTE 之间的 Binance 下单预演 skill。用于确认方法归属、关键参数、主单或保护腿分类、参考价与 warnings；不执行真实订单。
---

# Binance Order Preview

只读 skill。服务订单路由与参数收敛，不发真实订单。

## 何时使用

- 当前 plan 已接近可执行，但方法归属仍不稳
- 需要确认这张单最终会走哪条 Binance 方法
- 需要判断 `STOP*` / `TAKE_PROFIT*` 是主单还是保护腿
- 需要检查参数是否齐全、参考价是否合理
- 需要拿到结构化 `request / execution / marketContext / warnings`

## 不该使用

- 真实下单
- 已有仓位的纯减仓 / 全平
- 账户快照恢复

## 最小输入

- 必填：`symbol` `market` `side` `type`
- 三选一：`quantity` / `quote-order-qty` / `close-position true`
- `LIMIT` / `STOP` / `TAKE_PROFIT` 需要 `price`
- `STOP*` / `TAKE_PROFIT*` 需要 `stop-price`
- `TRAILING_STOP_MARKET` 需要 `activation-price` 或 `stop-price`，以及 `callback-rate`

## 路由口径

- 现货支持：`LIMIT` / `MARKET` / `LIMIT_MAKER`
- USDM 主单支持：`LIMIT` / `MARKET` / `STOP` / `STOP_MARKET` / `TAKE_PROFIT` / `TAKE_PROFIT_MARKET`
- USDM 保护腿支持：`STOP` / `STOP_MARKET` / `TAKE_PROFIT` / `TAKE_PROFIT_MARKET` / `TRAILING_STOP_MARKET`
- `STOP*` / `TAKE_PROFIT*` 不天然等于保护腿
- 只要是 USDM 的 `STOP*` / `TAKE_PROFIT*` / `TRAILING_STOP_MARKET`，当前预演口径都会走 `futuresCreateAlgoOrder`
- `reduceOnly=true` 或 `closePosition=true` 时，才会优先归到 `binance-position-protect`
- 否则仍优先归到 `binance-order-place`

## 怎么用结果

- 想确认主单形状是否正确：看 `execution`
- 不确定是 entry 还是保护：重点看 `execution.skill`
- 想评估触发条件离当前价格是否太近：看 `marketContext` 和 `warnings`
- 做后续 agent 编排：直接消费输出，不要自己重写分类规则

## 执行顺序

1. 明确订单意图和目标参数
2. 若是 USDM 条件单，显式带上 `position-side`、`reduce-only`、`close-position`
3. 若是 trailing，成对传 `activation-price` 与 `callback-rate`
4. 运行 `./scripts/main.ts`
5. 消费 `request / execution / marketContext / warnings`

## 脚本边界

- 入口脚本是 [main.ts](./scripts/main.ts)
- 优先直接执行 `./scripts/main.ts`
- 默认市场是 `usdm`
- 输出包含 `request`、`execution`、`marketContext`、`warnings`

低频示例见 [reference.md](./reference.md)。
