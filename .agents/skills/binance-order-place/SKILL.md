---
name: binance-order-place
description: EXECUTE 阶段的 Binance 主单执行 skill。用于已收敛 entry plan 后的 USDM 永续开仓或加仓，覆盖立即进场、突破进场、回撤进场;不处理减仓、平仓或保护腿。
---

# Binance Order Place

写操作 skill。服务 `EXECUTE` 场景，不按聊天话术触发。只做 Binance USDM 永续。

## 何时使用

- 当前轮重点已进入 `EXECUTE`，不是继续 `OBSERVE` 或 `PLAN`
- 当前 plan 已明确要做 `开仓` 或 `加仓`
- 目标订单是 `主单`，不是 `保护腿`
- 已能确认 `symbol`、`side`、`quantity`

## 不该使用

- 减仓 / 平仓 / 翻仓
- 止损 / 止盈 / trailing 保护腿
- 当前 plan 还没收敛到可执行，仍需继续补观察或重算风险
- 只是想判断该走哪条 Binance 方法，还没准备真实执行

以下情况先走 `binance-order-preview`：

- 不确定这是主单还是保护腿
- 不确定该用 `LIMIT / MARKET / STOP* / TAKE_PROFIT*` 哪一类
- 想先确认 payload、method、参考价或 warnings

## 最小输入

- `symbol` `side` `type` `quantity`
- 若用户明确指定方向模式，再带 `position-side`
- 若用户明确指定杠杆，再带 `leverage`

- `LIMIT` / `STOP` / `TAKE_PROFIT` 需要 `price`
- `STOP*` / `TAKE_PROFIT*` 需要 `stop-price`
- 真实下单必须显式带 `--yes`

## 场景到订单类型

- 立即进场: `MARKET` / `LIMIT`
- 突破追入: `STOP` / `STOP_MARKET`
- 回撤做多、反弹做空: `TAKE_PROFIT` / `TAKE_PROFIT_MARKET`
- 只关心尽快成交: `MARKET` / `STOP_MARKET` / `TAKE_PROFIT_MARKET`
- 还要控制挂单价或触发后成交价: `LIMIT` / `STOP` / `TAKE_PROFIT`
- `STOP*` / `TAKE_PROFIT*` 在这里可以是主单 entry，不天然等于保护腿
- 只有明显处于保护语境，或需要 `reduceOnly / closePosition` 时，才不该使用本 skill

## 执行顺序

1. 先跑 `./scripts/main.ts --check-env`
2. 若方法归属或参数有歧义，先做 preview
3. 组装最终执行参数
4. 真实下单时显式带 `--yes`
5. 读取脚本返回的 `request / result / confirmedResult`

## 脚本边界

- 入口脚本是 [main.ts](./scripts/main.ts)
- 优先直接执行 `./scripts/main.ts`
- USDM 主单支持 `LIMIT` / `MARKET` / `STOP` / `STOP_MARKET` / `TAKE_PROFIT` / `TAKE_PROFIT_MARKET`
- 脚本会拒绝 reduce-only、减仓、平仓、翻仓这类越界用法
- `--dry-json` 只打印请求体，不触网
- `--test` 可用于 USDM 普通单测试；USDM algo entry 没有官方 test endpoint，只会返回本地校验后的 payload

低频参数、完整命令示例见 [reference.md](./reference.md)。
