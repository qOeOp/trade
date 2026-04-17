---
name: binance-aggtrades-fetch
description: 读取 Binance spot 或 USDM 的 aggTrades。它是底层只读数据 skill，适合给 liquidation-zone、microstructure 或其他高层分析能力提供原始成交材料。
---

# Binance AggTrades Fetch

这是底层原子数据入口，不是默认用户主入口。

## 适用场景

- 需要最近一段聚合逐笔成交做微观结构分析。
- 需要给 liquidation-zone 推断提供原始 trade feed。
- 需要按 `fromId` 或时间窗回补成交材料。

## 快速开始

```bash
cd .agents/skills/binance-aggtrades-fetch
./scripts/main.ts --symbol BTCUSDT --market usdm --limit 500
./scripts/main.ts --symbol ETHUSDT --market spot --start-time 1710000000000 --end-time 1710000600000
```

## 使用边界

- 只读，不需要鉴权。
- 当前只支持 `spot` 和 `usdm`。
- 输出的是原始成交材料的轻度标准化版本，不负责策略解释。
- `takerSide` 只是从 `isBuyerMaker` 推导出的主动方向提示，不等于最终交易结论。

## 脚本约定

- 入口源码是 [main.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-aggtrades-fetch/scripts/main.ts)。
- 当前本 skill 的脚本 helper 已内联在 [main.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-aggtrades-fetch/scripts/main.ts)。
- 依赖定义在 [package.json](/Users/vx/WebstormProjects/trade/.agents/skills/binance-aggtrades-fetch/package.json)。
- 优先直接执行 `./scripts/main.ts`；只有本机首次运行或提示依赖缺失时再执行 `bun install`，不要每次都先装一遍。
- 默认市场是 `usdm`，默认 `limit=500`。
- 支持 `--from-id`、`--start-time`、`--end-time` 做回补。
- 返回 JSON，包含 `request`、`summary`、`trades`。
