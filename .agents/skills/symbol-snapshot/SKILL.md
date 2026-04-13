---
name: symbol-snapshot
description: >-
  Fetch a fast single-symbol market snapshot from Binance without pulling full
  OHLCV. Use when Codex needs current 24h stats, funding context, or open
  interest for one symbol before deciding whether deeper analysis is needed.
---

# Symbol Snapshot

快速读取单个标的的即时市场快照，不落全量 K 线。

## 使用边界

- 这个 skill 只负责：
  - 单标的 `24h ticker`
  - 合约市场的 `premiumIndex`
  - 合约市场的 `openInterest`
- 这个 skill 不负责：
  - 账户、持仓、挂单、历史订单
  - 多周期 OHLCV 落盘
  - 技术指标、支撑阻力、趋势线

## 适用场景

- 用户已经明确给了 symbol，希望先快速看当前盘面
- 已有持仓或挂单，agent 需要先补单标的实时语境，再决定是否继续拉 K 线
- 只想确认日内涨跌、资金费率、持仓量，不需要完整 OHLCV

## 快速开始

1. 先构建：

```bash
./scripts/build-skills.sh
```

2. 查看合约单标的快照：

```bash
./.agents/skills/symbol-snapshot/scripts/symbol-snapshot --symbol BTCUSDT --market usdm
./.agents/skills/symbol-snapshot/scripts/symbol-snapshot --symbol BTC/USDT --market usdm
```

3. 查看现货单标的快照：

```bash
./.agents/skills/symbol-snapshot/scripts/symbol-snapshot --symbol ETHUSDT --market spot
```

## 默认约定

- 默认交易所：`binance`
- 默认市场：`usdm`
- 当前最小版只支持：
  - `spot`
  - `usdm`

## 输出解释

CLI 返回 `{ ok, data }` JSON，`data` 至少包含：

- `symbol`
- `requested_symbol`
- `exchange`
- `requested_exchange`
- `market`
- `generated_at`
- `ticker_24h`

当 `market=usdm` 时，额外包含：

- `premium_index`
- `open_interest`

## 设计意图

- `symbol-snapshot` 回答“这个标的现在大概什么状态”
- `ohlcv-fetch` 回答“把这个标的的多周期 K 线拉下来”
- `tech-indicators` 回答“结构和指标怎么看”

不要把这三层揉成一个 skill。
