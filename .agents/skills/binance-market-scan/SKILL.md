---
name: binance-market-scan
description: OBSERVE 阶段的 Binance 全市场初筛 skill。用于生成 long / short 候选列表，回答“先看谁”；不负责单标的深判、账户或执行。
---

# Binance Market Scan

只读 skill。回答“先看谁”，不负责深判、账户或执行。

## 何时使用

- 当前轮处于 `OBSERVE`
- 还没确定 symbol
- 需要先从 Binance 全市场生成候选

## 不该使用

- 账户恢复
- 单标的结构判断
- 真实执行

常见串联：`binance-market-scan -> ohlcv-fetch -> tech-indicators`

## 脚本边界

- 入口脚本是 [main.ts](./scripts/main.ts)
- 优先直接执行 `./scripts/main.ts`
- 负责全市场候选生成、流动性筛选、24h 涨跌与成交额排序
- 默认市场是 `usdm`，默认方向是 `both`
- 默认最小 24h `quoteVolume` 是 `20000000`
- 默认每侧返回 `10` 个候选
