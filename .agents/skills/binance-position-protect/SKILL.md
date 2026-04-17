---
name: binance-position-protect
description: 为 Binance USDM 持仓补止损、止盈或追踪止损。适合已有仓位但保护结构不完整、方向错位或需要重建 TP/SL 的场景。
---

# Binance Position Protect

这是写操作 skill，专门处理期货保护单。

## 快速开始

```bash
cd .agents/skills/binance-position-protect
./scripts/main.ts --symbol BTCUSDT --position-side LONG --quantity 0.01 --stop-loss-trigger 64000 --take-profit-trigger 68000 --yes
./scripts/main.ts --symbol BTCUSDT --position-side SHORT --close-position true --stop-loss-trigger 69000 --yes
```

## 使用边界

- 会修改真实 Binance 状态。
- 当前只做 USDM 保护单，不负责标准开仓。
- 支持补：
  - `STOP` / `STOP_MARKET`
  - `TAKE_PROFIT` / `TAKE_PROFIT_MARKET`
  - `TRAILING_STOP_MARKET`
- 没有保护单之前，优先先用 `binance-account-snapshot` 确认现有仓位与挂单。

## 脚本约定

- 入口源码是 [main.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-position-protect/scripts/main.ts)。
- 当前本 skill 的共享 helper 在 [shared.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-position-protect/scripts/shared.ts)。
- 依赖定义在 [package.json](/Users/vx/WebstormProjects/trade/.agents/skills/binance-position-protect/package.json)。
- 优先直接执行 `./scripts/main.ts`；只有本机首次运行或提示依赖缺失时再执行 `bun install`，不要每次都先装一遍。
- 必须显式带 `--yes`。
- `--close-position true` 时可以不传 `--quantity`；否则需要显式数量。
- `--position-side LONG` 会默认推断保护方向为 `SELL`，`SHORT` 会推断为 `BUY`。
