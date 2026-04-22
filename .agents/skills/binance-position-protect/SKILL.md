---
name: binance-position-protect
description: EXECUTE 阶段的 Binance USDM 保护腿 skill。用于为已有仓位或计划仓位补止损、止盈或 trailing；不处理主单开仓、减仓或撤单。
---

# Binance Position Protect

写操作 skill。专门处理 USDM 保护腿。

## 何时使用

- 当前轮重点已进入 `EXECUTE`
- 目标动作是补 `保护腿`，不是主单或减仓
- 标的是 `USDM`
- 保护目标属于止损、止盈或 trailing
- 已能确认 `symbol`、`position-side`
- 已能确认 `quantity` 或 `close-position true`

## 不该使用

- 主单开仓 / 加仓
- 已有仓位的部分减仓 / 全平
- 撤单
- 自动判断并清理旧保护单

## 最小输入

- 必填：`symbol` `position-side`
- 二选一：`quantity` 或 `close-position true`
- `BOTH` 模式下额外需要 `side`
- 止损：`stop-loss-trigger`
- 止盈：`take-profit-trigger`
- trailing：`trailing-activation-price` + `callback-rate`

## 保护模型

- 当前 live 仓位保护：可用 `close-position true` 或显式 `quantity`
- 未来计划仓位保护：必须显式 `quantity`，不要用 `close-position true`
- `LONG` 保护腿默认是 `SELL`
- `SHORT` 保护腿默认是 `BUY`
- `BOTH` 模式下必须手动传 `side`
- 本 skill 只新增保护腿，不会自动撤旧保护或去重

## 订单选择

- 只关心触发后尽快退出：`STOP_MARKET` / `TAKE_PROFIT_MARKET`
- 想控制触发后成交价格：`STOP` / `TAKE_PROFIT`，并显式带 limit price
- 想让止损跟着利润移动：`TRAILING_STOP_MARKET`

## 执行顺序

1. 先跑 `./scripts/main.ts --check-env`
2. 确认这次动作是补保护腿，不是主单或减仓
3. 确认 `close-position true` 与 `quantity` 的选择符合当前保护模型
4. 若是 trailing，必须同时带 `--trailing-activation-price` 和 `--callback-rate`
5. 真实执行必须显式带 `--yes`

## 脚本边界

- 入口脚本是 [main.ts](./scripts/main.ts)
- 优先直接执行 `./scripts/main.ts`
- `--close-position true` 时可以不传 `--quantity`
- live 路径会先核对保护方向和数量是否与现有仓位匹配
- 支持 `--dry-json` 打印最终保护腿请求体，不触网

低频示例见 [reference.md](./reference.md)。
