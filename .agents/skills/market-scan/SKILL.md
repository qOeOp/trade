---
name: market-scan
description: >-
  Scan Binance public market data to shortlist tradable candidates across the
  market. Use when Codex needs to answer questions like “全市场还有什么能做”
  or “帮我筛几个顺风的多头/空头候选”.
---

# Market Scan

从 Binance 公共市场数据里先筛“看谁”，不负责直接做单标的深判。

## 使用边界

- 这个 skill 只负责：
  - 全市场候选生成
  - 流动性筛选
  - 24h 涨跌幅 / 成交额排序
  - 输出 long / short 候选列表
- 这个 skill 不负责：
  - 账户、持仓、挂单、历史订单
  - 单标的 OHLCV 拉取
  - 技术指标深判
- 如果用户已经明确给了 symbol，例如“看下 SOL / BTC / ETH”，通常不需要用这个 skill。
- 默认由 agent 自己在需要时串联：
  - `market-scan -> ohlcv-fetch -> tech-indicators`

## 快速开始

1. 先构建：

```bash
./scripts/build-skills.sh
```

2. 跑默认 Binance USD-M 扫描：

```bash
./.agents/skills/market-scan/scripts/market-scan
```

3. 只看多头或空头：

```bash
./.agents/skills/market-scan/scripts/market-scan --direction long
./.agents/skills/market-scan/scripts/market-scan --direction short
```

4. 调整流动性门槛或候选数量：

```bash
./.agents/skills/market-scan/scripts/market-scan --min-quote-volume 50000000 --limit 8
```

## 默认约定

- 默认市场：`usdm`
- 默认方向：`both`
- 默认最小 24h quote volume：`20000000`
- 默认每侧返回候选数：`10`
- 当前最小版只支持：
  - `spot`
  - `usdm`

## 输出解释

CLI 返回 `{ ok, data }` JSON，`data` 至少包含：

- `filters`
- `summary`
- `candidates.long`
- `candidates.short`

每个 candidate 至少包含：

- `symbol`
- `last_price`
- `price_change_percent`
- `quote_volume`
- `trade_count`
- `score`
- `tags`

## tags 口径

- `very-liquid`
- `liquid`
- `tradable`
- `trend-up-day`
- `trend-down-day`
- `event-risk`

`event-risk` 只是提示 24h 变化过大，不代表一定不能做；是否剔除由 agent 在后续阶段决定。

## 设计意图

- `market-scan` 回答“看谁”
- `ohlcv-fetch` 回答“把数据拉下来”
- `tech-indicators` 回答“怎么看结构”

不要把这三层职责揉在一起。
