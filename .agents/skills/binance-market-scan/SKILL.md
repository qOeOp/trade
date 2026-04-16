---
name: binance-market-scan
description: 扫描 Binance 公共市场数据，生成全市场 long / short 候选列表。适合回答“全市场还有什么能做”“帮我先筛几个标的”。
---

# Binance Market Scan

回答“先看谁”，不负责深判，不负责账户。

## 快速开始

```bash
./scripts/build-skills.sh
./.agents/skills/binance-market-scan/scripts/binance-market-scan
./.agents/skills/binance-market-scan/scripts/binance-market-scan --direction long
./.agents/skills/binance-market-scan/scripts/binance-market-scan --market spot --limit 8
```

## 使用边界

- 负责全市场候选生成、流动性筛选、24h 涨跌与成交额排序。
- 默认输出 `long` / `short` 两边候选。
- 不负责账户、持仓、挂单。
- 不负责单标的结构判断。
- 常见串联是：`binance-market-scan -> ohlcv-fetch -> tech-indicators`。

## CLI 约定

- 入口是 [binance-market-scan](/Users/vx/WebstormProjects/trade/.agents/skills/binance-market-scan/scripts/binance-market-scan)。
- 实现在 [main.ts](/Users/vx/WebstormProjects/trade/cmd/binance-market-scan/main.ts)。
- 默认市场是 `usdm`，默认方向是 `both`。
- 默认最小 24h `quoteVolume` 是 `20000000`。
- 默认每侧返回 `10` 个候选。
