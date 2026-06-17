# Market Data Design

## 目标

市场数据只服务四个交易后果：

- `entry`
- `stop`
- `size`
- `no_action`

不能改变这四项的数据，只能作为 notes / refs，不进入 `action_intent`。

## 当前范围

只接 Binance USDM。接入优先使用 `Node + binance-api-node`；缺高层方法时才用少量 raw request。

当前可用数据：

- OHLCV
- bid / ask / bookTicker
- 24h ticker
- premium / funding / mark price
- open interest
- aggTrades
- depth
- liquidation-like zones
- 账户侧 markPrice / liquidationPrice / 持仓 / 挂单 / 保护单

## 最小证据包

单标的进入 PLAN 前，market evidence 最少回答：

| 问题 | 数据来源 |
| --- | --- |
| 现在能不能进 | OHLCV / bid-ask / spread / funding |
| stop 放哪里 | OHLCV structure / liquidation-like zones |
| 仓位能不能给 | liquidity / spread / account risk |
| 是否应该 no_action | invalidation / stale data / event risk / poor liquidity |

不要求每轮都拉全量数据。缺什么补什么。

## Skill 边界

| Skill | 职责 |
| --- | --- |
| `ohlcv-fetch` | 多周期 K 线 |
| `binance-symbol-snapshot` | 单标的当前市场状态 |
| `binance-aggtrades-fetch` | 成交流原材料 |
| `binance-liquidation-zones` | liquidation-like zones |
| `binance-market-scan` | 候选粗筛；不得直接触发 live action |
| `tech-indicators` | 本地 OHLCV 结构与指标 |

`binance-market-scan` 只能回答“先看谁”。候选必须回到 `single-symbol`，并通过 setup 资格证。

## 存储

- OHLCV 继续使用 CSV + manifest。
- 微结构、aggTrades、depth、liquidation-like 输出默认只作为 refs。
- 不新增 market snapshot 表。
- replay / shadow 需要的数据由对应 skill 输出引用，不进入 `trade.db`。

## 禁止项

- 不为每类数据新增一个 skill。
- 不把市场解释写进接入脚本。
- 不把全市场扫描结果直接交给 LLM 做 live action。
- 不为了“可能有用”长期落盘微结构数据。
- 不把不能改变 `entry / stop / size / no_action` 的数据接入主决策。
