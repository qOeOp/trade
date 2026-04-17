---
name: binance-market-scan
description: 扫描 Binance 公共市场数据，生成全市场 long / short 候选列表。适合回答“全市场还有什么能做”“帮我先筛几个标的”。
---

# Binance Market Scan

回答“先看谁”，不负责深判，不负责账户。

## 快速开始

```bash
cd .agents/skills/binance-market-scan
./scripts/main.ts
./scripts/main.ts --direction long
./scripts/main.ts --market spot --limit 8
```

## 使用边界

- 负责全市场候选生成、流动性筛选、24h 涨跌与成交额排序。
- 默认输出 `long` / `short` 两边候选。
- 不负责账户、持仓、挂单。
- 不负责单标的结构判断。
- 常见串联是：`binance-market-scan -> ohlcv-fetch -> tech-indicators`。

## 脚本约定

- 入口源码是 [main.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-market-scan/scripts/main.ts)。
- 当前本 skill 的共享 helper 在 [shared.ts](/Users/vx/WebstormProjects/trade/.agents/skills/binance-market-scan/scripts/shared.ts)。
- 依赖定义在 [package.json](/Users/vx/WebstormProjects/trade/.agents/skills/binance-market-scan/package.json)。
- 优先直接执行 `./scripts/main.ts`；只有本机首次运行或提示依赖缺失时再执行 `bun install`，不要每次都先装一遍。
- 默认市场是 `usdm`，默认方向是 `both`。
- 默认最小 24h `quoteVolume` 是 `20000000`。
- 默认每侧返回 `10` 个候选。
