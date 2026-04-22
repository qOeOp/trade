---
name: binance-position-adjust
description: EXECUTE 阶段的 Binance USDM 持仓数量调整 skill。用于已有 live position 的部分减仓或全平；不处理主单开仓或保护腿。
---

# Binance Position Adjust

写操作 skill。只处理已有 USDM 仓位的纯数量变化。

## 何时使用

- 当前轮重点已进入 `EXECUTE`
- 已存在明确的 `USDM live position`
- 目标动作只是减仓或全平，不改保护结构
- 已能确认 `symbol`、`position-side`
- 已能确认 `reduce-quantity` 或 `close-position true`

## 不该使用

- 新开仓 / 加仓 / 反手开仓
- 补止损 / 止盈 / trailing 保护腿
- 撤旧保护、重建新保护、核对保护是否匹配余仓
- 只是想预演订单形状，而不是改 live 仓位数量

## 最小输入

- `symbol`
- `position-side`
- `reduce-quantity` 或 `close-position true`

## 动作口径

- 部分减仓：`--reduce-quantity`
- 全平：`--close-position true`
- `LONG` 减仓会落 `SELL MARKET`
- `SHORT` 减仓会落 `BUY MARKET`
- 这个 skill 只改数量，不检查也不调整保护腿

## 执行顺序

1. 先跑 `./scripts/main.ts --check-env`
2. 先跑一次 `--plan`
3. 确认 live 仓位、方向、目标减仓数量一致
4. 确认这次动作只是减仓 / 全平
5. 真实执行必须显式带 `--yes`

## 脚本边界

- 入口脚本是 [main.ts](./scripts/main.ts)
- 优先先执行 `--plan`，再决定是否 `--yes`
- `--plan` 只读，不改状态
- live 执行后会回读持仓，确认余仓数量或归零结果

低频示例见 [reference.md](./reference.md)。
