---
name: binance-account-snapshot
description: OBSERVE / RECOVERY 阶段的 Binance 账户快照 skill。用于读取余额、持仓、普通挂单、保护单与必要的 symbol 历史订单；不执行交易动作。
---

# Binance Account Snapshot

只读 skill。服务账户事实恢复，不按聊天话术触发。

## 何时使用

- 需要恢复当前账户事实，而不是直接交易
- 需要查看余额、持仓、普通挂单、保护单
- 需要在 `OBSERVE` 或 `RECOVERY` 阶段核对链状态
- 需要按 `symbol` 补历史订单

## 不该使用

- 开仓 / 加仓 / 减仓 / 平仓
- 补保护、撤单、改保护
- 单纯做单标的市场观察，不看账户

执行动作请切到：

- `binance-order-preview`
- `binance-order-place`
- `binance-order-cancel`
- `binance-position-adjust`
- `binance-position-protect`

## 最小输入

- 全账户快照：无额外参数
- 单标的核对：`symbol`
- 只看分区：`--spot-only` 或 `--futures-only`
- 补历史订单：`symbol` + `--include-history`

## 输出重点

- 非零余额
- live 持仓
- 普通挂单
- 保护单
- 分区级错误或缺口

判读口径：

- 普通挂单与保护单会分开整理
- 合约保护单会同时读取普通挂单接口与 Algo 条件单接口
- `BUY STOP_MARKET` 这类 entry 条件单不会只按 `type` 被误归到保护桶
- 若空仓但保护单数量与计划入场总量对齐，应优先视为未来计划仓位保护

## 执行顺序

1. 先跑 `./scripts/main.ts --check-env`
2. 按需要决定全账户、单标的或分区读取
3. 若要补历史订单，显式带 `--symbol --include-history`
4. 优先消费余额、持仓、普通挂单、保护单四块结果
5. 若某分区失败，明确保留缺口，不把整次恢复伪装成完整快照

## 脚本边界

- 入口脚本是 [main.ts](./scripts/main.ts)
- 优先直接执行 `./scripts/main.ts`
- 脚本只返回 JSON
- `--include-history` 必须配合 `--symbol`
- 输出默认隐藏零余额

低频示例和分类细节见 [reference.md](./reference.md)。
